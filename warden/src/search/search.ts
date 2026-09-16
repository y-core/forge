import type { Database } from "bun:sqlite";

import { COLUMN_WEIGHTS } from "../index/schema";
import type { Corpus } from "../types";
import type { AliasTable } from "./aliases";
import { coverage } from "./coverage";
import { excerptOf } from "./excerpt";
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
  /** One line a reader can judge this hit by, present only when `SearchOptions.excerpt` asked for
   *  it. Never `""`: it falls back through `rules` and the section's own prose to the title. */
  excerpt?: string;
}

/** Exhaustive by construction: a corpus added to the type without a label here fails to compile,
 *  where the two-arm conditional this replaced would have rendered it as "this repository". */
const CORPUS_LABELS: Record<Corpus, string> = {
  canon: "fleet canon",
  project: "this repository",
  // Advisory, and said so: these rules govern the library, not the repository asking. The label is
  // not what keeps a ruling about the library's own tree out of a consumer's answers — the
  // `audience` frontmatter key is, by never indexing one.
  dependency: "installed @y-core/forge (advisory)",
};

/** Which corpus a section belongs to, in words rather than as an id prefix.
 *
 *  **A repository specialises the canon under the same filename and the same section numbers**, so
 *  `canon:CODE_REVIEW.md#3a` and `project:docs/FORGE_REVIEW.md#3a` come back with identical titles
 *  and identical glosses, and only the prefix says which one governs. Every surface that offers a
 *  hit as an answer spells it out — `renderHit` is the one that does it — because a reader who takes
 *  the general rule for the local one, or the reverse, has been misled by the output rather than by
 *  the corpus. The gate's own failure lists are not among them: there an id is being compared
 *  against an expected id, and the prefix is the whole of what the reader is checking. @public */
export function corpusLabel(corpus: string): string {
  return CORPUS_LABELS[corpus as Corpus] ?? corpus;
}

/** What a search may be narrowed by. @public */
export interface SearchOptions {
  /** One corpus; omit for all of them. Typed rather than a string, so an internal caller cannot
   *  reach SQL with a spelling no row carries and get an empty result read as an answer. */
  corpus?: Corpus;
  /** A whole path or a directory of them, matched on the segment boundary and never as a pattern. */
  path?: string;
  /** Maximum hits. Defaults to 10. */
  limit?: number;
  /** Minimum coverage a hit must carry. Defaults to `FLOOR`; 0 disables the floor entirely. */
  floor?: number;
  /** The bridge table this repository is served. Defaults to every bridge in the file — correct for
   *  a caller with no tree in hand, and wrong for one that has it, since a bridge aimed at a
   *  vocabulary this corpus lacks is noise on every query that triggers it. */
  aliases?: AliasTable;
  /** Fill each hit's `excerpt`. Defaults to false, because `body` is the largest column in the
   *  table and the callers that only read an id would pull hundreds of verbatim sections per gate
   *  run for output nobody prints. */
  excerpt?: boolean;
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
 *  **Calibrated, not chosen.** Across the golden set the expected hit earns 0.430 at worst; across
 *  the negative set the best hit anywhere in the pool earns 0.338. This sits between them. The
 *  `warden:queries` gate step reports both figures every run and holds the gap to `MARGIN`, so the
 *  room this has left is guarded rather than watched — move this only with that summary in hand, and
 *  add the query that forced the move to whichever set it belongs to.
 *
 *  The measurement that matters is the **peak** coverage in the pool, not the top-ranked hit's:
 *  BM25 decides the order and coverage decides admission, so the hit that survives a floor is often
 *  not the one BM25 put first. A calibration that reads `hits[0]` understates what the floor has to
 *  refuse. @public */
export const FLOOR = 0.35;

/** The least room `FLOOR` may have between the thinnest answer and the loudest refusal.
 *
 *  **A guard, not a target.** The window was 0.084 when the floor was set and had halved to 0.049
 *  before anything asserted on it, because the gate printed the figure and checked nothing. Below
 *  this, one document either way decides whether a refusal holds, and the next corpus addition
 *  closes it by accident. `warden:queries` warns in `standard` and fails in `full`: a warning on
 *  every run is trained-to-ignore within a week, and a daily failure for a figure that moves with
 *  the corpus is worse.
 *
 *  **What the first firing found was a bad query, not a thin corpus.** `response length narration to
 *  a person` expected `PLAIN_LANGUAGE.md#8`, which is titled "Response Length and Proportion" and
 *  carries neither `narration` nor `person` — so it could never earn above the 0.389 its own two
 *  matching words were worth. Splitting it in two put the window at 0.093. Read a firing as "which
 *  entry is asking for something its answer does not say", before reading it as a floor to move. @public */
export const MARGIN = 0.05;

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
  const match = matchExpression(query, options.aliases);
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
    options.aliases,
  );

  const ranked = rows
    .map((row) => ({
      rowid: row.rowid,
      hit: {
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
      },
    }))
    .filter((entry) => entry.hit.coverage >= floor)
    .sort((a, b) => rank(b.hit) - rank(a.hit) || (a.hit.id < b.hit.id ? -1 : 1))
    .slice(0, limit);

  if (options.excerpt !== true) return ranked.map((entry) => entry.hit);
  return excerpts(db, ranked, query, options.aliases);
}

/** Fills each survivor's `excerpt` from a second read of the ordinary `chunk` table.
 *
 *  **Run strictly after the slice, and that is what makes it inert.** It reads `chunk` and never
 *  `chunk_fts`, so `bm25()` is not re-evaluated and nothing about the ranking or its determinism
 *  can move — hoisting it above the slice would silently destroy that property while still
 *  compiling. It also keeps the read to at most `limit` rows rather than the whole 60-deep pool.
 *
 *  Keyed on `rowid` into a map, never zipped by position: `WHERE rowid IN (…)` returns rows in
 *  SQLite's order and not the hits', and bun:sqlite has no array binding to make one query per hit
 *  unnecessary. */
function excerpts(db: Database, ranked: readonly { rowid: number; hit: Hit }[], query: string, aliases: AliasTable | undefined): Hit[] {
  if (ranked.length === 0) return [];
  const rowids = ranked.map((entry) => entry.rowid);
  const sources = db
    .query<{ rowid: number; rules: string; body: string }>(
      `SELECT rowid, rules, body FROM chunk WHERE rowid IN (${rowids.map(() => "?").join(", ")})`,
    )
    .all(...rowids);
  const byRowid = new Map(sources.map((source) => [source.rowid, source]));
  return ranked.map((entry) => {
    const source = byRowid.get(entry.rowid);
    const { hit } = entry;
    return {
      ...hit,
      excerpt: excerptOf({ title: hit.title, gloss: hit.gloss, rules: source?.rules ?? "", body: source?.body ?? "" }, query, aliases),
    };
  });
}
