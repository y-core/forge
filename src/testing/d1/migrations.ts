import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { DB_LAYOUT, inMigrationOrder, isMigrationFileName } from "../../storage/db/migrations";
import { INVENTORY_SELECT } from "../../storage/db/schema";
import type { D1Database } from "../../storage/db/types";
import { cutSqlStatements } from "../../tooling/db/backup/split";
import { declaredPath, DEFAULT_DB_CONFIG, loadHostConfig } from "../../tooling/db/declared";
import { quoteSqlIdentifier } from "../../tooling/db/sql";
import type { OpenTestD1Options } from "./types";

/** Reads the app's migrations in wrangler's order, from the directory its host config or `migrations` names. @internal */
export async function readTestMigrations(options: OpenTestD1Options, caller: string): Promise<{ name: string; sql: string }[]> {
  const root = resolve(options.root ?? process.cwd());
  const { hostConfig } = options;
  const host =
    options.migrations === undefined ? await loadHostConfig(root, hostConfig ?? DEFAULT_DB_CONFIG, hostConfig !== undefined, "`hostConfig`") : {};
  const directory = declaredPath(root, options.migrations ?? host.migrations ?? DB_LAYOUT.migrations).path;
  if (!existsSync(directory)) throw new Error(`${caller}: no migrations directory at ${directory}`);
  return inMigrationOrder(
    readdirSync(directory)
      .filter(isMigrationFileName)
      .map((name) => ({ name, sql: readFileSync(join(directory, name), "utf-8") })),
  );
}

/** Applies each migration as one batch, naming the file that failed. @internal */
export async function applyTestMigrations(db: D1Database, migrations: readonly { name: string; sql: string }[], caller: string): Promise<void> {
  for (const migration of migrations) {
    const statements = cutSqlStatements(migration.sql);
    if (statements.length === 0) continue;
    await db.batch(statements.map((statement) => db.prepare(statement))).catch((error: unknown) => {
      throw new Error(`${caller}: ${migration.name} failed to apply: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
  }
}

/** The statements that empty a database of every app object: triggers, views and indexes, then each table before any table it references. @internal */
export function dropStatements(objects: readonly { type: string; name: string }[], parents: ReadonlyMap<string, readonly string[]>): string[] {
  const of = (type: string) => objects.filter((object) => object.type === type).map((object) => object.name);
  const drops = [
    ...of("trigger").map((name) => `DROP TRIGGER IF EXISTS ${quoteSqlIdentifier(name)}`),
    ...of("view").map((name) => `DROP VIEW IF EXISTS ${quoteSqlIdentifier(name)}`),
    ...of("index").map((name) => `DROP INDEX IF EXISTS ${quoteSqlIdentifier(name)}`),
  ];
  const remaining = new Set(of("table"));
  while (remaining.size > 0) {
    const referenced = new Set([...remaining].flatMap((table) => (parents.get(table) ?? []).filter((parent) => parent !== table)));
    const leaves = [...remaining].filter((table) => !referenced.has(table)).sort();
    // A cycle has no leaf; the batch defers foreign keys, so name order is safe for what is left.
    const next = leaves.length > 0 ? leaves : [...remaining].sort();
    for (const table of next) {
      drops.push(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(table)}`);
      remaining.delete(table);
    }
  }
  return drops;
}

/** Drops every object the app made, in one batch that defers foreign keys. @internal */
export async function dropAppObjects(db: D1Database): Promise<void> {
  const rows = async <T>(query: string): Promise<T[]> => (await db.prepare(query).all<T>()).results;
  const objects = await rows<{ type: string; name: string }>(INVENTORY_SELECT);
  const parents = new Map<string, string[]>();
  for (const { type, name } of objects) {
    if (type !== "table") continue;
    const keys = await rows<{ table: string }>(`PRAGMA foreign_key_list(${quoteSqlIdentifier(name)})`);
    parents.set(
      name,
      keys.map((key) => key.table),
    );
  }
  const drops = dropStatements(objects, parents);
  if (drops.length > 0) await db.batch(["PRAGMA defer_foreign_keys = true", ...drops].map((statement) => db.prepare(statement)));
}
