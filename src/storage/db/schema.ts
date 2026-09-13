import type { SchemaObject } from "./types";

/** The name prefixes that mark an object as the toolchain's or the platform's rather than the app's. @internal */
export const MANAGED_TABLE_PREFIXES = ["_forge_", "sqlite_", "_cf_"] as const;

/** Whether an object belongs to forge, to SQLite, or to the platform rather than to the app. @internal */
export function isManagedObject(name: string): boolean {
  return MANAGED_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
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
export function schemaFingerprintInput(objects: readonly SchemaObject[]): string {
  return objects
    .filter((object) => !isManagedObject(object.name))
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

/** The newest certified fingerprint, skipping the rows a part-applied batch left uncertified; no row means none ever certified one. @internal */
export const RECORDED_FINGERPRINT_SELECT = "SELECT fingerprint FROM _forge_migrations WHERE fingerprint IS NOT NULL ORDER BY id DESC LIMIT 1";
