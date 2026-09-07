import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { INDEXER_VERSION, SCHEMA, SCHEMA_VERSION } from "./schema";

/** Where a developer's working index lives — under `.forge/`, which is a consumer-side build
 *  artifact and already gitignored. @public */
export function indexPath(root: string): string {
  return join(root, ".forge", "warden", "index.sqlite");
}

/** Where the gate builds its own. A separate file, so a developer's working index — stale, or
 *  built from an edit in progress — can never change a verdict. @public */
export function gateIndexPath(root: string): string {
  return join(root, ".forge", "warden", "gate.sqlite");
}

/** Opens a database at `path`, creating the schema when it is new. `:memory:` is honoured. @public */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  const tables = db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").all();
  if (tables.length === 0) db.exec(SCHEMA);
  return db;
}

/** Reads one `meta` value. @public */
export function readMeta(db: Database, key: string): string | undefined {
  return db.query<{ value: string }>("SELECT value FROM meta WHERE key = ?").get(key)?.value;
}

/** Writes one `meta` value. @public */
export function writeMeta(db: Database, key: string, value: string): void {
  db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);
}

/** The three versions a stale index is recognised by, cheapest gate first. @public */
export function stampVersions(db: Database, canonVersion: string): void {
  writeMeta(db, "schema_version", SCHEMA_VERSION);
  writeMeta(db, "indexer_version", INDEXER_VERSION);
  writeMeta(db, "canon_version", canonVersion);
}

/** True when the index was built by this schema, this indexer, and this canon. @public */
export function versionsMatch(db: Database, canonVersion: string): boolean {
  return (
    readMeta(db, "schema_version") === SCHEMA_VERSION &&
    readMeta(db, "indexer_version") === INDEXER_VERSION &&
    readMeta(db, "canon_version") === canonVersion
  );
}
