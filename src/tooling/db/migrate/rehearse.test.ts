import { describe, expect, it } from "bun:test";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import type { D1BackupSidecar } from "../../../storage/backup/types";
import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { readSchemaRow, schemaDigest } from "../backup/census";
import { backupKey, writeSidecar } from "../backup/store";
import { fakeDbIo } from "../db.fixture";
import { sha256 } from "../digest";
import { appHome } from "../home";
import type { DbConfig, DbRunContext, FakeDbIo, Migration, Place } from "../types";
import { recordMigrationSql } from "./checksum";
import { rehearseMigrations } from "./rehearse";

const NOW = new Date("2026-09-11T10:00:00Z");
const ROOT = "/app";
const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const KEY = backupKey(undefined, DB_ID, new Date("2026-09-11T09:00:00Z"), "local-1");
const DUMP =
  'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT) STRICT;\nINSERT INTO "users" ("id","email") VALUES(1,NULL);';

const INVENTORY = [
  { type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT) STRICT" },
  {
    type: "table",
    name: "_forge_migrations",
    tbl_name: "_forge_migrations",
    sql: "CREATE TABLE _forge_migrations (id INTEGER PRIMARY KEY, name TEXT)",
  },
];
const APPLIED = ["0001_init"];
const PENDING: Migration[] = [
  {
    name: "0002_email_not_null",
    version: 2,
    path: `${ROOT}/config/db/migrations/0002_email_not_null.sql`,
    sha256: sha256("x"),
    sql: "CREATE TABLE _forge_new_users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT;",
    stamp: null,
  },
];

async function sidecar(over: Partial<D1BackupSidecar> = {}): Promise<D1BackupSidecar> {
  return {
    key: KEY,
    databaseId: DB_ID,
    bookmark: "local-1",
    takenAt: "2026-09-11T09:00:00.000Z",
    size: DUMP.length,
    md5: "0".repeat(32),
    sha256: "1".repeat(64),
    schemaDigest: await schemaDigest(INVENTORY.map(readSchemaRow)),
    migrationHead: "0001_init",
    rows: { users: 218, _forge_migrations: 1 },
    hazards: [],
    ...over,
  };
}

function dbConfig(place: Place): DbConfig {
  return {
    root: ROOT,
    configPath: `${ROOT}/wrangler.jsonc`,
    config: {
      name: "app",
      compatibility_date: "2026-01-01",
      d1_databases: [{ binding: "DB", database_name: "app-db" }],
      r2_buckets: [{ binding: "BACKUPS", bucket_name: "app-backups" }],
    } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: DB_ID, previewDatabaseId: null },
    target: { place, database: null },
  };
}

/** A run whose scratch answers `rows` per table once restored, over a BACKUPS bucket holding `dumps`. */
async function context(
  dumps: readonly D1BackupSidecar[],
  options: { place?: Place; failApply?: boolean; rows?: Readonly<Record<string, number>> } = {},
): Promise<{ run: DbRunContext; io: FakeDbIo }> {
  const io = fakeDbIo({}, { now: NOW });
  const config = dbConfig(options.place ?? "local");
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  const bucket = fakeBackupBucket();
  for (const dump of dumps) {
    bucket.objects.set(dump.key, { bytes: new TextEncoder().encode(DUMP) });
    await writeSidecar(bucket, dump);
  }
  io.buckets.set("BACKUPS", bucket);
  const rows = options.rows ?? { users: 218, _forge_migrations: 1 };
  io.d1Rules.push({
    match: () => options.failApply === true && io.d1Calls.at(-1)?.source?.includes("rehearse-apply") === true,
    reply: () => {
      throw new Error("NOT NULL constraint failed: users.email");
    },
  });
  io.d1Rules.push({
    match: () => true,
    reply: (statement) => {
      if (statement.includes("sqlite_master")) return INVENTORY;
      if (statement.includes("ORDER BY id DESC LIMIT 1")) return [{ name: "0001_init" }];
      const count = /^SELECT COUNT\(\*\) AS n FROM "([^"]+)"$/.exec(statement);
      return count === null ? [] : [{ n: rows[count[1] ?? ""] ?? 0 }];
    },
  });
  return { run, io };
}

async function capture(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, and the call returned");
}

const scratch = (io: FakeDbIo) => io.d1Calls.filter((call) => call.persistTo.includes("/.forge/scratch/rehearse/"));

describe("rehearseMigrations()", () => {
  it("loads the newest complete dump into a scratch, applies the pending migrations to it, and reports its rows", async () => {
    const { run, io } = await context([await sidecar()]);

    expect(await rehearseMigrations(run, PENDING, {}, APPLIED)).toEqual({ dump: KEY, rows: 219, applied: ["0002_email_not_null"] });
    expect(scratch(io)[0]?.statements).toEqual([
      "PRAGMA defer_foreign_keys=TRUE",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT) STRICT",
      'INSERT INTO "users" ("id","email") VALUES(1,NULL)',
    ]);
    const migration = PENDING[0];
    if (migration === undefined) throw new Error("PENDING must not be empty");
    expect(io.files.get(`${ROOT}/.forge/scratch/rehearse-apply/0002_email_not_null.sql`)).toBe(
      `${migration.sql}\n${recordMigrationSql(migration, NOW.getTime())}`,
    );
  });

  it("loads a dump row whose text holds BEGIN TRANSACTION and COMMIT into the scratch byte for byte", async () => {
    const { run, io } = await context([await sidecar()]);
    const row = `INSERT INTO "users" ("id","email") VALUES(2,'BEGIN TRANSACTION; a@example.com COMMIT;')`;
    await io.buckets.get("BACKUPS")?.put(KEY, `${DUMP}\n${row};`);
    await rehearseMigrations(run, PENDING, {}, APPLIED);
    expect(scratch(io)[0]?.statements.at(-1)).toBe(row);
  });

  it("creates the companion tables on the scratch before the recorded apply stages its history row", async () => {
    const { run, io } = await context([await sidecar()]);
    await rehearseMigrations(run, PENDING, {}, APPLIED);
    const sources = io.d1Calls.map((call) => call.source ?? call.statements.join("\n"));
    const companions = sources.findIndex((source) => source.includes("CREATE TABLE IF NOT EXISTS _forge_migrations"));
    const apply = sources.findIndex((source) => source.includes("rehearse-apply"));
    expect([companions > -1, companions < apply]).toEqual([true, true]);
  });

  it("takes the dump --dump names", async () => {
    const older = await sidecar({ key: backupKey(undefined, DB_ID, new Date("2026-09-10T09:00:00Z"), "local-0") });
    const { run } = await context([await sidecar(), older]);
    expect((await rehearseMigrations(run, PENDING, { dump: older.key }, APPLIED)).dump).toBe(older.key);
  });

  it("touches nothing outside the scratch, so the app's own state is never restored into", async () => {
    const { run, io } = await context([await sidecar()]);
    await rehearseMigrations(run, PENDING, {}, APPLIED);
    expect(io.d1Calls.filter((call) => call.persistTo === `${ROOT}/.wrangler/state/v3`)).toEqual([]);
  });

  it("names the migration the rehearsal stopped on and repeats what the database said", async () => {
    const { run } = await context([await sidecar()], { failApply: true });
    const message = await capture(() => rehearseMigrations(run, PENDING, {}, APPLIED));
    expect(message).toContain(`the rehearsal failed on 0002_email_not_null — these migrations do not apply to the 219 row(s) ${KEY} holds`);
    expect(message).toContain("NOT NULL constraint failed: users.email");
  });

  it("refuses a dump that did not restore to what its sidecar records, before applying anything", async () => {
    const { run, io } = await context([await sidecar()], { rows: { users: 5, _forge_migrations: 1 } });
    expect(await capture(() => rehearseMigrations(run, PENDING, {}, APPLIED))).toBe(
      `${KEY} did not restore to what its sidecar records, so it cannot rehearse:\n  users holds 5 rows, but the dump holds 218`,
    );
    expect(io.d1Calls.some((call) => call.source?.includes("rehearse-apply") === true)).toBe(false);
  });

  it("refuses when no complete dump of this database exists, naming the verb that makes one", async () => {
    const { run } = await context([]);
    expect(await capture(() => rehearseMigrations(run, PENDING, {}, APPLIED))).toBe(
      `no complete dump of app-db under BACKUPS:d1-backups/${DB_ID}/ — run \`forge db backup\` first`,
    );
  });

  it("refuses a dump taken from another database", async () => {
    const foreign = await sidecar({ databaseId: "other", key: backupKey(undefined, "other", new Date("2026-09-11T09:00:00Z"), "local-1") });
    const { run } = await context([foreign]);
    expect(await capture(() => rehearseMigrations(run, PENDING, { dump: foreign.key }, APPLIED))).toBe(
      `${foreign.key} was taken from database other and this target is ${DB_ID}`,
    );
  });

  it("refuses a dump taken at another migration than this target is at, naming each side, before it restores", async () => {
    const { run, io } = await context([await sidecar()]);
    expect(await capture(() => rehearseMigrations(run, PENDING, {}, ["0001_init", "0002_x"]))).toBe(
      `${KEY} was taken at migration 0001_init and this target is at 0002_x — a rehearsal needs a dump of this target as it stands; run \`forge db backup\` first, or name one with --dump`,
    );
    expect(scratch(io)).toEqual([]);
  });

  it("refuses a deployed target, which has no local scratch to restore into", async () => {
    const { run } = await context([await sidecar()], { place: "remote" });
    expect(await capture(() => rehearseMigrations(run, PENDING, {}, APPLIED))).toBe(
      "--rehearse restores a dump into a local scratch database, and remote is deployed — rehearse the same migrations against `--target local` or `--target standby`, then apply here",
    );
  });
});
