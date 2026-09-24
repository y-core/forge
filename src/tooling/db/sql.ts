import { maskSqlProse } from "./schema/normalize";
import type { ColumnInfo } from "./types";

export { INVENTORY_SELECT, toSchemaObjects } from "../../storage/db/schema";

/** Quotes a value as a SQL literal, doubling single quotes and refusing a NUL byte. @internal */
export function quoteSqlLiteral(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${String(value)} is not a finite number and has no SQL literal`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error(`the integer ${value} is past 2^53 and cannot round-trip as a literal`);
    }
    return String(value);
  }
  if (value.includes("\0")) throw new Error("a NUL byte cannot appear in a SQL string literal");
  return `'${value.replaceAll("'", "''")}'`;
}

/** The 1-based line a character offset falls on. @internal */
export function sqlLineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/** Quotes a table or column name as a SQL identifier, doubling double quotes. @internal */
export function quoteSqlIdentifier(name: string): string {
  if (name === "") throw new Error("an empty string is not a SQL identifier");
  if (name.includes("\0")) throw new Error("a NUL byte cannot appear in a SQL identifier");
  return `"${name.replaceAll('"', '""')}"`;
}

/** The statement that reads one table's columns, in declaration order. @internal */
export function tableInfoSelect(table: string): string {
  return `SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info(${quoteSqlLiteral(table)}) ORDER BY cid`;
}

/** The statement that reads one table's own `CREATE TABLE` text, under the column name `sql`. @internal */
export function tableSqlSelect(table: string): string {
  return `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${quoteSqlLiteral(table)}`;
}

/** Reads `tableInfoSelect` rows into column descriptions. @internal */
export function toColumnInfo(rows: readonly Record<string, unknown>[]): ColumnInfo[] {
  return rows.map((row) => ({
    cid: Number(row.cid ?? 0),
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    notnull: Number(row.notnull ?? 0),
    dfltValue: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
    pk: Number(row.pk ?? 0),
  }));
}

/** The statement that counts one table's rows, under the column name `rows`. @internal */
export function rowCountSelect(table: string): string {
  return `SELECT COUNT(*) AS rows FROM ${quoteSqlIdentifier(table)}`;
}

const READ_PRAGMAS = new Set([
  "foreign_key_check",
  "foreign_key_list",
  "index_info",
  "index_list",
  "index_xinfo",
  "integrity_check",
  "quick_check",
  "table_info",
  "table_list",
  "table_xinfo",
]);

function isReadOnlyStatement(statement: string): boolean {
  const words = maskSqlProse(statement, { identifiers: true }).trim().toUpperCase();
  const lead = /^\w+/.exec(words)?.[0];
  if (lead === "SELECT" || lead === "EXPLAIN") return true;
  if (lead === "WITH") return !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/.test(words);
  if (lead !== "PRAGMA" || words.includes("=")) return false;
  const name = /^PRAGMA\s+(?:\w+\s*\.\s*)?(\w+)/.exec(words)?.[1]?.toLowerCase();
  return name !== undefined && READ_PRAGMAS.has(name);
}

/** True when every statement is a SELECT, an EXPLAIN, a WITH naming no INSERT, UPDATE, DELETE or REPLACE, or an introspection PRAGMA with no `=`. @internal */
export function isReadOnlyBatch(statements: readonly string[]): boolean {
  return statements.length > 0 && statements.every(isReadOnlyStatement);
}
