import type { Database } from "bun:sqlite";

import { type AliasTable, ALIASES } from "./aliases";
import { terms as queryTerms } from "./query";

/** The fraction of a typed word's weight a bridge term earns in its place. */
const BRIDGE_CREDIT = 0.5;

/** Quotes one term as an FTS5 string literal, so no term can be read as syntax. */
function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** What a term the corpus has never seen is worth, as a multiple of the rarest term it has. */
const ABSENT_PENALTY = 2;

/** How rare a term is, in nats — a term the corpus has never seen scoring highest of all. @public */
export function idf(total: number, df: number): number {
  const rarity = Math.log(1 + total / (1 + df));
  return df === 0 ? rarity * ABSENT_PENALTY : rarity;
}

/** How many chunks carry `term`, read through the index's own tokenizer. @public */
export function documentFrequency(db: Database, term: string): number {
  return db.query<{ n: number }>("SELECT count(*) AS n FROM chunk_fts WHERE chunk_fts MATCH ?").get(quote(term))?.n ?? 0;
}

/** Every rowid matching `expression`, as one posting-list read. */
function matching(db: Database, expression: string): number[] {
  // FTS5 does not push a `rowid IN (…)` restriction into the match, so narrowing the SQL to the
  // candidate pool costs the same full scan; the list is read once and intersected in memory.
  const rows = db.query<{ rowid: number }>("SELECT rowid FROM chunk_fts WHERE chunk_fts MATCH ?").all(expression);
  return rows.map((row) => row.rowid);
}

/** The share of a query's information each candidate chunk actually carries, from 0 to 1. @public */
export function coverage(db: Database, query: string, rowids: readonly number[], aliases: AliasTable = ALIASES): Map<number, number> {
  const scores = new Map(rowids.map((rowid) => [rowid, 0]));
  const typed = queryTerms(query);
  if (typed.length === 0 || rowids.length === 0) return scores;

  const total = db.query<{ n: number }>("SELECT count(*) AS n FROM chunk").get()?.n ?? 0;
  let whole = 0;

  const pool = new Set(rowids);

  for (const term of typed) {
    const carriers = matching(db, quote(term));
    const weight = idf(total, carriers.length);
    whole += weight;

    const own = new Set(carriers.filter((rowid) => pool.has(rowid)));
    const bridges = aliases.get(term.toLowerCase()) ?? [];
    const bridged =
      bridges.length === 0 ? new Set<number>() : new Set(matching(db, bridges.map(quote).join(" OR ")).filter((rowid) => pool.has(rowid)));

    for (const rowid of rowids) {
      const earned = own.has(rowid) ? weight : bridged.has(rowid) ? weight * BRIDGE_CREDIT : 0;
      if (earned > 0) scores.set(rowid, (scores.get(rowid) ?? 0) + earned);
    }
  }

  if (whole === 0) return scores;
  for (const rowid of rowids) scores.set(rowid, (scores.get(rowid) ?? 0) / whole);
  return scores;
}
