import type { Database } from "bun:sqlite";

import { COLUMN_WEIGHTS } from "../index/schema";
import { coverage } from "./coverage";
import { matchExpression } from "./query";

/** One ranked hit. @public */
export interface Hit {
  id: string;
  corpus: string;
  tree?: string;
  path: string;
  section: string;
  title: string;
  headingPath: string;
  gloss: string;
  score: number;
  /** The share of the query's information this chunk carries, from 0 to 1. */
  coverage: number;
}

/** Which corpus a section belongs to, in words rather than as an id prefix.
 *
 *  **A repository specialises the canon under the same filename and the same section numbers**, so
 *  `canon:CODE_REVIEW.md#3a` and `project:docs/CODE_REVIEW.md#3a` come back with identical titles
 *  and identical glosses, and only the prefix says which one governs. Every surface that renders a
 *  hit spells it out, because a reader who takes the general rule for the local one — or the reverse
 *  — has been misled by the output, not by the corpus. @public */
export function corpusLabel(corpus: string): string {
  return corpus === "canon" ? "fleet canon" : "this repository";
}

/** What a search may be narrowed by. @public */
export interface SearchOptions {
  /** `canon` or `project`; omit for both. */
  corpus?: string;
  /** A whole path or a directory of them, matched on the segment boundary and never as a pattern. */
  path?: string;
  /** Maximum hits. Defaults to 10. */
  limit?: number;
  /** Minimum coverage a hit must carry. Defaults to `FLOOR`; 0 disables the floor entirely. */
  floor?: number;
}

interface Row {
  rowid: number;
  id: string;
  corpus: string;
  tree: string | null;
  path: string;
  section: string;
  title: string;
  heading_path: string;
  gloss: string;
  score: number;
}

/** The least of a query's information a hit may carry and still be offered as an answer.
 *
 *  **Calibrated, not chosen.** Across the golden set the expected hit earns 0.392 at worst; across
 *  the negative set the best hit anywhere in the pool earns 0.308. This sits midway. The
 *  `warden:queries` gate step reports both figures every run, so the margin is watched rather than
 *  assumed — move this only with that summary in hand, and add the query that forced the move to
 *  whichever set it belongs to.
 *
 *  The measurement that matters is the **peak** coverage in the pool, not the top-ranked hit's:
 *  BM25 decides the order and coverage decides admission, so the hit that survives a floor is often
 *  not the one BM25 put first. A calibration that reads `hits[0]` understates what the floor has to
 *  refuse. */
const FLOOR = 0.35;

/** How many candidates are scored for coverage before the floor and the limit are applied. Deep
 *  enough that neither the floor nor the re-rank can be starved of the hit it should surface. */
const POOL = 60;

/** The share of a hit's rank that BM25 keeps outright, the rest being scaled by coverage.
 *
 *  **Coverage answers a question BM25 cannot: how much of what was asked this section addresses.**
 *  BM25 rewards a rare term wherever it lands, so one uncommon word drags a chunk up regardless of
 *  how little else of the query it carries — which is how a search for the comment budget returned
 *  two `Where to go` stubs above the rule itself.
 *
 *  **Calibrated by sweep, not chosen.** Across the golden set and four probes, 1.0 (BM25 alone) and
 *  0.0 (coverage alone) both rank worse than the blend; below 0.5 a golden query falls outside its
 *  threshold, and 0.6 is the best rank sum that costs none of them. `warden:queries` fails on any
 *  golden regression, so a later move is measured rather than argued. */
const BM25_SHARE = 0.6;

/** A literal for a `LIKE ... ESCAPE '\'` pattern: a caller's `%` and `_` are data, not wildcards.
 *
 *  The escape character is escaped first — doing it last would re-escape the backslash that
 *  escaping `%` had just introduced. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** One hit's final rank: its BM25 score, the coverage-scaled part of it earned rather than given. */
function rank(hit: { score: number; coverage: number }): number {
  return hit.score * (BM25_SHARE + (1 - BM25_SHARE) * hit.coverage);
}

/** BM25 over the FTS index, scaled by the document's path-derived weight, then held to a floor.
 *
 *  The tie-break on `chunk.id ASC` is not cosmetic: it is what makes a golden-query test a test
 *  rather than a coin flip, since two chunks scoring identically would otherwise swap on any
 *  change to insertion order.
 *
 *  **An empty result is a real answer here.** BM25 is relative, so without the floor every query
 *  returns exactly `limit` hits whatever their quality, and a reader told to search before
 *  inferring a rule reads the best of a bad set and infers from that instead. @public */
export function search(db: Database, query: string, options: SearchOptions = {}): Hit[] {
  const match = matchExpression(query);
  if (match === "") return [];

  const limit = options.limit ?? 10;
  const floor = options.floor ?? FLOOR;

  const filters: string[] = [];
  const params: unknown[] = [match];
  if (options.corpus !== undefined) {
    filters.push("source.corpus = ?");
    params.push(options.corpus);
  }
  const prefix = options.path === undefined ? "" : options.path.replace(/\/+$/, "");
  if (prefix !== "") {
    filters.push("(source.path = ? OR source.path LIKE ? ESCAPE '\\')");
    params.push(prefix, `${likeLiteral(prefix)}/%`);
  }
  params.push(Math.max(limit, POOL));

  const sql = `
    SELECT chunk.rowid, chunk.id, source.corpus, source.tree, source.path, chunk.section, chunk.title,
           chunk.heading_path, chunk.gloss,
           (-bm25(chunk_fts, ${COLUMN_WEIGHTS.join(", ")})) * source.weight AS score
    FROM chunk_fts
    JOIN chunk ON chunk.rowid = chunk_fts.rowid
    JOIN source ON source.id = chunk.source_id
    WHERE chunk_fts MATCH ?${filters.length === 0 ? "" : ` AND ${filters.join(" AND ")}`}
    ORDER BY score DESC, chunk.id ASC
    LIMIT ?`;

  const rows = db.query<Row>(sql).all(...params);
  const carried = coverage(
    db,
    query,
    rows.map((row) => row.rowid),
  );

  return rows
    .map((row) => ({
      id: row.id,
      corpus: row.corpus,
      ...(row.tree === null ? {} : { tree: row.tree }),
      path: row.path,
      section: row.section,
      title: row.title,
      headingPath: row.heading_path,
      gloss: row.gloss,
      score: row.score,
      coverage: carried.get(row.rowid) ?? 0,
    }))
    .filter((hit) => hit.coverage >= floor)
    .sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}
