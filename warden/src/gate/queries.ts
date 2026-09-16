import { checkResult, fail, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding, GateMode } from "../../../src/tooling/gate/types";
import { type DependencyOptions, dependencyRootOf } from "../corpus/dependency";
import { discover } from "../corpus/source";
import { build } from "../index/build";
import { gateIndexPath, openDatabase } from "../index/db";
import { freshness } from "../index/freshness";
import { packageNameOf } from "../paths";
import { type AliasTable, aliasesFor } from "../search/aliases";
import { documentFrequency } from "../search/coverage";
import { FLOOR, MARGIN, search } from "../search/search";
import type { Tree } from "../types";
import { canonVersion } from "../version";
import { type Dimension, GOLDEN, type GoldenQuery, NEGATIVE } from "./golden";

/** What the golden-query check needs to know about the project. @public */
export interface GoldenCheckConfig extends DependencyOptions {
  /** Repository root. */
  root: string;
  /** The canon tree this repository is subject to. */
  kind: Tree;
  /** Replaces the shipped golden set. */
  queries?: readonly GoldenQuery[];
  /** Replaces the shipped negative set — the questions retrieval must refuse. */
  negative?: readonly string[];
  /** Directory of this repository's own governing documents. Defaults to `docs`. */
  docsDir?: string;
  /** The canon root. Defaults to the installed one, which is where a consumer's canon comes from. */
  canonRoot?: string;
  /** Where the gate builds its index. Defaults to `.forge/warden/gate.sqlite`. */
  indexPath?: string;
  /** Whether every canon document must be top-1 for at least one query. Defaults to `true`. */
  coverage?: boolean;
  /** Replaces the tree's own alias table — the bridges held to reaching something. */
  aliases?: AliasTable;
}

const TOP_N = 5;

/** How deep the margin measurement looks. Matches the pool `search` scores for coverage, so the
 *  reported figure is the whole of what the floor refused rather than the top of it. */
const POOL = 60;

/** The order the rollup prints, fixed so two runs are diffable.
 *
 *  Exhaustive by construction: a dimension added to the type without a rank here fails to compile,
 *  where the `readonly Dimension[]` this replaced would have compiled and silently dropped the new
 *  kind of question from the rollup — the rollup being built by filtering, so an unlisted dimension
 *  is indistinguishable from an untagged one. */
const DIMENSION_ORDER: Record<Dimension, number> = { placement: 1, prohibition: 2, procedure: 3, rationale: 4, boundary: 5, reference: 6 };

interface Rollup {
  /** The furthest down the expected hit sat, 1-indexed. */
  worst: number;
  /** Whether some query of this kind did not find its answer at all. */
  missed: boolean;
  /** The least of a query's information any answer of this kind carried, measured uncapped. */
  thinnest: number;
}

/** How small a replacement golden set may be before the margin guard stands down. The check ships
 *  to other repositories, where `config.queries` is a handful of local questions: a three-query set
 *  measures one corner of the corpus, and holding a floor calibrated against 45 to what those three
 *  happen to reach would fail arbitrarily. */
const MARGIN_QUORUM = 20;

/** What each kind of question cost retrieval, in the fixed order, or `""` when nothing is tagged.
 *
 *  Instrumentation, not a threshold: the alias table is built on the claim that placement is the
 *  question lexical retrieval serves worst, and until this ran nothing measured it. A dimension
 *  earns a threshold once there are runs to set one from. */
function rollup(measured: ReadonlyMap<Dimension, Rollup>): string {
  const clauses = [...measured.entries()]
    .sort(([a], [b]) => DIMENSION_ORDER[a] - DIMENSION_ORDER[b])
    .map(([dimension, seen]) => `${dimension} worst ${seen.missed ? "miss" : seen.worst} / thinnest ${seen.thinnest.toFixed(3)}`);
  return clauses.length === 0 ? "" : `; ${clauses.join(", ")}`;
}

/** Runs the golden retrieval set against a freshly built index.
 *
 *  Deterministic by construction: BM25 is a pure function of the index, the index is built from
 *  disk on every run, and ties break on `chunk.id ASC`. @public */
export function checkGoldenQueries(config: GoldenCheckConfig, mode: GateMode = "standard"): CheckResult {
  const queries = config.queries ?? GOLDEN;
  if (queries.length === 0) return scannedNothing("the golden set is empty — retrieval is unmeasured", "warden:queries", "read");

  const dependencyRoot = dependencyRootOf(config, config.root);
  const sources = discover(config.root, config.kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
  });
  const db = openDatabase(config.indexPath ?? gateIndexPath(config.root));
  try {
    // `warden` runs first in the same gate and builds this very database from the same sources, so
    // a second unconditional build is 150 ms of repeated work. Run alone, the index is absent or
    // stale — never fresh — so this still builds what it measures.
    if (!freshness(db, sources, canonVersion()).fresh) build(db, sources, canonVersion(), packageNameOf(config.root));
    // Resolved once, above every query: the table decides both the MATCH expression and the
    // coverage denominator, so a run that scored with one table and warned about another would be
    // measuring something nothing serves.
    const aliases = config.aliases ?? aliasesFor(config.kind);
    const findings: Finding[] = [];
    const topOne = new Set<string>();
    const measured = new Map<Dimension, Rollup>();
    let thinnest = 1;
    let thinnestQuery = "";
    let loudest = 0;
    let loudestQuery = "";

    for (const golden of queries) {
      const hits = search(db, golden.query, { aliases, limit: Math.max(TOP_N, golden.within ?? 3) });
      const first = hits[0];
      if (first !== undefined) topOne.add(first.id.split("#")[0] ?? first.id);

      // Measured with the floor lifted and the limit widened, exactly as `loudest` is: reading the
      // coverage off `hits` reads it off a list `FLOOR` has already filtered, so the figure could
      // never fall below the floor — the one region the guard exists to watch — and a regression
      // that pushed a thin answer out of the results would make the margin look wider.
      const carried = search(db, golden.query, { aliases, limit: POOL, floor: 0 }).find((hit) => hit.id === golden.expect)?.coverage ?? 0;
      if (carried < thinnest) {
        thinnest = carried;
        thinnestQuery = golden.query;
      }

      const rank = hits.findIndex((hit) => hit.id === golden.expect);
      const within = golden.within ?? 3;

      if (golden.dimension !== undefined) {
        const seen = measured.get(golden.dimension) ?? { worst: 0, missed: false, thinnest: 1 };
        measured.set(golden.dimension, {
          worst: Math.max(seen.worst, rank + 1),
          missed: seen.missed || rank === -1,
          thinnest: Math.min(seen.thinnest, carried),
        });
      }

      if (rank === -1 || rank >= within) {
        const actual = hits.slice(0, TOP_N).map((hit, index) => `  ${index + 1}. ${hit.id}  (${hit.score.toFixed(3)})`);
        findings.push(
          fail(
            `"${golden.query}" — expected \`${golden.expect}\` within ${within}, got${actual.length === 0 ? " nothing" : `:\n${actual.join("\n")}`}`,
            { file: "warden/src/gate/golden.ts" },
          ),
        );
      }

      for (const banned of golden.absent ?? []) {
        if (hits.some((hit) => hit.id === banned)) {
          findings.push(fail(`"${golden.query}" — \`${banned}\` must not be returned, and was`, { file: "warden/src/gate/golden.ts" }));
        }
      }
    }

    // A question the corpus does not answer must be refused, not answered badly. Measured with the
    // floor lifted as well as applied, so the summary can report how much room the floor has left.
    // The peak of the whole pool, never `hits[0]`: BM25 sets the order and coverage sets admission,
    // so the hit a floor has to refuse is routinely not the one BM25 ranked first.
    for (const query of config.negative ?? NEGATIVE) {
      const offered = search(db, query, { aliases, limit: TOP_N });
      for (const hit of search(db, query, { aliases, limit: POOL, floor: 0 })) {
        if (hit.coverage > loudest) {
          loudest = hit.coverage;
          loudestQuery = query;
        }
      }
      if (offered.length > 0) {
        findings.push(
          fail(
            `"${query}" — the corpus does not answer this and retrieval offered ${offered.length}, led by \`${offered[0]?.id}\` at coverage ${offered[0]?.coverage.toFixed(3)}`,
            { file: "warden/src/gate/golden.ts" },
          ),
        );
      }
    }

    // What stops the golden set decaying into a stale fixture: a document no query reaches is a
    // document retrieval has quietly stopped serving, and nobody would notice.
    if (config.coverage !== false) {
      const canon = db
        .query<{ corpus: string; tree: string | null; path: string }>(
          "SELECT corpus, tree, path FROM source WHERE corpus = 'canon' ORDER BY tree, path",
        )
        .all();
      for (const row of canon) {
        const id = `${row.corpus}:${row.path}`;
        if (!topOne.has(id)) {
          findings.push(
            fail(`\`${id}\` is top-1 for no golden query — add one, or retrieval has stopped serving it`, { file: "warden/src/gate/golden.ts" }),
          );
        }
      }
    }

    // A bridge whose target no chunk carries is OR-ed into every query that triggers it and reaches
    // nothing — dead weight that could sit there for years, since a bridge failing is indistinguishable
    // from a bridge nobody needed. Warned rather than failed: the table is the fleet's, and a
    // consumer's corpus legitimately lacks some of its vocabulary.
    let live = 0;
    let bridges = 0;
    for (const [term, targets] of aliases) {
      for (const target of targets) {
        bridges++;
        if (documentFrequency(db, target) > 0) live++;
        else findings.push(warn(`alias bridge \`${term}\` → \`${target}\` reaches no chunk`, { file: "warden/src/search/aliases.ts" }));
      }
    }

    // The figure the gate has printed since the floor was calibrated, now held to `MARGIN`. Both
    // queries are named because "margin 0.049" says a number moved and not what to look at: the
    // answer to widen is one of these two, and which one it is decides whether the fix is a
    // rewrite, a bridge, or a negative entry that has stopped being unanswerable.
    const margin = thinnest - loudest;
    const guarded = config.queries === undefined || queries.length >= MARGIN_QUORUM;
    if (guarded && margin < MARGIN) {
      const report = mode === "full" ? fail : warn;
      findings.push(
        report(`the floor has ${margin.toFixed(3)} of room left, under ${MARGIN.toFixed(2)} — \`FLOOR\` is ${FLOOR} and sits between these two`, {
          file: "warden/src/search/search.ts",
          detail: [`thinnest answered ${thinnest.toFixed(3)}  "${thinnestQuery}"`, `loudest refused   ${loudest.toFixed(3)}  "${loudestQuery}"`],
        }),
      );
    }

    const summary = `floor margin ${thinnest.toFixed(3)} answered / ${loudest.toFixed(3)} refused`;
    return checkResult(
      findings,
      `${queries.length} golden queries, ${topOne.size} documents reached top-1, ${live}/${bridges} alias bridges live, ${summary}${rollup(measured)}.`,
    );
  } finally {
    db.close();
  }
}
