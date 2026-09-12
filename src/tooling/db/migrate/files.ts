import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { parseMigrationHeader } from "../schema/header";
import type { DbIo, DbRunContext, Migration, MigrationFile } from "../types";

// wrangler's own shape: a number, an underscore, a name, `.sql`.
const MIGRATION_FILE = /^(\d+)_(.+)\.sql$/;

/** Reads every `.sql` file in a migrations directory, in no promised order. An absent directory is an empty list. @internal */
export function readMigrationFiles(io: DbIo, dir: string): MigrationFile[] {
  if (!io.exists(dir)) return [];
  return io
    .readDir(dir)
    .filter((name) => MIGRATION_FILE.test(name))
    .map((name) => ({ name, path: join(dir, name), sql: io.readText(join(dir, name)) }));
}

/** Parses the migrations directory's files into wrangler's apply order — by number, not by name — refusing a name wrangler would not apply and a version used twice. @internal */
export function discoverMigrations(files: readonly MigrationFile[]): Migration[] {
  const seen = new Map<number, string>();
  const numbered = files.map((file) => {
    const match = MIGRATION_FILE.exec(file.name);
    if (match === null)
      throw new CliError("invalid-args", `${file.name} is not a migration file name — wrangler applies <NNNN>_<name>.sql and nothing else`);
    return { file, version: Number(match[1]), digits: match[1] ?? "" };
  });
  numbered.sort((a, b) => a.version - b.version || (a.file.name < b.file.name ? -1 : a.file.name > b.file.name ? 1 : 0));
  const migrations: Migration[] = [];
  for (const { file, version, digits } of numbered) {
    const other = seen.get(version);
    if (other !== undefined)
      throw new CliError("invalid-args", `${file.name} and ${other} share the number ${digits} — renumber one so they apply in one order`);
    seen.set(version, file.name);
    const name = file.name.slice(0, -".sql".length);
    const header = parseMigrationHeader(file.sql);
    migrations.push({ name, version, path: file.path, sha256: sha256(header.covered), sql: file.sql, origin: header.origin, stamp: header.stamp });
  }
  return migrations;
}

/** A migration's identity: SHA-256 over its bytes with the compose stamp's JSON blanked, so a restamp moves no checksum. @internal */
export function migrationChecksum(sql: string): string {
  return sha256(parseMigrationHeader(sql).covered);
}

/** Every migration on disk, in apply order. @internal */
export function readMigrations(run: DbRunContext): Migration[] {
  return discoverMigrations(readMigrationFiles(run.io, run.config.entry.migrationsDir));
}

/** SHA-256 over every migration's name and stamp-blanked bytes in order — what catches an applied migration whose file was edited. @internal */
export function migrationsDigest(migrations: readonly Pick<Migration, "name" | "sql">[]): string {
  return sha256(migrations.map((m) => `${m.name}.sql\0${parseMigrationHeader(m.sql).covered}`).join("\0\0"));
}

/** The number the next migration takes: above every version already on disk. @internal */
export function nextMigrationNumber(migrations: readonly Migration[]): number {
  return Math.max(1, ...migrations.map((migration) => migration.version + 1));
}

/** `<NNNN>_<name>.sql`, with the name reduced to what a file name and wrangler both accept. @internal */
export function migrationFileName(number: number, name: string): string {
  return `${String(number).padStart(4, "0")}_${name.replace(/[^A-Za-z0-9_-]+/g, "_")}.sql`;
}
