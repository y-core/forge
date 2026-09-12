import type { SchemaObject } from "./types";

/** Wrangler's default for `migrations_table`. @public */
export const DEFAULT_MIGRATIONS_TABLE = "d1_migrations";

/** The name prefixes that mark an object as the toolchain's or the platform's rather than the app's. @internal */
export const MANAGED_TABLE_PREFIXES = ["forge_", "sqlite_", "_cf_"] as const;

/** Whether an object belongs to forge, to SQLite, to the platform, or to the migrations bookkeeping. @internal */
export function isManagedObject(name: string, migrationsTable: string = DEFAULT_MIGRATIONS_TABLE): boolean {
  return name === migrationsTable || MANAGED_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Orders two strings by code point — UTF-8 byte order, which is what SQLite's BINARY collation compares — rather than by UTF-16 code unit. @public */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(j) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}

/** The text a schema fingerprint hashes: the app's own objects, one tab-separated line each, in code-point order. @internal */
export function schemaFingerprintInput(objects: readonly SchemaObject[], migrationsTable: string = DEFAULT_MIGRATIONS_TABLE): string {
  return objects
    .filter((object) => !isManagedObject(object.name, migrationsTable))
    .sort((a, b) => compareCodePoints(a.type, b.type) || compareCodePoints(a.name, b.name))
    .map((object) => `${object.type}\t${object.name}\t${object.tblName}\t${object.sql ?? ""}`)
    .join("\n");
}

/** Every schema object the engine and the toolchain did not create, in a stable order. @internal */
export const INVENTORY_SELECT =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name";

/** Reads `INVENTORY_SELECT` rows into schema objects. @internal */
export function toSchemaObjects(rows: readonly Record<string, unknown>[]): SchemaObject[] {
  return rows.map((row) => ({
    type: String(row.type ?? ""),
    name: String(row.name ?? ""),
    tblName: String(row.tbl_name ?? ""),
    sql: row.sql === null || row.sql === undefined ? null : String(row.sql),
  }));
}

/** Reads every recorded schema fact. @internal */
export const SCHEMA_META_SELECT = "SELECT key, value FROM forge_schema_meta";

/** Reads `SCHEMA_META_SELECT` rows into a key-value map. @internal */
export function toSchemaMeta(rows: readonly Record<string, unknown>[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [String(row.key ?? ""), String(row.value ?? "")]));
}

/** The `forge_schema_meta` key holding the digest of every applied migration's bytes. @internal */
export const MIGRATIONS_DIGEST_KEY = "migrations_digest";

/** The `forge_schema_meta` key holding the fingerprint of the schema those migrations produced. @internal */
export const SCHEMA_FINGERPRINT_KEY = "schema_fingerprint";
