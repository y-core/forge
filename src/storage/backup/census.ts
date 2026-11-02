import { bytesToHex, sha256 } from "../../crypto/primitives/mod";
import { D1BackupError } from "./errors";
import type { BackupDatabase, D1BackupCensus, D1BackupHazard } from "./types";

const SAFE_INTEGER = "9007199254740991";

const VIRTUAL = /^\s*CREATE\s+VIRTUAL\s+TABLE\b/i;

interface SchemaRow {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string;
}

/** A name as a SQLite identifier, its double quotes doubled. @internal */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Whether D1's dumper writes this object: it skips Cloudflare's `_cf_` tables and SQLite's own. @internal */
export function isDumpedObject(name: string, tableName: string): boolean {
  return ![name, tableName].some((part) => part.startsWith("_cf_") || (part.startsWith("sqlite_") && part !== "sqlite_sequence"));
}

/** Whether a declared column type gives REAL affinity, by SQLite's rules in their order of precedence. @internal */
export function hasRealAffinity(declared: string): boolean {
  const type = declared.toUpperCase();
  if (type.includes("INT") || /CHAR|CLOB|TEXT/.test(type) || type.includes("BLOB") || type === "") return false;
  return /REAL|FLOA|DOUB/.test(type);
}

/** One statement counting, per column, the values D1's dumper would not reproduce. @internal */
export function hazardSelect(table: string, columns: readonly { readonly name: string; readonly real: boolean }[]): string {
  const counts = columns.flatMap(({ name, real }) => {
    const c = quoteIdentifier(name);
    const escape = `(instr(${c}, char(92) || 'n') > 0 AND instr(${c}, char(10)) > 0) OR (instr(${c}, char(92) || 'r') > 0 AND instr(${c}, char(13)) > 0)`;
    return [
      `SUM(typeof(${c}) = 'text' AND (${escape})) AS ${quoteIdentifier(`escape:${name}`)}`,
      `SUM(typeof(${c}) = 'integer' AND (${c} > ${SAFE_INTEGER} OR ${c} < -${SAFE_INTEGER})) AS ${quoteIdentifier(`integer:${name}`)}`,
      ...(real ? [] : [`SUM(typeof(${c}) = 'real' AND ${c} = CAST(${c} AS INTEGER)) AS ${quoteIdentifier(`real:${name}`)}`]),
    ];
  });
  return `SELECT ${counts.join(", ")} FROM ${quoteIdentifier(table)}`;
}

/** SHA-256 hex over the dumped schema objects, sorted by type and name, so a restored database can be held to it. @internal */
export async function schemaDigest(rows: readonly SchemaRow[]): Promise<string> {
  const lines = rows
    .filter((row) => isDumpedObject(row.name, row.tableName))
    .map((row) => `${row.type}\t${row.name}\t${row.sql}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return bytesToHex(await sha256(lines.join("\n")));
}

async function selectAll(database: BackupDatabase, query: string): Promise<Record<string, unknown>[]> {
  return (await database.prepare(query).all()).results;
}

/** The schema objects that hold SQL, read through any D1 binding or REST query runner. @internal */
export const SCHEMA_SELECT = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL";

/** Reads one row of `SCHEMA_SELECT` into its typed shape. @internal */
export function readSchemaRow(row: Record<string, unknown>): SchemaRow {
  return { type: String(row.type ?? ""), name: String(row.name ?? ""), tableName: String(row.tbl_name ?? ""), sql: String(row.sql ?? "") };
}

async function tableHazards(database: BackupDatabase, table: string): Promise<D1BackupHazard[]> {
  try {
    const columns = (await selectAll(database, `SELECT name, type FROM pragma_table_info(${quoteLiteral(table)})`)).map((row) => ({
      name: String(row.name ?? ""),
      real: hasRealAffinity(String(row.type ?? "")),
    }));
    if (columns.length === 0) return [];
    const counts = (await selectAll(database, hazardSelect(table, columns)))[0] ?? {};
    return columns.flatMap(({ name }) =>
      (["escape", "integer", "real"] as const)
        .map((kind) => ({ table, column: name, kind, count: Number(counts[`${kind}:${name}`] ?? 0) }))
        .filter((hazard) => hazard.count > 0),
    );
  } catch {
    return [{ table, column: null, kind: "unscanned", count: 0 }];
  }
}

/** Measures the database before its export: its schema digest, its migration head, and the values its dump will not reproduce. @internal */
export async function takeD1Census(database: BackupDatabase): Promise<D1BackupCensus> {
  const schema = (await selectAll(database, SCHEMA_SELECT)).map(readSchemaRow);
  const virtual = schema.filter((row) => row.type === "table" && VIRTUAL.test(row.sql)).map((row) => row.name);
  if (virtual.length > 0) {
    throw new D1BackupError("unsupported", `D1's export refuses virtual tables, so this database cannot be backed up: ${virtual.join(", ")}`);
  }
  const tables = schema.filter((row) => row.type === "table" && isDumpedObject(row.name, row.tableName)).map((row) => row.name);
  const hazards = (await Promise.all(tables.map((table) => tableHazards(database, table)))).flat();
  const head = tables.includes("_forge_migrations")
    ? (await selectAll(database, "SELECT name FROM _forge_migrations ORDER BY id DESC LIMIT 1"))[0]?.name
    : undefined;
  return { schemaDigest: await schemaDigest(schema), migrationHead: head === undefined ? null : String(head), hazards };
}
