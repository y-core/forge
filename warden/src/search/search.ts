import type { Database } from "bun:sqlite";

import { COLUMN_WEIGHTS } from "../index/schema";
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
}

/** What a search may be narrowed by. @public */
export interface SearchOptions {
  /** `canon` or `local`; omit for both. */
  corpus?: string;
  /** `shared`, `libs` or `apps`; omit for every tree indexed. */
  tree?: string;
  /** A path prefix, so a reader can scope to `docs/` or one document. */
  path?: string;
  /** Maximum hits. Defaults to 10. */
  limit?: number;
}

interface Row {
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

/** BM25 over the FTS index, scaled by the document's path-derived weight.
 *
 *  The tie-break on `chunk.id ASC` is not cosmetic: it is what makes a golden-query test a test
 *  rather than a coin flip, since two chunks scoring identically would otherwise swap on any
 *  change to insertion order. @public */
export function search(db: Database, query: string, options: SearchOptions = {}): Hit[] {
  const match = matchExpression(query);
  if (match === "") return [];

  const filters: string[] = [];
  const params: unknown[] = [match];
  if (options.corpus !== undefined) {
    filters.push("source.corpus = ?");
    params.push(options.corpus);
  }
  if (options.tree !== undefined) {
    filters.push("source.tree = ?");
    params.push(options.tree);
  }
  if (options.path !== undefined) {
    filters.push("source.path LIKE ?");
    params.push(`${options.path}%`);
  }
  params.push(options.limit ?? 10);

  const sql = `
    SELECT chunk.id, source.corpus, source.tree, source.path, chunk.section, chunk.title,
           chunk.heading_path, chunk.gloss,
           (-bm25(chunk_fts, ${COLUMN_WEIGHTS.join(", ")})) * source.weight AS score
    FROM chunk_fts
    JOIN chunk ON chunk.rowid = chunk_fts.rowid
    JOIN source ON source.id = chunk.source_id
    WHERE chunk_fts MATCH ?${filters.length === 0 ? "" : ` AND ${filters.join(" AND ")}`}
    ORDER BY score DESC, chunk.id ASC
    LIMIT ?`;

  return db
    .query<Row>(sql)
    .all(...params)
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
    }));
}
