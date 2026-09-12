import { CliError } from "../../cli/errors";
import type { CreateTableParts, SqlLiteralRule, SqlToken, SqlTokenKind, TableBodyClause } from "./types";

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WORD_START = /[A-Za-z_0-9$]/;
const WORD_CHAR = /[A-Za-z0-9_$.]/;
const TWO_CHAR_OPERATORS = new Set(["||", "<=", ">=", "<>", "!=", "==", "<<", ">>"]);

function closingQuote(sql: string, from: number, quote: string): number {
  let i = from + 1;
  while (i < sql.length) {
    if (sql[i] !== quote) {
      i += 1;
      continue;
    }
    if (sql[i + 1] === quote) {
      i += 2;
      continue;
    }
    return i + 1;
  }
  return sql.length;
}

/** Cuts SQL into tokens, treating a comment, a string literal and a quoted identifier each as one token. @internal */
export function scanSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  const push = (kind: SqlTokenKind, end: number): void => {
    tokens.push({ kind, text: sql.slice(i, end), start: i, end });
    i = end;
  };
  while (i < sql.length) {
    const c = sql[i] ?? "";
    const pair = sql.slice(i, i + 2);
    if (pair === "--") {
      const nl = sql.indexOf("\n", i);
      push("comment", nl === -1 ? sql.length : nl);
    } else if (pair === "/*") {
      const close = sql.indexOf("*/", i + 2);
      push("comment", close === -1 ? sql.length : close + 2);
    } else if (c === "'") {
      push("string", closingQuote(sql, i, "'"));
    } else if (c === '"' || c === "`") {
      push("identifier", closingQuote(sql, i, c));
    } else if (c === "[") {
      const close = sql.indexOf("]", i + 1);
      push("identifier", close === -1 ? sql.length : close + 1);
    } else if (/\s/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /\s/.test(sql[j] ?? "")) j += 1;
      push("space", j);
    } else if (WORD_START.test(c)) {
      let j = i + 1;
      while (j < sql.length && WORD_CHAR.test(sql[j] ?? "")) j += 1;
      push("word", j);
    } else if (TWO_CHAR_OPERATORS.has(pair)) {
      push("punct", i + 2);
    } else {
      push("punct", i + 1);
    }
  }
  return tokens;
}

/** Replaces every comment and string literal — and, when asked, every quoted identifier — with spaces, keeping each newline so line numbers hold. @internal */
export function maskSqlProse(sql: string, options: { identifiers?: boolean } = {}): string {
  const out = sql.split("");
  for (const token of scanSql(sql)) {
    if (token.kind !== "comment" && token.kind !== "string" && !(options.identifiers === true && token.kind === "identifier")) continue;
    for (let i = token.start; i < token.end; i += 1) if (out[i] !== "\n") out[i] = " ";
  }
  return out.join("");
}

/** The name a quoted or bare identifier token denotes. @internal */
export function unquoteSqlIdentifier(token: string): string {
  const first = token[0];
  if (first === '"' || first === "`") {
    const inner = token.endsWith(first) && token.length > 1 ? token.slice(1, -1) : token.slice(1);
    return inner.replaceAll(first + first, first);
  }
  if (first === "[") return token.endsWith("]") ? token.slice(1, -1) : token.slice(1);
  return token;
}

/** The one spelling every identifier is compared under: upper-cased, and double-quoted unless it is simple. @internal */
export function normalizeSqlIdentifier(name: string): string {
  return SIMPLE_IDENTIFIER.test(name) ? name.toUpperCase() : `"${name.toUpperCase().replaceAll('"', '""')}"`;
}

/** The key two identifiers share when SQLite would treat them as one name — what every map and set of names is keyed by. @internal */
export function sqlIdentifierKey(name: string): string {
  return name.toLowerCase();
}

/** True when two identifiers name the same object, which SQLite decides without regard to ASCII case. @internal */
export function sqlIdentifierEquals(a: string, b: string): boolean {
  return sqlIdentifierKey(a) === sqlIdentifierKey(b);
}

/** The token offsets of every double-quoted token SQLite may read as a string literal: each one under `"verbatim"`, else those in a `DEFAULT` or `CHECK` that name no known column. */
function literalQuotedTokens(tokens: readonly SqlToken[], literals: SqlLiteralRule): Set<number> {
  const found = new Set<number>();
  const quoted = (token: SqlToken) => token.kind === "identifier" && token.text.startsWith('"');
  const columns = literals === "verbatim" ? null : new Set([...literals].map(sqlIdentifierKey));
  const mark = (index: number, token: SqlToken) => {
    if (quoted(token) && (columns === null || !columns.has(sqlIdentifierKey(unquoteSqlIdentifier(token.text))))) found.add(index);
  };
  if (literals === "verbatim") {
    for (const [index, token] of tokens.entries()) mark(index, token);
    return found;
  }
  const spoken = [...tokens.entries()].filter(([, token]) => token.kind !== "comment" && token.kind !== "space");
  for (const [at, entry] of spoken.entries()) {
    const word = entry[1].text.toUpperCase();
    if (entry[1].kind !== "word" || (word !== "DEFAULT" && word !== "CHECK")) continue;
    let next = at + 1;
    while (spoken[next]?.[1].kind === "punct" && ["+", "-"].includes(spoken[next]?.[1].text ?? "")) next += 1;
    const head = spoken[next];
    if (head === undefined) continue;
    if (head[1].text !== "(") {
      mark(head[0], head[1]);
      continue;
    }
    let depth = 0;
    for (let i = next; i < spoken.length; i += 1) {
      const [index, token] = spoken[i] as [number, SqlToken];
      if (token.kind === "identifier") mark(index, token);
      else if (token.kind !== "punct") continue;
      else if (token.text === "(") depth += 1;
      else if (token.text === ")" && (depth -= 1) === 0) break;
    }
  }
  return found;
}

function normalizedTokens(tokens: readonly SqlToken[], literals: SqlLiteralRule): string[] {
  const out: string[] = [];
  const literal = literalQuotedTokens(tokens, literals);
  for (const [index, token] of tokens.entries()) {
    if (token.kind === "comment" || token.kind === "space") continue;
    if (token.kind === "identifier" && literal.has(index)) out.push(token.text);
    else if (token.kind === "identifier") out.push(normalizeSqlIdentifier(unquoteSqlIdentifier(token.text)));
    else if (token.kind === "word") out.push(token.text.toUpperCase());
    else out.push(token.text);
  }
  // `IF NOT EXISTS` is what SQLite itself drops from `sqlite_master`, so a file that writes it and a database that stored it agree.
  for (let i = 0; i + 2 < out.length; i += 1) {
    if (out[i] === "IF" && out[i + 1] === "NOT" && out[i + 2] === "EXISTS") out.splice(i, 3);
  }
  while (out.length > 0 && out[out.length - 1] === ";") out.pop();
  return out;
}

function joinTokens(parts: readonly string[]): string {
  let text = "";
  let previous = "";
  for (const part of parts) {
    const tight =
      text === "" || part === "," || part === ")" || part === ";" || part === "." || part === "(" || previous === "(" || previous === ".";
    text += tight ? part : ` ${part}`;
    previous = part;
  }
  return text;
}

/** DDL with comments gone, whitespace collapsed, identifiers in one quoting, keywords upper-cased, `IF NOT EXISTS` and the trailing `;` dropped; a double-quoted token SQLite may read as a string literal stays as written. @internal */
export function normalizeDdlText(sql: string, options: { literals?: SqlLiteralRule } = {}): string {
  return joinTokens(normalizedTokens(scanSql(sql), options.literals ?? new Set()));
}

/** Comments removed and whitespace collapsed, and otherwise the author's own text. @internal */
export function stripSqlComments(sql: string): string {
  return scanSql(sql)
    .filter((token) => token.kind !== "comment")
    .map((token) => (token.kind === "space" ? " " : token.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const CONSTRAINT_LEADS = new Set(["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"]);

/** Splits a `CREATE TABLE` body at its depth-0 commas, classing each clause as a column or a constraint; `literals` names the table's own columns, so a quoted token in a DEFAULT or CHECK that is one is folded rather than kept. @internal */
export function splitCreateTableBody(sql: string, options: { literals?: SqlLiteralRule } = {}): CreateTableParts {
  const tokens = scanSql(sql);
  const open = tokens.find((token) => token.kind === "punct" && token.text === "(");
  if (open === undefined)
    throw new CliError(
      "invalid-args",
      `no column list in \`${sql.slice(0, 60)}…\` — a table created AS SELECT has no declared shape to compose against`,
    );

  const clauses: TableBodyClause[] = [];
  let depth = 0;
  let clauseStart = open.end;
  let close = -1;
  for (const token of tokens) {
    if (token.start < open.start || token.kind !== "punct") continue;
    if (token.text === "(") depth += 1;
    else if (token.text === ")") {
      depth -= 1;
      if (depth === 0) {
        close = token.start;
        break;
      }
    } else if (token.text === "," && depth === 1) {
      clauses.push(clause(sql.slice(clauseStart, token.start), options));
      clauseStart = token.end;
    }
  }
  if (close === -1) throw new CliError("invalid-args", `unbalanced parentheses in \`${sql.slice(0, 60)}…\``);
  clauses.push(clause(sql.slice(clauseStart, close), options));
  return { open: open.start, close, clauses, options: normalizeDdlText(sql.slice(close + 1)) };
}

function clause(raw: string, options: { literals?: SqlLiteralRule }): TableBodyClause {
  const lead = scanSql(raw).find((token) => token.kind !== "space" && token.kind !== "comment");
  const constraint = lead !== undefined && lead.kind === "word" && CONSTRAINT_LEADS.has(lead.text.toUpperCase());
  return { kind: constraint ? "constraint" : "column", raw, source: stripSqlComments(raw), normalized: normalizeDdlText(raw, options) };
}

const OBJECT_TYPES = new Set(["TABLE", "INDEX", "TRIGGER", "VIEW"]);
const CREATE_MODIFIERS = new Set(["TEMP", "TEMPORARY", "UNIQUE", "VIRTUAL"]);

function bareName(token: SqlToken): string {
  return token.kind === "word" ? (token.text.split(".").pop() ?? token.text) : unquoteSqlIdentifier(token.text);
}

/** The object a possibly schema-qualified name at `index` denotes, with the text span the whole name covers. @internal */
export function readQualifiedObjectName(tokens: readonly SqlToken[], index: number): { name: string; start: number; end: number } | null {
  const first = tokens[index];
  if (first === undefined || (first.kind !== "word" && first.kind !== "identifier")) return null;
  // `main.users` scans as one word, `main."users"` as the word `main.` and a name, `"main".users` as three tokens.
  const trailing = first.kind === "word" && first.text.endsWith(".");
  const after = tokens[index + (trailing ? 1 : 2)];
  const qualified = trailing || (first.kind === "identifier" && tokens[index + 1]?.text === ".");
  if (qualified && after !== undefined && (after.kind === "word" || after.kind === "identifier"))
    return { name: bareName(after), start: first.start, end: after.end };
  if (trailing) return null;
  return { name: bareName(first), start: first.start, end: first.end };
}

/** Every object a piece of DDL creates, by type and name, read from its `CREATE` statements. @internal */
export function declaredObjectNames(sql: string): { type: string; name: string }[] {
  const tokens = scanSql(sql).filter((token) => token.kind !== "comment" && token.kind !== "space");
  const found: { type: string; name: string }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.kind !== "word" || tokens[i]?.text.toUpperCase() !== "CREATE") continue;
    let j = i + 1;
    while (tokens[j]?.kind === "word" && CREATE_MODIFIERS.has(tokens[j]?.text.toUpperCase() ?? "")) j += 1;
    const type = tokens[j]?.text.toUpperCase() ?? "";
    if (tokens[j]?.kind !== "word" || !OBJECT_TYPES.has(type)) continue;
    j += 1;
    if (tokens[j]?.text.toUpperCase() === "IF" && tokens[j + 1]?.text.toUpperCase() === "NOT" && tokens[j + 2]?.text.toUpperCase() === "EXISTS")
      j += 3;
    const name = readQualifiedObjectName(tokens, j);
    if (name === null) continue;
    found.push({ type: type.toLowerCase(), name: name.name });
  }
  return found;
}

/** True when normalized DDL refers to `name` as a whole identifier — bare, or double-quoted in any case — and not as part of a longer one. @internal */
export function mentionsSqlIdentifier(normalized: string, name: string): boolean {
  for (const token of scanSql(normalized)) {
    if (token.kind === "identifier" && sqlIdentifierEquals(unquoteSqlIdentifier(token.text), name)) return true;
  }
  const spelled = normalizeSqlIdentifier(name);
  if (spelled.startsWith('"')) return false;
  const pattern = new RegExp(`(^|[^A-Z0-9_"])${spelled.replace(/[$]/g, "\\$")}($|[^A-Z0-9_"])`);
  return pattern.test(normalized);
}
