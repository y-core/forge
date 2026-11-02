import type { SqlStatementSpan } from "./types";

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;

/** The index just past the quoted run opening at `index`, a doubled quote read as an escaped one. */
function pastQuoted(sql: string, index: number, quote: string): number {
  let at = index;
  do {
    const close = sql.indexOf(quote, at + 1);
    if (close === -1) return sql.length;
    at = close + 1;
  } while (sql[at] === quote);
  return at;
}

function pastMarker(sql: string, from: number, marker: string): number {
  const at = sql.indexOf(marker, from);
  return at === -1 ? sql.length : at + marker.length;
}

function opensTrigger(lead: readonly string[]): boolean {
  const [create, second, third] = lead;
  return create === "CREATE" && (second === "TRIGGER" || ((second === "TEMP" || second === "TEMPORARY") && third === "TRIGGER"));
}

/** Every fragment `sql` holds between statement boundaries, respecting quotes, comments and a trigger's `BEGIN … END` body, `CASE … END` inside it included. @internal */
export function sqlStatementSpans(sql: string): SqlStatementSpan[] {
  const spans: SqlStatementSpan[] = [];
  let start = 0;
  let index = 0;
  let depth = 0;
  let useful = false;
  let lead: string[] = [];
  const token = (word: string) => {
    useful = true;
    if (lead.length < 3) lead.push(word);
  };
  const finish = (end: number, terminated: boolean) => {
    spans.push({ start, end, terminated, useful });
    start = end + 1;
    depth = 0;
    useful = false;
    lead = [];
  };
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1];
    if (char === "'" || char === '"' || char === "`") {
      token("");
      index = pastQuoted(sql, index, char);
    } else if (char === "[") {
      token("");
      index = pastMarker(sql, index + 1, "]");
    } else if (char === "-" && next === "-") index = pastMarker(sql, index, "\n");
    else if (char === "/" && next === "*") index = pastMarker(sql, index + 2, "*/");
    else if (/[A-Za-z_]/.test(char)) {
      WORD.lastIndex = index;
      const word = (WORD.exec(sql)?.[0] ?? char).toUpperCase();
      token(word);
      if (word === "BEGIN" || word === "CASE") depth += 1;
      else if (word === "END") depth = Math.max(0, depth - 1);
      index += word.length;
    } else if (char === ";" && !(depth > 0 && opensTrigger(lead))) {
      finish(index, true);
      index += 1;
    } else {
      if (char !== ";" && !/\s/.test(char)) token("");
      index += 1;
    }
  }
  finish(sql.length, false);
  return spans;
}

/** Cuts a D1 dump into its statements, each keeping its `;`, dropping empty ones. @internal */
export function splitDumpStatements(sql: string): string[] {
  return sqlStatementSpans(sql)
    .map((span) => sql.slice(span.start, span.terminated ? span.end + 1 : span.end).trim())
    .filter((statement) => statement !== "" && statement !== ";");
}

/** The statements `sql` holds, trimmed and without their `;`, a fragment of only whitespace and comments dropped — the cut every local load runs. @internal */
export function cutSqlStatements(sql: string): string[] {
  return sqlStatementSpans(sql)
    .filter((span) => span.useful)
    .map((span) => sql.slice(span.start, span.end).trim());
}
