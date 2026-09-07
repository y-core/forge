import type { Database } from "bun:sqlite";

import { ALIASES } from "./aliases";
import { terms as queryTerms } from "./query";

/** A bridge term stands in for a word the reader did not type, so it earns a fraction of that
 *  word's weight — the same standing the match expression already gives it. */
const BRIDGE_CREDIT = 0.5;

/** Quotes one term as an FTS5 string literal, so no term can be read as syntax. */
function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** What a term the corpus has never seen is worth, as a multiple of the rarest term it has.
 *
 *  Absence is not just rarity. `ln(1 + N/(1 + df))` barely separates a term in one chunk from a term
 *  in none — 6.4 against 7.0 — but the two mean different things: one is a corner of the corpus, the
 *  other is a concept it has no vocabulary for at all. Doubling is what makes `zarquon invariant`
 *  fall away from the questions this corpus does answer instead of sitting beside them. */
const ABSENT_PENALTY = 2;

/** How rare a term is, in nats. A term the corpus has never seen scores highest of all, which is
 *  the whole point: it is the term that proves the question was not asked of this corpus. @public */
export function idf(total: number, df: number): number {
  const rarity = Math.log(1 + total / (1 + df));
  return df === 0 ? rarity * ABSENT_PENALTY : rarity;
}

/** How many chunks carry `term`, read through the index's own tokenizer — so `returning` and
 *  `return` are one term here exactly as they are in a search. @public */
export function documentFrequency(db: Database, term: string): number {
  return db.query<{ n: number }>("SELECT count(*) AS n FROM chunk_fts WHERE chunk_fts MATCH ?").get(quote(term))?.n ?? 0;
}

/** Every rowid matching `expression`, as one posting-list read.
 *
 *  FTS5 does not push a `rowid IN (…)` restriction into the match, so narrowing the SQL to the
 *  candidate pool costs the same full scan and buys nothing — reading the list once and
 *  intersecting in memory is the same answer for a fraction of the work. */
function matching(db: Database, expression: string): number[] {
  const rows = db.query<{ rowid: number }>("SELECT rowid FROM chunk_fts WHERE chunk_fts MATCH ?").all(expression);
  return rows.map((row) => row.rowid);
}

/** The share of a query's information each candidate chunk actually carries, from 0 to 1.
 *
 *  **This is what separates "the corpus answers this" from "the corpus contains these words".**
 *  BM25 ranks candidates against each other and says nothing about whether the best of them is any
 *  good, so a question the corpus has never heard of still returns a full page of confident hits —
 *  matched on whichever of its words happen to be common. Weighting each term by its rarity and
 *  asking what fraction of that weight a chunk earns answers the question BM25 cannot: a chunk that
 *  matched only `invariant`, from a query about `zarquon invariant`, has covered almost nothing.
 *
 *  A term the corpus has never seen is scored at maximum rarity and can be earned by nobody, so it
 *  drags every candidate down — which is the correct verdict, not a defect. @public */
export function coverage(db: Database, query: string, rowids: readonly number[]): Map<number, number> {
  const scores = new Map(rowids.map((rowid) => [rowid, 0]));
  const typed = queryTerms(query);
  if (typed.length === 0 || rowids.length === 0) return scores;

  const total = db.query<{ n: number }>("SELECT count(*) AS n FROM chunk").get()?.n ?? 0;
  let whole = 0;

  const pool = new Set(rowids);

  for (const term of typed) {
    // One read serves both the term's rarity and its share of the pool: the posting list is the
    // same list either way, so `documentFrequency` would only scan it a second time.
    const carriers = matching(db, quote(term));
    const weight = idf(total, carriers.length);
    whole += weight;

    const own = new Set(carriers.filter((rowid) => pool.has(rowid)));
    const aliases = ALIASES.get(term.toLowerCase()) ?? [];
    const bridged =
      aliases.length === 0 ? new Set<number>() : new Set(matching(db, aliases.map(quote).join(" OR ")).filter((rowid) => pool.has(rowid)));

    for (const rowid of rowids) {
      const earned = own.has(rowid) ? weight : bridged.has(rowid) ? weight * BRIDGE_CREDIT : 0;
      if (earned > 0) scores.set(rowid, (scores.get(rowid) ?? 0) + earned);
    }
  }

  if (whole === 0) return scores;
  for (const rowid of rowids) scores.set(rowid, (scores.get(rowid) ?? 0) / whole);
  return scores;
}
