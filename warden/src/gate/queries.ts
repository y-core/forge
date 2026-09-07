import { type CheckResult, checkResult, type Finding, fail, scannedNothing } from "../../../src/tooling/gate/finding";
import { discover } from "../corpus/source";
import { build } from "../index/build";
import { gateIndexPath, openDatabase } from "../index/db";
import { freshness } from "../index/freshness";
import { search } from "../search/search";
import type { Tree } from "../types";
import { canonVersion } from "../version";
import { GOLDEN, type GoldenQuery, NEGATIVE } from "./golden";

/** What the golden-query check needs to know about the project. @public */
export interface GoldenCheckConfig {
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
}

const TOP_N = 5;

/** How deep the margin measurement looks. Matches the pool `search` scores for coverage, so the
 *  reported figure is the whole of what the floor refused rather than the top of it. */
const POOL = 60;

/** Runs the golden retrieval set against a freshly built index.
 *
 *  Deterministic by construction: BM25 is a pure function of the index, the index is built from
 *  disk on every run, and ties break on `chunk.id ASC`. @public */
export function checkGoldenQueries(config: GoldenCheckConfig): CheckResult {
  const queries = config.queries ?? GOLDEN;
  if (queries.length === 0) return scannedNothing("the golden set is empty — retrieval is unmeasured", "warden:queries", "read");

  const sources = discover(config.root, config.kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
  });
  const db = openDatabase(config.indexPath ?? gateIndexPath(config.root));
  try {
    // `warden` runs first in the same gate and builds this very database from the same sources, so
    // a second unconditional build is 150 ms of repeated work. Run alone, the index is absent or
    // stale — never fresh — so this still builds what it measures.
    if (!freshness(db, sources, canonVersion()).fresh) build(db, sources, canonVersion());
    const findings: Finding[] = [];
    const topOne = new Set<string>();
    let thinnest = 1;
    let loudest = 0;

    for (const golden of queries) {
      const hits = search(db, golden.query, { limit: Math.max(TOP_N, golden.within ?? 3) });
      const first = hits[0];
      if (first !== undefined) topOne.add(first.id.split("#")[0] ?? first.id);

      const expected = hits.find((hit) => hit.id === golden.expect);
      if (expected !== undefined) thinnest = Math.min(thinnest, expected.coverage);

      const rank = hits.findIndex((hit) => hit.id === golden.expect);
      const within = golden.within ?? 3;
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
      const offered = search(db, query, { limit: TOP_N });
      for (const hit of search(db, query, { limit: POOL, floor: 0 })) loudest = Math.max(loudest, hit.coverage);
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

    const margin = `floor margin ${thinnest.toFixed(3)} answered / ${loudest.toFixed(3)} refused`;
    return checkResult(findings, `${queries.length} golden queries, ${topOne.size} documents reached top-1, ${margin}.`);
  } finally {
    db.close();
  }
}
