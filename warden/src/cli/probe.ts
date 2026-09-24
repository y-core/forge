import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { addCommand, createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { type DependencyOptions, dependencyRootOf } from "../corpus/dependency";
import { discover } from "../corpus/source";
import { duplicatePairs } from "../gate/duplicates";
import type { GoldenQuery } from "../gate/golden";
import { goldenSetsOf, GOLDEN_STEP_LABEL, stepsOf } from "../gate/step-sets";
import { build } from "../index/build";
import { openDatabase } from "../index/db";
import { packageNameOf, resolveRepoRoot } from "../paths";
import { aliasesFor } from "../search/aliases";
import { documentFrequency } from "../search/coverage";
import { terms } from "../search/query";
import { MARGIN, search } from "../search/search";
import { resolveKind } from "../sync/kind";
import type { Tree } from "../types";
import { canonVersion } from "../version";
import { KIND_FLAG, ROOT_FLAG } from "./flags";

/** What one probe measures. @public */
export interface ProbeOptions extends DependencyOptions {
  root: string;
  kind: Tree;
  golden?: readonly GoldenQuery[];
  negative?: readonly string[];
  canonRoot?: string;
  docsDir?: string;
}

/** How deep the refusal measurement looks, matching the pool `search` scores for coverage. */
const POOL = 60;

const TOP_N = 5;

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

/** Builds the corpus into a scratch database and reports every figure a stage's abort list names. @public */
export function probe(options: ProbeOptions): string {
  const golden = options.golden ?? [];
  const negative = options.negative ?? [];
  const dependencyRoot = dependencyRootOf(options, options.root);
  const sources = discover(options.root, options.kind, {
    ...(options.canonRoot === undefined ? {} : { canonRoot: options.canonRoot }),
    ...(options.docsDir === undefined ? {} : { docsDir: options.docsDir }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
  });
  if (sources.length === 0) throw new CliError("invalid-args", "discovery found no document to index — the corpus roots are wrong");

  // The table this repository's tree earns, exactly as `openIndex` and the gate resolve it.
  const aliases = aliasesFor(options.kind);
  const db = openDatabase(resolve(mkdtempSync(resolve(tmpdir(), "warden-probe-")), "probe.sqlite"));
  const lines: string[] = [];
  try {
    const report = build(db, sources, canonVersion(), packageNameOf(options.root));

    lines.push(`# probe ${options.root} (${options.kind})`, "");
    lines.push("## corpora");
    const counts = db
      .query<{ corpus: string; documents: number; chunks: number }>(
        `SELECT source.corpus AS corpus, count(DISTINCT source.id) AS documents, count(chunk.id) AS chunks
         FROM source LEFT JOIN chunk ON chunk.source_id = source.id GROUP BY source.corpus ORDER BY source.corpus`,
      )
      .all();
    for (const row of counts) lines.push(`${pad(row.corpus, 12)}${pad(String(row.documents), 5)} documents  ${row.chunks} chunks`);
    lines.push(`${pad("total", 12)}${pad(String(report.documents), 5)} documents  ${report.chunks} chunks  ${report.relations} relations`);
    lines.push("");

    lines.push("## golden");
    const topOne = new Set<string>();
    let thinnest = 1;
    let thinnestQuery = "";
    for (const entry of golden) {
      const within = entry.within ?? 3;
      const hits = search(db, entry.query, { aliases, limit: Math.max(TOP_N, within) });
      const first = hits[0];
      if (first !== undefined) topOne.add(first.id.split("#")[0] ?? first.id);
      const rank = hits.findIndex((hit) => hit.id === entry.expect);
      const found = hits[rank];
      // Uncapped: `hits` has already had `FLOOR` applied, so a thinnest read off it can never
      // report the sub-floor region the margin exists to measure.
      const carried = search(db, entry.query, { aliases, limit: POOL, floor: 0 }).find((hit) => hit.id === entry.expect)?.coverage ?? 0;
      if (carried < thinnest) {
        thinnest = carried;
        thinnestQuery = entry.query;
      }
      const verdict = rank !== -1 && rank < within ? "pass" : "fail";
      const rankText = rank === -1 ? "-" : String(rank + 1);
      const cover = found === undefined ? "-----" : found.coverage.toFixed(3);
      lines.push(`${verdict}  ${pad(`${rankText}/${within}`, 6)} ${cover}  ${pad(entry.expect, 46)} "${entry.query}"`);
    }
    lines.push("");

    lines.push("## negative");
    let loudest = 0;
    let loudestQuery = "";
    for (const query of negative) {
      let peak = 0;
      for (const hit of search(db, query, { aliases, limit: POOL, floor: 0 })) peak = Math.max(peak, hit.coverage);
      if (peak > loudest) {
        loudest = peak;
        loudestQuery = query;
      }
      const offered = search(db, query, { aliases, limit: TOP_N }).length;
      lines.push(`${peak.toFixed(3)} peak, ${offered} offered  "${query}"`);
    }
    lines.push("");

    lines.push(
      `## margin`,
      `thinnest answered ${thinnest.toFixed(3)}  "${thinnestQuery}"`,
      `loudest refused   ${loudest.toFixed(3)}  "${loudestQuery}"`,
      `room left         ${(thinnest - loudest).toFixed(3)}  (guarded at ${MARGIN.toFixed(2)})`,
      "",
    );

    // `ABSENT_PENALTY` means a negative query can only cross the floor once one of its terms stops
    // being unknown, so a `df` moving off zero is the one channel by which a refusal fails.
    lines.push("## negative term df");
    const vocabulary = new Set(negative.flatMap((query) => terms(query)));
    for (const term of [...vocabulary].sort()) lines.push(`${pad(String(documentFrequency(db, term)), 6)}${term}`);
    lines.push("");

    lines.push("## top-1");
    for (const id of [...topOne].sort()) lines.push(id);
    for (const row of db.query<{ path: string }>("SELECT path FROM source WHERE corpus = 'canon' ORDER BY path").all()) {
      if (!topOne.has(`canon:${row.path}`)) lines.push(`UNREACHED canon:${row.path}`);
    }
    lines.push("");

    lines.push("## rules");
    const glossless = db
      .query<{ id: string; rules: string }>("SELECT id, rules FROM chunk WHERE searchable = 1 AND gloss = '' AND rules <> '' ORDER BY id")
      .all();
    for (const row of glossless) lines.push(`${pad(String(row.rules.split(/\s+/).length), 4)}${pad(row.id, 56)} ${row.rules}`);
    lines.push(`${glossless.length} gloss-less chunks carry rules`);
    lines.push("");

    lines.push("## dead bridges");
    for (const [term, targets] of aliases) {
      for (const target of targets) if (documentFrequency(db, target) === 0) lines.push(`${term} -> ${target}`);
    }
    lines.push("");

    lines.push("## duplicates");
    const pairs = duplicatePairs({
      root: options.root,
      kind: options.kind,
      ...(options.canonRoot === undefined ? {} : { canonRoot: options.canonRoot }),
      ...(options.docsDir === undefined ? {} : { docsDir: options.docsDir }),
      ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
    });
    for (const pair of pairs) lines.push(`k${pair.klass} ${pair.score.toFixed(3)}  ${pair.a}  ${pair.b}`);
    lines.push(`${pairs.length} pairs`);
  } finally {
    db.close();
  }
  return `${lines.join("\n")}\n`;
}

/** The sets a probe measures, read off the repository's step table — or off an explicit module; raises where it finds neither. @public */
export async function probeSetsOf(
  module: string | undefined,
  root: string,
): Promise<{ golden: readonly GoldenQuery[]; negative: readonly string[] }> {
  const file = module === undefined ? resolve(root, "config/steps.ts") : resolve(module);
  const loaded: unknown = await import(file).catch((error: unknown) => {
    throw new CliError("invalid-args", `cannot load \`${file}\` — ${error instanceof Error ? error.message : String(error)}`);
  });

  if (module !== undefined) {
    const exports = loaded as { GOLDEN?: readonly GoldenQuery[]; NEGATIVE?: readonly string[] };
    if (exports.GOLDEN === undefined)
      throw new CliError("invalid-args", `\`${file}\` exports no GOLDEN — name a module that does, or drop --golden`);
    return { golden: exports.GOLDEN, negative: exports.NEGATIVE ?? [] };
  }

  const steps = stepsOf(loaded);
  if (steps === undefined)
    throw new CliError("invalid-args", `\`${file}\` exports no step table as \`default\` or \`STEPS\` — pass --golden=<module exporting GOLDEN>`);
  const sets = goldenSetsOf(steps);
  if (sets === undefined)
    throw new CliError(
      "invalid-args",
      `\`${file}\` declares no \`${GOLDEN_STEP_LABEL}\` row — add one, or pass --golden=<module exporting GOLDEN>`,
    );
  return sets;
}

/** Builds the `warden probe` command — the diffable measurement one stage is judged against. @public */
export function createProbeCommand(parent: CommandBase): void {
  addCommand(
    parent,
    createCommand({
      name: "probe",
      description: "Measure retrieval over a scratch index and print one diffable block",
      flags: {
        root: ROOT_FLAG,
        kind: KIND_FLAG,
        golden: { type: "string", description: "Module exporting GOLDEN and NEGATIVE (default: the `warden:queries` row of `config/steps.ts`)" },
        dependency: { type: "boolean", description: "Also index the installed library's consumer-facing documents" },
      },
      run: async (_args, flags) => {
        const root = resolveRepoRoot(flags.root);
        const sets = await probeSetsOf(flags.golden, root);
        process.stdout.write(probe({ root, kind: resolveKind(root, flags.kind), ...sets, dependency: flags.dependency === true }));
      },
    }),
  );
}
