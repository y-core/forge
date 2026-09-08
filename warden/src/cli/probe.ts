import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { addCommand, createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { type DependencyOptions, dependencyRootOf } from "../corpus/dependency";
import { discover } from "../corpus/source";
import { duplicatePairs } from "../gate/duplicates";
import { GOLDEN, type GoldenQuery, NEGATIVE } from "../gate/golden";
import { build } from "../index/build";
import { openDatabase } from "../index/db";
import { packageNameOf, resolveRepoRoot } from "../paths";
import { aliasesFor } from "../search/aliases";
import { documentFrequency } from "../search/coverage";
import { terms } from "../search/query";
import { search } from "../search/search";
import { resolveKind } from "../sync/kind";
import type { Tree } from "../types";
import { canonVersion } from "../version";

/** What one probe measures. @public */
export interface ProbeOptions extends DependencyOptions {
  root: string;
  kind: Tree;
  golden?: readonly GoldenQuery[];
  negative?: readonly string[];
  canonRoot?: string;
  docsDir?: string;
}

/** How deep the refusal measurement looks — the pool `search` itself scores for coverage, so the
 *  reported figure is the whole of what the floor refused rather than the top of it. */
const POOL = 60;

const TOP_N = 5;

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

/** Builds the corpus into a scratch database and reports every figure a stage's abort list names.
 *
 *  **Read-only, and deliberately its own index.** It measures what the corpus would answer now, so
 *  it must never write the developer's working index or the gate's — a probe run between two edits
 *  would otherwise decide a later verdict. @public */
export function probe(options: ProbeOptions): string {
  const golden = options.golden ?? GOLDEN;
  const negative = options.negative ?? NEGATIVE;
  const dependencyRoot = dependencyRootOf(options, options.root);
  const sources = discover(options.root, options.kind, {
    ...(options.canonRoot === undefined ? {} : { canonRoot: options.canonRoot }),
    ...(options.docsDir === undefined ? {} : { docsDir: options.docsDir }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
  });
  if (sources.length === 0) throw new CliError("invalid-args", "discovery found no document to index — the corpus roots are wrong");

  // The table this repository's tree earns, exactly as `openIndex` and the gate resolve it: a probe
  // measured against every bridge in the file would not be measuring what anything serves.
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
    for (const entry of golden) {
      const within = entry.within ?? 3;
      const hits = search(db, entry.query, { aliases, limit: Math.max(TOP_N, within) });
      const first = hits[0];
      if (first !== undefined) topOne.add(first.id.split("#")[0] ?? first.id);
      const rank = hits.findIndex((hit) => hit.id === entry.expect);
      const found = hits[rank];
      if (found !== undefined) thinnest = Math.min(thinnest, found.coverage);
      const verdict = rank !== -1 && rank < within ? "pass" : "fail";
      const rankText = rank === -1 ? "-" : String(rank + 1);
      const cover = found === undefined ? "-----" : found.coverage.toFixed(3);
      lines.push(`${verdict}  ${pad(`${rankText}/${within}`, 6)} ${cover}  ${pad(entry.expect, 46)} "${entry.query}"`);
    }
    lines.push("");

    lines.push("## negative");
    let loudest = 0;
    for (const query of negative) {
      let peak = 0;
      for (const hit of search(db, query, { aliases, limit: POOL, floor: 0 })) peak = Math.max(peak, hit.coverage);
      loudest = Math.max(loudest, peak);
      const offered = search(db, query, { aliases, limit: TOP_N }).length;
      lines.push(`${peak.toFixed(3)} peak, ${offered} offered  "${query}"`);
    }
    lines.push("");

    lines.push(`## margin`, `thinnest answered ${thinnest.toFixed(3)}`, `loudest refused   ${loudest.toFixed(3)}`, "");

    // The load-bearing list. `ABSENT_PENALTY` means a negative query can only cross the floor after
    // one of its terms stops being unknown to the corpus, so a `df` moving off zero is the single
    // channel by which enlarging the corpus makes a refusal fail.
    lines.push("## negative term df");
    const vocabulary = new Set(negative.flatMap((query) => terms(query)));
    for (const term of [...vocabulary].sort()) lines.push(`${pad(String(documentFrequency(db, term)), 6)}${term}`);
    lines.push("");

    lines.push("## top-1");
    for (const id of [...topOne].sort()) lines.push(id);
    // The same assertion `checkGoldenQueries` hard-fails on, reported rather than thrown: enlarging
    // the corpus steals a top-1 long before it costs a golden rank, and this is where that shows.
    for (const row of db.query<{ path: string }>("SELECT path FROM source WHERE corpus = 'canon' ORDER BY path").all()) {
      if (!topOne.has(`canon:${row.path}`)) lines.push(`UNREACHED canon:${row.path}`);
    }
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

/** The golden and negative sets a module exports, or the shipped pair when it exports neither. */
async function setsOf(module: string | undefined, root: string): Promise<{ golden?: readonly GoldenQuery[]; negative?: readonly string[] }> {
  const file = module === undefined ? resolve(root, "config/golden.ts") : resolve(module);
  const loaded: unknown = await import(file).catch((error: unknown) => {
    if (module === undefined) return undefined;
    throw new CliError("invalid-args", `cannot load the golden set from \`${file}\` — ${error instanceof Error ? error.message : String(error)}`);
  });
  if (loaded === undefined) return {};
  const exports = loaded as { GOLDEN?: readonly GoldenQuery[]; NEGATIVE?: readonly string[] };
  return {
    ...(exports.GOLDEN === undefined ? {} : { golden: exports.GOLDEN }),
    ...(exports.NEGATIVE === undefined ? {} : { negative: exports.NEGATIVE }),
  };
}

/** Builds the `warden probe` command — the diffable measurement one stage is judged against. @public */
export function createProbeCommand(parent: CommandBase): void {
  addCommand(
    parent,
    createCommand({
      name: "probe",
      description: "Measure retrieval over a scratch index and print one diffable block",
      flags: {
        root: { type: "string", description: "Repository root (default: derived from warden's install path)" },
        kind: { type: "string", description: "Select the canon tree (libs|apps), overriding package.json's `warden.kind`" },
        golden: { type: "string", description: "Module exporting GOLDEN and NEGATIVE (default: `config/golden.ts` when present)" },
        dependency: { type: "boolean", description: "Also index the installed library's consumer-facing documents" },
      },
      run: async (_args, flags) => {
        const root = resolveRepoRoot(flags.root);
        const sets = await setsOf(flags.golden, root);
        process.stdout.write(probe({ root, kind: resolveKind(root, flags.kind), ...sets, dependency: flags.dependency === true }));
      },
    }),
  );
}
