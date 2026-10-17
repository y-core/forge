import { join } from "node:path";

import { inMigrationOrder, isMigrationFileName } from "../../../storage/db/migrations";
import { CliError } from "../../cli/errors";
import { declaredMigrations } from "../declared";
import { sha256 } from "../digest";
import { parseMigrationHeader } from "../schema/header";
import type { DbIo, DbRunContext, Migration, MigrationFile } from "../types";

/** Reads every `.sql` file in a migrations directory, in no promised order. An absent directory is an empty list. @internal */
export function readMigrationFiles(io: DbIo, dir: string): MigrationFile[] {
  if (!io.exists(dir)) return [];
  return io
    .readDir(dir)
    .filter(isMigrationFileName)
    .map((name) => ({ name, path: join(dir, name), sql: io.readText(join(dir, name)) }));
}

/** Parses the migrations directory's files into wrangler's apply order — by number, not by name — refusing a name wrangler would not apply and a version used twice. @internal */
export function discoverMigrations(files: readonly MigrationFile[]): Migration[] {
  let ordered: (MigrationFile & { readonly version: number })[];
  try {
    ordered = inMigrationOrder(files);
  } catch (error) {
    throw new CliError("invalid-args", error instanceof Error ? error.message : String(error));
  }
  return ordered.map((file) => {
    const header = parseMigrationHeader(file.sql);
    return {
      name: file.name.slice(0, -".sql".length),
      version: file.version,
      path: file.path,
      sha256: sha256(header.covered),
      sql: file.sql,
      stamp: header.stamp,
    };
  });
}

/** A migration's identity: SHA-256 over its bytes with the compose stamp's JSON blanked, so a restamp moves no checksum. @internal */
export function migrationChecksum(sql: string): string {
  return sha256(parseMigrationHeader(sql).covered);
}

/** Every migration on disk, in apply order. @internal */
export function readMigrations(run: DbRunContext): Migration[] {
  return discoverMigrations(readMigrationFiles(run.io, declaredMigrations(run).path));
}

/** SHA-256 over every migration's name and checksum in order — what catches an applied migration whose file was edited. @internal */
export function migrationsDigest(migrations: readonly Pick<Migration, "name" | "sha256">[]): string {
  return sha256(migrations.map((m) => `${m.name}\0${m.sha256}`).join("\0\0"));
}

/** The number the next migration takes: above every version already on disk. @internal */
export function nextMigrationNumber(migrations: readonly Migration[]): number {
  return Math.max(1, ...migrations.map((migration) => migration.version + 1));
}

/** `<NNNN>_<name>.sql`, with the name reduced to what a file name and wrangler both accept. @internal */
export function migrationFileName(number: number, name: string): string {
  return `${String(number).padStart(4, "0")}_${name.replace(/[^A-Za-z0-9_-]+/g, "_")}.sql`;
}
