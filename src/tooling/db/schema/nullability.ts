import { bareSqlName, scanSql, sqlIdentifierKey, unquoteSqlIdentifier } from "./normalize";
import type { SqlToken } from "./types";

/** The tokens of `sql` a statement is spoken in — no space, no comment — each offset by `base`. @internal */
export function spokenSqlTokens(sql: string, base = 0): SqlToken[] {
  return scanSql(sql)
    .filter((token) => token.kind !== "space" && token.kind !== "comment")
    .map((token) => ({ ...token, start: token.start + base, end: token.end + base }));
}

/** Whether `token` is the keyword `word`, given in upper case. @internal */
export function isSqlWord(token: SqlToken | undefined, word: string): boolean {
  return token?.kind === "word" && token.text.toUpperCase() === word;
}

function isPunct(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === "punct" && token.text === text;
}

/** Whether `token` can name an object: a bare word or a quoted identifier. @internal */
export function isSqlName(token: SqlToken | undefined): token is SqlToken {
  return token?.kind === "word" || token?.kind === "identifier";
}

/** Whether `PRIMARY KEY` starts at `tokens[i]`. @internal */
export function isSqlPrimaryKeyAt(tokens: readonly SqlToken[], i: number): boolean {
  return isSqlWord(tokens[i], "PRIMARY") && isSqlWord(tokens[i + 1], "KEY");
}

// The index of the `)` closing the `(` at `open`, or the end of `tokens` when it is never closed.
function closingParen(tokens: readonly SqlToken[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (isPunct(tokens[i], "(")) depth += 1;
    else if (isPunct(tokens[i], ")") && (depth -= 1) === 0) return i;
  }
  return tokens.length;
}

// A column's own `NOT NULL` and `PRIMARY KEY` are never parenthesised; a CHECK body, a `DEFAULT (…)` and an `AS (…)` are.
function depthZero(tokens: readonly SqlToken[]): SqlToken[] {
  const out: SqlToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (isPunct(tokens[i], "(")) i = closingParen(tokens, i);
    else out.push(tokens[i] as SqlToken);
  }
  return out;
}

/** Each element of `tokens` split at a top-level `separator`, a word or a punctuation mark. @internal */
export function splitSqlAtDepthZero(tokens: readonly SqlToken[], separator: string): SqlToken[][] {
  const parts: SqlToken[][] = [[]];
  for (let i = 0; i < tokens.length; i += 1) {
    if (isSqlWord(tokens[i], separator) || isPunct(tokens[i], separator)) parts.push([]);
    else {
      const end = isPunct(tokens[i], "(") ? closingParen(tokens, i) : i;
      parts[parts.length - 1]?.push(...tokens.slice(i, end + 1));
      i = end;
    }
  }
  return parts;
}

function checkBodies(tokens: readonly SqlToken[]): SqlToken[][] {
  return tokens.flatMap((token, i) => {
    if (!isSqlWord(token, "CHECK") || !isPunct(tokens[i + 1], "(")) return [];
    return [tokens.slice(i + 2, closingParen(tokens, i + 1))];
  });
}

function unwrapped(tokens: readonly SqlToken[]): readonly SqlToken[] {
  let inner = tokens;
  while (isPunct(inner[0], "(") && closingParen(inner, 0) === inner.length - 1) inner = inner.slice(1, -1);
  return inner;
}

// The column `tokens[from…to)` names, qualified or quoted, or `null` when they are not exactly one name.
function namedColumn(tokens: readonly SqlToken[], from: number, to: number): string | null {
  const last = tokens[to - 1];
  if (to <= from || (to - from) % 2 === 0 || last === undefined) return null;
  for (let i = from; i < to; i += 1) if ((i - from) % 2 === 0 ? !isSqlName(tokens[i]) : !isPunct(tokens[i], ".")) return null;
  return bareSqlName(last);
}

// The column one conjunct holds NOT NULL, read only from `col IS NOT NULL`, `col NOT NULL`, `col NOTNULL` or `NOT col IS NULL` exactly.
function conjunctNotNull(tokens: readonly SqlToken[]): string | null {
  const n = tokens.length;
  const ends = (...words: string[]) => words.every((word, i) => isSqlWord(tokens[n - words.length + i], word));
  if (isSqlWord(tokens[0], "NOT") && ends("IS", "NULL")) return namedColumn(tokens, 1, n - 2);
  if (ends("IS", "NOT", "NULL")) return namedColumn(tokens, 0, n - 3);
  if (ends("NOT", "NULL")) return namedColumn(tokens, 0, n - 2);
  if (ends("NOTNULL")) return namedColumn(tokens, 0, n - 1);
  return null;
}

// The columns a CHECK body holds NOT NULL in every row, read from its top-level `AND` conjuncts only: an `OR`
// at the top admits a row through its other side, and any other shape is left to the purge's runtime floor.
function checkHoldsNotNull(body: readonly SqlToken[]): string[] {
  const expression = unwrapped(body);
  if (depthZero(expression).some((token) => isSqlWord(token, "OR"))) return [];
  const conjuncts = splitSqlAtDepthZero(expression, "AND");
  if (conjuncts.length > 1) return conjuncts.flatMap(checkHoldsNotNull);
  const held = conjunctNotNull(expression);
  return held === null ? [] : [held];
}

/** The columns the CHECK bodies of `tokens` hold NOT NULL in every row. @internal */
export function sqlCheckNullRefusals(tokens: readonly SqlToken[]): string[] {
  return checkBodies(tokens).flatMap(checkHoldsNotNull);
}

/** The columns one column definition refuses NULL in: its own, by `NOT NULL` or `PRIMARY KEY`, and any its CHECK holds NOT NULL. @internal */
export function sqlColumnNullRefusals(tokens: readonly SqlToken[]): string[] {
  const head = tokens[0];
  if (head === undefined) return [];
  const top = depthZero(tokens.slice(1));
  const own = top.some((token, i) => (isSqlWord(token, "NOT") && isSqlWord(top[i + 1], "NULL")) || isSqlPrimaryKeyAt(top, i));
  return [...(own ? [unquoteSqlIdentifier(head.text)] : []), ...sqlCheckNullRefusals(tokens)];
}

/** Whether one column definition refuses NULL in the column it defines. @internal */
export function sqlColumnRefusesOwnNull(tokens: readonly SqlToken[]): boolean {
  const head = tokens[0];
  if (head === undefined) return false;
  const name = sqlIdentifierKey(unquoteSqlIdentifier(head.text));
  return sqlColumnNullRefusals(tokens).some((held) => sqlIdentifierKey(held) === name);
}

/** Whether one column definition carries a `DEFAULT` other than `DEFAULT NULL`, which leaves existing rows NULL. @internal */
export function sqlColumnHasNonNullDefault(tokens: readonly SqlToken[]): boolean {
  const keyword = depthZero(tokens).find((token) => isSqlWord(token, "DEFAULT"));
  if (keyword === undefined) return false;
  const value = tokens[tokens.indexOf(keyword) + 1];
  return value !== undefined && !isSqlWord(value, "NULL");
}
