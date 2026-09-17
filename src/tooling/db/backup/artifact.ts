import { join } from "node:path";

import { compareCodePoints } from "../../../storage/db/schema";
import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { COMPANION_TABLES } from "../migrate/companions";
import { splitSqlStatements } from "../migrate/lint";
import { quoteSqlIdentifier, quoteSqlLiteral, sqlLineAt } from "../sql";
import type { BackupManifest, ColumnInfo, DbIo, RestoreRoute, SchemaFacts, SchemaObject, TableClass } from "../types";
import type { AppTable, ArtifactFault, CanonicalRow, ReadCursor } from "./types";

/** Who owns a table: the app's own, the toolchain's, or the engine's. @internal */
export function classifyTable(name: string): TableClass {
  if (name === "sqlite_sequence" || name.startsWith("_forge_")) return "managed";
  if (name.startsWith("sqlite_") || name.startsWith("_cf_")) return "system";
  return "app";
}

function appTableNames(objects: readonly SchemaObject[]): string[] {
  return objects.filter((object) => object.type === "table" && classifyTable(object.name) === "app").map((object) => object.name);
}

/** Virtual tables by name — the pre-flight that turns wrangler's dumper throw into a message naming FTS5. @internal */
export function findVirtualTables(objects: readonly SchemaObject[]): readonly string[] {
  return objects.filter((object) => /^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(object.sql ?? "")).map((object) => object.name);
}

/** What this schema must still look like for a backup of it to mean anything, one problem per entry. @internal */
export function checkInventory(objects: readonly SchemaObject[]): readonly string[] {
  const problems: string[] = [];
  for (const name of findVirtualTables(objects)) {
    problems.push(
      `${name} is a virtual table — wrangler's dump generator throws on CREATE VIRTUAL TABLE, so this database cannot be exported or restored`,
    );
  }

  const autoincrement = objects
    .filter((object) => object.type === "table" && classifyTable(object.name) === "app" && /\bAUTOINCREMENT\b/i.test(object.sql ?? ""))
    .map((object) => object.name)
    .sort();
  if (autoincrement.length > 0) {
    problems.push(
      `AUTOINCREMENT is declared on app table(s) [${autoincrement.join(", ")}] and no app table may be — a backup restores keys from the artifact, and an engine-allocated one needs sqlite_sequence carried alongside it`,
    );
  }
  return problems;
}

/** The first equality assertion: two databases declare the same objects, `sql` compared exactly. @internal */
export function compareSchemaObjects(source: readonly SchemaObject[], target: readonly SchemaObject[]): readonly string[] {
  const problems: string[] = [];
  const key = (object: SchemaObject) => `${object.type} ${object.name}`;
  const sourceByKey = new Map(source.map((object) => [key(object), object]));
  const targetByKey = new Map(target.map((object) => [key(object), object]));

  for (const name of [...sourceByKey.keys()].sort()) if (!targetByKey.has(name)) problems.push(`${name} is in the source and not in the target`);
  for (const name of [...targetByKey.keys()].sort()) if (!sourceByKey.has(name)) problems.push(`${name} is in the target and not in the source`);
  for (const name of [...sourceByKey.keys()].sort()) {
    const left = sourceByKey.get(name);
    const right = targetByKey.get(name);
    if (left === undefined || right === undefined) continue;
    if (left.tblName !== right.tblName) problems.push(`${name}: tbl_name is ${left.tblName} in the source and ${right.tblName} in the target`);
    if ((left.sql ?? "") !== (right.sql ?? "")) problems.push(`${name}: the declaration differs between source and target`);
  }
  return problems;
}

/** The second equality assertion, and the only one covering column position: one table's columns, in order. @internal */
export function compareTableInfo(table: string, source: readonly ColumnInfo[], target: readonly ColumnInfo[]): readonly string[] {
  const problems: string[] = [];
  if (source.length !== target.length) problems.push(`${table}: ${source.length} columns in the source and ${target.length} in the target`);
  for (let index = 0; index < Math.max(source.length, target.length); index += 1) {
    const left = source[index];
    const right = target[index];
    if (left === undefined || right === undefined) continue;
    const differences: string[] = [];
    if (left.cid !== right.cid) differences.push(`cid ${left.cid}/${right.cid}`);
    if (left.name !== right.name) differences.push(`name ${left.name}/${right.name}`);
    if (left.type !== right.type) differences.push(`type ${left.type}/${right.type}`);
    if (left.notnull !== right.notnull) differences.push(`notnull ${left.notnull}/${right.notnull}`);
    if ((left.dfltValue ?? "") !== (right.dfltValue ?? "")) differences.push(`default ${left.dfltValue ?? "NULL"}/${right.dfltValue ?? "NULL"}`);
    if (left.pk !== right.pk) differences.push(`pk ${left.pk}/${right.pk}`);
    if (differences.length > 0) problems.push(`${table} column ${index}: ${differences.join(", ")}`);
  }
  return problems;
}

/** A value this module refuses to encode, naming the column so the message points at the schema. @internal */
export class UnsupportedValue extends Error {
  readonly column: string;
  readonly reason: string;

  constructor(column: string, reason: string) {
    super(`${column}: ${reason}`);
    this.name = "UnsupportedValue";
    this.column = column;
    this.reason = reason;
  }
}

/** A REAL read from `--json`, which drops the fraction of an integral value; the class is what keeps it from restoring as INTEGER. @internal */
export class SqlReal {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

// A BLOB reaches this module through `decodeReadRow`, which hands it over as byte values — so an
// array of integers 0–255 is the decoder's output shape, not anything wrangler's JSON ever emits.
function toBlobBytes(value: unknown): readonly number[] | null {
  if (value instanceof Uint8Array) return [...value];
  if (!Array.isArray(value)) return null;
  const bytes = value as readonly unknown[];
  return bytes.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255) ? (bytes as number[]) : null;
}

function toBlobHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One SQLite value as a string that cannot be confused with another, restoring the type tags `--json` erased. @internal */
export function canonicaliseValue(column: string, value: unknown): string {
  if (value === null) return "N";
  // The length prefix is what makes a row's join injective: without it `["a:b","c"]` and
  // `["a","b:c"]` encode identically, so a byte moved across a column boundary compares equal.
  if (typeof value === "string") return `S:${value.length}:${value}`;
  if (value instanceof SqlReal) {
    if (!Number.isFinite(value.value)) throw new UnsupportedValue(column, `${String(value.value)} is not a finite number`);
    return `R:${String(value.value)}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UnsupportedValue(column, `${String(value)} is not a finite number`);
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new UnsupportedValue(column, `the integer ${value} is past 2^53 and has already lost precision in JSON`);
      }
      return `I:${value}`;
    }
    return `R:${String(value)}`;
  }
  if (typeof value === "boolean") {
    throw new UnsupportedValue(column, "SQLite has no boolean type — a boolean here means the row was not read from D1");
  }
  if (value === undefined) throw new UnsupportedValue(column, "undefined is not a SQLite value — a NULL column reads back as null");
  const bytes = toBlobBytes(value);
  if (bytes !== null) return `B:${toBlobHex(bytes)}`;
  throw new UnsupportedValue(
    column,
    `a ${typeof value} cannot be encoded — a BLOB reads back from --json as an array of byte values, and this is not one`,
  );
}

/** A row read from `--json`, encoded; a column absent from the row throws rather than encoding as NULL. @internal */
export function canonicaliseRow(columns: readonly string[], keyColumn: string, row: Readonly<Record<string, unknown>>): CanonicalRow {
  const cells: Record<string, string> = {};
  for (const column of columns) {
    if (!Object.hasOwn(row, column)) throw new UnsupportedValue(column, "the column is absent from the row — the read did not return it");
    cells[column] = canonicaliseValue(column, row[column]);
  }
  const key = cells[keyColumn];
  if (key === undefined) throw new UnsupportedValue(keyColumn, "the key column is not among the columns read");
  return { key, canonical: columns.map((column) => cells[column] ?? "").join(" "), cells };
}

/** The digest input for one table: its canonical rows in key order, one per line. @internal */
export function digestInput(canonicals: readonly string[]): string {
  return canonicals.join("\n");
}

/** The digest input for a schema, so drift without a migration is visible. @internal */
export function schemaDigestInput(objects: readonly SchemaObject[]): string {
  return [...objects]
    .sort((left, right) => (left.type === right.type ? compareCodePoints(left.name, right.name) : compareCodePoints(left.type, right.type)))
    .map((object) => `${object.type}\t${object.name}\t${object.tblName}\t${JSON.stringify(object.sql)}`)
    .join("\n");
}

/** The digest input for the app's own objects, so a proof compares what a restore rebuilds and not what it recreates. @internal */
export function appSchemaDigestInput(objects: readonly SchemaObject[]): string {
  return schemaDigestInput(objects.filter((object) => classifyTable(object.name) === "app"));
}

/** Two canonical keys in the order `ORDER BY <key>` produced them: NULL, then numbers numerically, then text, then blobs. @internal */
export function compareKeys(left: string, right: string): number {
  const rank = (key: string) => (key === "N" ? 0 : key.startsWith("I:") || key.startsWith("R:") ? 1 : key.startsWith("B:") ? 3 : 2);
  const leftRank = rank(left);
  const rightRank = rank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  if (leftRank === 0) return 0;
  if (leftRank === 1) {
    const x = Number(left.slice(2));
    const y = Number(right.slice(2));
    return x === y ? 0 : x < y ? -1 : 1;
  }
  // Hex of equal-width bytes compares as memcmp does, and a shorter blob is a prefix of the
  // longer one's hex — which is the same shorter-is-less BINARY already gives text.
  if (leftRank === 3) return compareCodePoints(left.slice(2), right.slice(2));
  return compareCodePoints(left.slice(left.indexOf(":", 2) + 1), right.slice(right.indexOf(":", 2) + 1));
}

/** A value as SQL text, carrying a newline on a token rather than on an escape wrangler's dumper leaves ambiguous. @internal */
export function sqlValueExpression(column: string, value: unknown): string {
  if (value === null) return "NULL";
  if (value instanceof SqlReal) {
    if (!Number.isFinite(value.value)) throw new UnsupportedValue(column, `${String(value.value)} has no SQL literal`);
    const text = String(value.value);
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UnsupportedValue(column, `${String(value)} has no SQL literal`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new UnsupportedValue(column, `the integer ${value} is past 2^53 and cannot round-trip`);
    }
    return String(value);
  }
  if (typeof value !== "string") {
    const bytes = toBlobBytes(value);
    if (bytes !== null) return `X'${toBlobHex(bytes)}'`;
    throw new UnsupportedValue(
      column,
      `a ${typeof value} cannot be written to an artifact — a BLOB reads back from --json as an array of byte values, and this is not one`,
    );
  }
  if (value === "") return "''";
  const literal = (text: string): string => {
    try {
      return quoteSqlLiteral(text);
    } catch (error) {
      throw new UnsupportedValue(column, error instanceof Error ? error.message : String(error));
    }
  };
  if (!value.includes("\n") && !value.includes("\r")) return literal(value);

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const suffix = attempt === 0 ? "" : String(attempt);
    const lineFeed = `~~N${suffix}~~`;
    const carriageReturn = `~~R${suffix}~~`;
    const encoded: string = value.replaceAll("\r", carriageReturn).replaceAll("\n", lineFeed);
    if (encoded.replaceAll(lineFeed, "\n").replaceAll(carriageReturn, "\r") !== value) continue;
    let expression: string = literal(encoded);
    if (value.includes("\n")) expression = `replace(${expression},${quoteSqlLiteral(lineFeed)},char(10))`;
    if (value.includes("\r")) expression = `replace(${expression},${quoteSqlLiteral(carriageReturn)},char(13))`;
    return expression;
  }
  throw new UnsupportedValue(column, "no newline token survives a round trip against this value — every candidate occurs in the data");
}

/** One row as a single-line `INSERT` naming its columns, so it loads into a schema whose column order differs; `orIgnore` writes the idempotent form a seed needs. @internal */
export function insertStatement(
  table: string,
  columns: readonly string[],
  row: Readonly<Record<string, unknown>>,
  options?: { readonly orIgnore?: boolean },
): string {
  const names = columns.map(quoteSqlIdentifier).join(",");
  const values = columns
    .map((column) => {
      if (!Object.hasOwn(row, column)) throw new UnsupportedValue(column, "the column is absent from the row — the read did not return it");
      return sqlValueExpression(column, row[column]);
    })
    .join(",");
  const verb = options?.orIgnore === true ? "INSERT OR IGNORE INTO" : "INSERT INTO";
  return `${verb} ${quoteSqlIdentifier(table)} (${names}) VALUES (${values});`;
}

/** The alias prefix carrying a column's SQLite storage class alongside its value. @internal */
export const TYPE_ALIAS_PREFIX = "forge:type:";

/** One page of a table, ordered by its key and seeking past the last key read rather than by OFFSET. @internal */
export function verificationSelect(table: AppTable, columns: readonly string[], after: ReadCursor): string {
  // The read describes itself: a blob arrives as hex beside a `typeof` saying so, because `--json`
  // erases the storage class and encodes a blob as text that a text column could equally hold.
  const projection = columns
    .map((column) => {
      const quoted = quoteSqlIdentifier(column);
      return `CASE WHEN typeof(${quoted})='blob' THEN hex(${quoted}) ELSE ${quoted} END AS ${quoted}, typeof(${quoted}) AS ${quoteSqlIdentifier(`${TYPE_ALIAS_PREFIX}${column}`)}`;
    })
    .join(", ");
  // The table is aliased and the key qualified, because a bare `ORDER BY "id"` binds to a result
  // alias of that name while `WHERE "id" > …` binds to the base column, and the orders disagree.
  const key = `t.${quoteSqlIdentifier(table.key)}`;
  const seek = after === null ? "" : ` WHERE ${key} > ${typeof after === "object" ? `X'${toBlobHex(after)}'` : quoteSqlLiteral(after)}`;
  return `SELECT ${projection} FROM ${quoteSqlIdentifier(table.name)} AS t${seek} ORDER BY ${key} LIMIT ${table.pageRows}`;
}

function fromBlobHex(column: string, hex: unknown): readonly number[] {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) {
    throw new UnsupportedValue(column, `the column reads as a blob and its hex projection is ${JSON.stringify(hex)}`);
  }
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  return bytes;
}

// A tag the value cannot carry means the read lost the value, not the type: `--json` has no
// Infinity, so a stored one arrives as null under a `real` tag and would otherwise restore as NULL.
function decodeTaggedValue(column: string, tag: unknown, value: unknown): unknown {
  if (tag === "blob") return fromBlobHex(column, value);
  if (tag === "null") {
    if (value !== null) throw new UnsupportedValue(column, `the column reads as null and its value is ${JSON.stringify(value)}`);
    return null;
  }
  if (tag === "real" || tag === "integer") {
    if (typeof value !== "number") {
      throw new UnsupportedValue(column, `the column reads as ${tag} and its value is ${JSON.stringify(value)}, which is not a number`);
    }
    return tag === "real" ? new SqlReal(value) : value;
  }
  if (tag === "text") {
    if (typeof value !== "string") {
      throw new UnsupportedValue(column, `the column reads as text and its value is ${JSON.stringify(value)}, which is not a string`);
    }
    return value;
  }
  throw new UnsupportedValue(column, `the column's storage class reads as ${JSON.stringify(tag)}, which is not one SQLite reports`);
}

/** A raw row from a `verificationSelect` read, with each blob decoded to bytes, each REAL wrapped, and the type projections dropped. @internal */
export function decodeReadRow(columns: readonly string[], row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const column of columns) {
    if (!Object.hasOwn(row, column)) throw new UnsupportedValue(column, "the column is absent from the row — the read did not return it");
    const alias = `${TYPE_ALIAS_PREFIX}${column}`;
    if (!Object.hasOwn(row, alias)) {
      throw new UnsupportedValue(column, "the column's type projection is absent from the row — the read did not return it");
    }
    decoded[column] = decodeTaggedValue(column, row[alias], row[column]);
  }
  return decoded;
}

const DUMP_PREAMBLE = "PRAGMA defer_foreign_keys=TRUE;";

const ROW_REMOVAL = /(?:DELETE\s+FROM|TRUNCATE)\b/i;

const INSERT_LINE = /^\s*INSERT\b/i;

const INSERT_TARGET = /^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))/i;

function insertTarget(line: string): string | null {
  const match = INSERT_TARGET.exec(line);
  if (match === null) return null;
  const quoted = match[1];
  return (quoted === undefined ? (match[2] ?? "") : quoted.replaceAll('""', '"')).toLowerCase();
}

// Every value this tool writes is escaped onto a single line, so a line beginning `INSERT` is one
// whole row — which is what lets a scan tell a statement from prose that discusses statements.
function isStatement(line: string): boolean {
  return !INSERT_LINE.test(line);
}

function isRowRemoval(line: string): boolean {
  return isStatement(line) && new RegExp(`^\\s*(?:${ROW_REMOVAL.source})`, "i").test(line);
}

/** Whether `schema.sql` declares the tables route `full` loads before `data.sql`, and carries no row of its own. @internal */
export function checkSchemaArtifact(sql: string): readonly ArtifactFault[] {
  const faults: ArtifactFault[] = [];
  const lines = sql.split("\n");
  if (lines[0] !== DUMP_PREAMBLE) faults.push({ line: 1, reason: `the first line is not ${DUMP_PREAMBLE} — this is not a wrangler dump` });

  let tables = 0;
  let lastCreateTable = 0;
  const clears: number[] = [];
  for (const statement of splitSqlStatements(sql)) {
    const lead = statement.masked.search(/\S/);
    const number = sqlLineAt(sql, statement.offset + Math.max(lead, 0));
    if (/^\s*CREATE\s+TABLE\b/i.test(statement.masked)) {
      tables += 1;
      lastCreateTable = number;
    }
    if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(statement.masked))
      faults.push({ line: number, reason: "a virtual table cannot be dumped or restored" });
    if (INSERT_LINE.test(statement.raw)) {
      const table = insertTarget(statement.raw);
      faults.push({
        line: number,
        reason: `an INSERT into ${table ?? "a table this scan cannot read"} — a schema artifact declares tables and carries no row, because route full loads data.sql after it`,
      });
      continue;
    }
    if (!new RegExp(`^\\s*(?:${ROW_REMOVAL.source})`, "i").test(statement.masked)) continue;
    if (statement.raw.includes("sqlite_sequence")) clears.push(number);
    else faults.push({ line: number, reason: `an unexpected row-removal statement in a schema: ${`${statement.raw.trim()};`.slice(0, 80)}` });
  }

  // A schema declaring nothing would let `data.sql` fail statement by statement instead of up front.
  if (tables === 0)
    faults.push({ line: lines.length, reason: "no CREATE TABLE at all — this cannot be the schema route full loads data.sql into" });
  if (clears.length > 1) {
    faults.push({ line: clears[1] ?? lines.length, reason: `sqlite_sequence is cleared ${clears.length} times and should be cleared once` });
  }
  const clear = clears[0];
  if (clear !== undefined && clear < lastCreateTable) {
    faults.push({ line: clear, reason: `sqlite_sequence is cleared at line ${clear}, before the last CREATE TABLE at line ${lastCreateTable}` });
  }
  return faults;
}

const SEQUENCE_FAULT =
  "sqlite_sequence is the engine's and is restored only by schema.sql, which clears it first — an insert here would duplicate a row in a table with no UNIQUE index on name";

/** Whether `data.sql` holds only rows of the tables it may carry, and declares nothing. @internal */
export function checkDataArtifact(sql: string, appTables: readonly string[]): readonly ArtifactFault[] {
  const faults: ArtifactFault[] = [];
  const lines = sql.split("\n");
  const allowed = new Set(appTables.map((table) => table.toLowerCase()));
  if (lines[0] !== DUMP_PREAMBLE) faults.push({ line: 1, reason: `the first line is not ${DUMP_PREAMBLE} — this is not a wrangler dump` });

  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    // The table is read from the INSERT's own syntax rather than by searching the line, because a
    // row's data legitimately contains any string at all — including these two table names.
    if (INSERT_LINE.test(line)) {
      const table = insertTarget(line);
      if (table === null) {
        faults.push({ line: number, reason: `an INSERT naming no table this scan can read: ${line.trim().slice(0, 80)}` });
      } else if (table === "sqlite_sequence") faults.push({ line: number, reason: SEQUENCE_FAULT });
      else if (!allowed.has(table)) faults.push({ line: number, reason: `${table} is not one of the tables this artifact may carry` });
      continue;
    }
    if (/^\s*CREATE\s+/i.test(line)) {
      faults.push({
        line: number,
        reason: "a data-only artifact declares no schema — the migrations route applies the migrations directory first",
      });
    }
    if (isRowRemoval(line)) faults.push({ line: number, reason: `a data-only artifact removes nothing: ${line.trim().slice(0, 80)}` });
    if (/\bsqlite_sequence\b/.test(line)) faults.push({ line: number, reason: SEQUENCE_FAULT });
  }
  return faults;
}

/** Bumped when a manifest field changes meaning, so an old artifact is refused rather than misread. @internal */
export const BACKUP_FORMAT_VERSION = 7;

const SHA256 = /^[0-9a-f]{64}$/;

const DRIFT_STATES: readonly string[] = ["match", "mismatch", "unrecorded", "unavailable"];

const MANIFEST_MIGRATION_NAME = /^\d+_[^/\\\0]+$/;

const ARTIFACT_FILE_NAME = /^[A-Za-z0-9_.-]+$/;

const RESTORE_ROUTES: readonly string[] = ["full", "migrations"];

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A manifest's digest of itself, over the bytes it is written as with the field blanked. Detects damage, never tampering. @internal */
export function manifestSelfDigest(manifest: BackupManifest): string {
  return sha256(JSON.stringify({ ...manifest, selfDigest: "" }, null, 2));
}

/** Everything wrong with a parsed `manifest.json`, empty when it is one. @internal */
export function validateManifest(value: unknown): readonly string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["the manifest is not a JSON object"];
  const manifest = value as Record<string, unknown>;

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    problems.push(
      `formatVersion is ${JSON.stringify(manifest.formatVersion)} and this tool writes ${BACKUP_FORMAT_VERSION} — take the backup again, since full.sql is gone and route full now loads schema.sql then data.sql`,
    );
  }
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    problems.push("createdAt is not an ISO 8601 instant");
  }
  if (typeof manifest.selfDigest !== "string" || !SHA256.test(manifest.selfDigest)) problems.push("selfDigest is not a 64-character hex SHA-256");

  const database = manifest.database;
  if (typeof database !== "object" || database === null) problems.push("database is missing");
  else {
    const record = database as Record<string, unknown>;
    for (const field of ["name", "target"]) if (typeof record[field] !== "string") problems.push(`database.${field} is missing`);
  }

  const schema = manifest.schema;
  if (typeof schema !== "object" || schema === null) problems.push("schema is missing");
  else {
    const record = schema as Record<string, unknown>;
    if (!Array.isArray(record.migrations)) problems.push("schema.migrations is not an array");
    for (const field of ["digest", "migrationsDigest"]) {
      const digest = record[field];
      if (typeof digest !== "string" || !SHA256.test(digest)) problems.push(`schema.${field} is not a 64-character hex SHA-256`);
    }
  }

  if (!DRIFT_STATES.includes(manifest.drift as string)) {
    problems.push(`drift is ${JSON.stringify(manifest.drift)} and not one of ${DRIFT_STATES.join(", ")}`);
  }

  for (const field of ["tables", "artifacts", "warnings", "verified", "migrations"]) {
    if (!Array.isArray(manifest[field])) problems.push(`${field} is not an array`);
  }
  const rows = (field: string): [number, Record<string, unknown>][] =>
    (Array.isArray(manifest[field]) ? (manifest[field] as unknown[]) : []).map((entry, index) => [
      index,
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {},
    ]);
  for (const [index, row] of rows("migrations")) {
    if (typeof row.name !== "string") problems.push(`migrations[${index}].name is missing`);
    else if (!MANIFEST_MIGRATION_NAME.test(row.name)) {
      problems.push(`migrations[${index}].name ${JSON.stringify(row.name)} is not a migration name — <NNNN>_<name>, with no path separator`);
    }
    if (typeof row.sha256 !== "string" || !SHA256.test(row.sha256)) problems.push(`migrations[${index}].sha256 is not a 64-character hex SHA-256`);
  }
  for (const [index, row] of rows("artifacts")) {
    if (typeof row.file !== "string" || !ARTIFACT_FILE_NAME.test(row.file) || row.file === "." || row.file === "..") {
      problems.push(`artifacts[${index}].file ${JSON.stringify(row.file)} is not a file name — letters, digits, dot, underscore and hyphen only`);
    }
    if (typeof row.bytes !== "number" || !Number.isFinite(row.bytes) || row.bytes < 0)
      problems.push(`artifacts[${index}].bytes is not a byte count`);
    if (typeof row.sha256 !== "string" || !SHA256.test(row.sha256)) problems.push(`artifacts[${index}].sha256 is not a 64-character hex SHA-256`);
  }
  for (const [index, row] of rows("tables")) {
    if (typeof row.name !== "string") problems.push(`tables[${index}].name is missing`);
    if (!isCount(row.rows)) problems.push(`tables[${index}].rows is not a row count`);
    if (typeof row.digest !== "string" || !SHA256.test(row.digest)) problems.push(`tables[${index}].digest is not a 64-character hex SHA-256`);
  }
  for (const [index, row] of rows("verified")) {
    if (typeof row.route !== "string" || !RESTORE_ROUTES.includes(row.route)) problems.push(`verified[${index}].route is not full or migrations`);
    if (!isCount(row.divergent)) problems.push(`verified[${index}].divergent is not a count`);
  }
  return problems;
}

/** The three schema bindings an artifact carries, checked against what is on disk now, reported by name. @internal */
export function compareManifests(manifest: BackupManifest, onDisk: SchemaFacts): readonly string[] {
  const problems: string[] = [];
  const wanted = manifest.schema.migrations.join(", ");
  const found = onDisk.migrations.join(", ");
  if (wanted !== found) problems.push(`migrations: the artifact was taken from [${wanted}] and this database has [${found}]`);
  if (manifest.schema.digest !== onDisk.digest) {
    problems.push("schema digest: the declarations differ — a schema changed without a migration on one side");
  }
  if (manifest.schema.migrationsDigest !== onDisk.migrationsDigest) {
    problems.push(
      "migrations digest: the same migration names hash differently — an applied migration's file has been edited, which a forward-only migrations directory forbids",
    );
  }
  return problems;
}

/** Whether this manifest is a backup of `database` that its own run proved by at least one route. @internal */
export function isVerifiedBackupOf(manifest: BackupManifest, database: string): boolean {
  return manifest.database.name === database && manifest.verified.length > 0 && manifest.verified.every((route) => route.divergent === 0);
}

/** `<database>-<YYYYMMDDTHHMMSSZ>` — sortable, and legal on every filesystem this runs on. @internal */
export function formatBackupDirectory(database: string, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${database}-${stamp}`;
}

function refuseFaults(file: string, what: string, faults: readonly ArtifactFault[]): void {
  if (faults.length === 0) return;
  throw new CliError(
    "invalid-args",
    `${file} is not what ${what}:\n  ${faults.map((fault) => `line ${fault.line}: ${fault.reason}`).join("\n  ")}`,
  );
}

/** The whole artifact checked against its own manifest — the bar a restore loads one at, and a reset relies on one at. @internal */
export function verifyBackupArtifact(io: DbIo, directory: string, manifest: BackupManifest): void {
  const manifestPath = join(directory, "manifest.json");
  if (manifestSelfDigest(manifest) !== manifest.selfDigest) {
    throw new CliError("invalid-args", `${manifestPath} does not hash to the selfDigest it carries — this artifact is damaged`);
  }
  // The companion tables ride in `data.sql` beside the app's own, and route `migrations` creates them.
  const carried = [...manifest.tables.map((table) => table.name), ...COMPANION_TABLES];
  for (const entry of manifest.artifacts) {
    const path = join(directory, entry.file);
    if (!io.exists(path)) throw new CliError("invalid-args", `${path} is declared in the manifest and missing from the artifact`);
    const text = io.readText(path);
    if (sha256(text) !== entry.sha256) {
      throw new CliError("invalid-args", `${path} does not hash to what the manifest declares for it — this artifact is damaged`);
    }
    if (entry.file === "schema.sql") refuseFaults(entry.file, "a schema-only artifact must be", checkSchemaArtifact(text));
    if (entry.file === "data.sql") refuseFaults(entry.file, "a data-only artifact must be", checkDataArtifact(text, carried));
  }
}

/** Why this target may not be restored into, or nothing — a restore adds rows and never removes them. @internal */
export function checkRestoreTarget(
  route: RestoreRoute,
  objects: readonly SchemaObject[],
  rows: Readonly<Record<string, number>>,
  expectedTables: readonly string[],
): readonly string[] {
  const tables = appTableNames(objects);
  if (route === "full") {
    if (tables.length === 0) return [];
    return [
      `the target already declares ${tables.length} app table(s) — route full loads a whole database and needs one with none: ${[...tables].sort().join(", ")}`,
    ];
  }

  const problems: string[] = [];
  const present = new Set(tables);
  for (const table of expectedTables) {
    if (!present.has(table)) problems.push(`${table} is missing — route migrations needs the migrations directory applied first`);
  }
  for (const table of [...tables].sort()) {
    const count = rows[table] ?? 0;
    if (count > 0) {
      problems.push(`${table} already holds ${count} row(s) — a restore adds rows and never removes them, so the target must be empty`);
    }
  }
  return problems;
}
