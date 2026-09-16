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
  /** One line a reader can judge this hit by, present only when `SearchOptions.excerpt` asked for it. */
  excerpt?: string;
}

/** The words each corpus is named by in a rendered hit. */
const CORPUS_LABELS: Record<Corpus, string> = {
  canon: "fleet canon",
  project: "this repository",
  dependency: "installed @y-core/forge (advisory)",
};

/** Which corpus a section belongs to, in words rather than as an id prefix. @public */
export function corpusLabel(corpus: string): string {
  return CORPUS_LABELS[corpus as Corpus] ?? corpus;
}

/** What a search may be narrowed by. @public */
export interface SearchOptions {
  /** One corpus; omit for all of them. */
  corpus?: Corpus;
  /** A whole path or a directory of them, matched on the segment boundary and never as a pattern. */
  path?: string;
  /** Maximum hits. Defaults to 10. */
  limit?: number;
  /** Minimum coverage a hit must carry. Defaults to `FLOOR`; 0 disables the floor entirely. */
  floor?: number;
  /** The bridge table this repository is served. Defaults to every bridge in the file. */
  aliases?: AliasTable;
  /** Fill each hit's `excerpt`. Defaults to false. */
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

/** The least of a query's information a hit may carry and still be offered as an answer. @public */
export const FLOOR = 0.35;

/** The least room `FLOOR` may have between the thinnest answer and the loudest refusal. @public */
export const MARGIN = 0.05;

/** How many candidates are scored for coverage before the floor and the limit are applied. */
const POOL = 60;

/** The share of a hit's rank that BM25 keeps outright, the rest being scaled by coverage. */
const BM25_SHARE = 0.6;

/** A literal for a `LIKE ... ESCAPE '\'` pattern: a caller's `%` and `_` are data, not wildcards. */
function likeLiteral(value: string): string {
  // The escape character is escaped first: doing it last would re-escape the backslash that
  // escaping `%` had just introduced.
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** One hit's final rank: its BM25 score, the coverage-scaled part of it earned rather than given. */
function rank(hit: { score: number; coverage: number }): number {
  return hit.score * (BM25_SHARE + (1 - BM25_SHARE) * hit.coverage);
}

/** BM25 over the FTS index, scaled by the document's path-derived weight, then held to a floor. @public */
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

  // The `chunk.id ASC` tie-break is what keeps a golden-query test deterministic: two chunks
  // scoring identically would otherwise swap on any change to insertion order.
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

/** Fills each survivor's `excerpt` from a second read of the ordinary `chunk` table. */
function excerpts(db: Database, ranked: readonly { rowid: number; hit: Hit }[], query: string, aliases: AliasTable | undefined): Hit[] {
  if (ranked.length === 0) return [];
  const rowids = ranked.map((entry) => entry.rowid);
  const sources = db
    .query<{ rowid: number; rules: string; body: string }>(
      `SELECT rowid, rules, body FROM chunk WHERE rowid IN (${rowids.map(() => "?").join(", ")})`,
    )
    .all(...rowids);
  // Keyed rather than zipped by position: `WHERE rowid IN (…)` returns rows in SQLite's order, not
  // the hits'.
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
