import { type AliasTable, aliasTerms } from "./aliases";

// The tokenizer keeps `-_/.§` inside a term, so a query term may legitimately carry them. Anything
// else is punctuation FTS5 would read as syntax, and is dropped rather than escaped.
const TERM = /[A-Za-z0-9§][A-Za-z0-9\-_/.§]*/g;

/** English words that carry no lexical signal in a corpus of technical rules — every document has
 *  them, so keeping them costs recall on the terms that matter. */
const STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

/** The terms a query contributes, in the order typed, stop words removed. @public */
export function terms(query: string): string[] {
  // A term never ends in punctuation, whatever the reader typed: the index strips sentence
  // punctuation too, so `budget.` and `budget` have to be the same term on both sides.
  const found = [...query.matchAll(TERM)].map((match) => match[0].replace(/[.,;:!?]+$/, "")).filter((term) => term !== "");
  const kept = found.filter((term) => !STOP.has(term.toLowerCase()));
  // A query that is nothing but stop words still has to match something.
  return kept.length > 0 ? kept : found;
}

/** Quotes one term as an FTS5 string literal, so no term can be read as syntax. */
function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** Builds the MATCH expression: the reader's own terms OR-ed, then the alias bridges at low weight.
 *
 *  `^` is not used and no term is required — an AND query over a corpus this small returns nothing
 *  far more often than it returns the right thing, and BM25 already ranks a chunk carrying every
 *  term above one carrying a single term. @public */
export function matchExpression(query: string, aliases?: AliasTable): string {
  const typed = terms(query);
  if (typed.length === 0) return "";
  const own = typed.map((term) => `${quote(term)}`);
  const bridges = aliasTerms(typed, aliases).map((term) => quote(term));
  const clause = own.join(" OR ");
  // A bridge is worth a fraction of a typed term: it recovers a paraphrase without ever outranking
  // the words the reader actually chose.
  return bridges.length === 0 ? clause : `${clause} OR (${bridges.join(" OR ")})`;
}
