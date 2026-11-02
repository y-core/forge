import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { backupKey } from "../../../storage/backup/list";
import { writeSidecar } from "../../../storage/backup/sidecar";
import type { D1BackupSidecar } from "../../../storage/backup/types";
import { CliError } from "../../cli/errors";
import { resolveDbContext } from "../context";
import { fakeDbIo, minimalWranglerConfig } from "../db.fixture";
import type { DbRunContext, FakeDbIo, SharedDbFlags } from "../types";
import { executeReset, prepareReset, RESET_DUMP_MAX_AGE_MS } from "./reset";
import type { ResetOptions, ResetOutcome } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const STATE = ["v3", "d1", "miniflare-D1DatabaseObject"];

const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

const NOW = new Date("2026-09-11T10:00:00Z");

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "_forge_migrations", tbl_name: "_forge_migrations", sql: "CREATE TABLE _forge_migrations (name TEXT PRIMARY KEY)" },
  { type: "table", name: "_cf_KV", tbl_name: "_cf_KV", sql: "CREATE TABLE _cf_KV (key TEXT)" },
];

function sidecar(over: Partial<D1BackupSidecar> = {}): D1BackupSidecar {
  const takenAt = over.takenAt ?? "2026-09-11T09:00:00.000Z";
  return {
    key: backupKey(undefined, DB_ID, new Date(takenAt), "local-1"),
    databaseId: DB_ID,
    bookmark: "local-1",
    takenAt,
    size: 10,
    md5: "0".repeat(32),
    sha256: "1".repeat(64),
    schemaDigest: "2".repeat(64),
    migrationHead: "0001_init.sql",
    rows: { tasks: 2, _forge_migrations: 1 },
    hazards: [],
    ...over,
  };
}

function appRoot(over: Record<string, unknown> = { r2_buckets: [{ binding: "BACKUPS", bucket_name: "app-backups" }] }): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-reset-unit-"));
  roots.push(root);
  const config = minimalWranglerConfig(root, over);
  writeFileSync(config.path, config.text);
  return root;
}

function flags(root: string, over: Partial<SharedDbFlags> = {}): SharedDbFlags {
  return { target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, root, json: false, yes: true, ...over };
}

function context(root: string, io: FakeDbIo, over: Partial<SharedDbFlags> = {}): Promise<DbRunContext> {
  return resolveDbContext(flags(root, over), undefined, { io, host: {} });
}

/** A local database holding `rows` per table, with a state file and a BACKUPS bucket holding `dumps`. */
async function database(root: string, rows: Readonly<Record<string, number>>, dumps: readonly D1BackupSidecar[] = []): Promise<FakeDbIo> {
  const io = fakeDbIo({ [join(root, ".wrangler", "state", ...STATE, "db.sqlite")]: "" }, { now: NOW });
  io.d1Rules.push({
    match: () => true,
    reply: (statement) => {
      if (statement.includes("sqlite_master")) return INVENTORY;
      const count = /^SELECT COUNT\(\*\) AS rows FROM "([^"]+)"$/.exec(statement);
      return count === null ? [] : [{ rows: rows[count[1] ?? ""] ?? 0 }];
    },
  });
  const bucket = fakeBackupBucket();
  for (const dump of dumps) {
    bucket.objects.set(dump.key, { bytes: new Uint8Array(dump.size), customMetadata: {} });
    await writeSidecar(bucket, dump);
  }
  io.buckets.set("BACKUPS", bucket);
  return io;
}

async function refusal(run: () => unknown): Promise<{ kind: string; message: string }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliError) return { kind: error.kind, message: error.message };
    throw error;
  }
  throw new Error("expected a CliError, and the call returned");
}

const runReset = async (run: DbRunContext, options: ResetOptions): Promise<ResetOutcome> => executeReset(run, await prepareReset(run, options));

const LIVE = { tasks: 2, _forge_migrations: 1 };

const UNBACKED = "Run `forge db backup` first, or pass --allow-unbacked if this database is genuinely disposable";

describe("prepareReset + executeReset — the pair the CLI confirms between", () => {
  it("refuses a deployed database, naming the bookmark verb that does reach one", async () => {
    const run = await context(appRoot(), fakeDbIo(), { target: "remote" });
    expect(await refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false }))).toEqual({
      kind: "invalid-args",
      message:
        "remote cannot be reset from here — return a deployed database to a point in time with `forge db bookmark restore`, or replace it with `wrangler d1 create`",
    });
  });

  it("refuses an expect that does not name this target, removing nothing", async () => {
    const root = appRoot();
    const io = await database(root, LIVE);
    expect((await refusal(async () => runReset(await context(root, io), { expect: "other-db", allowUnbacked: false }))).message).toBe(
      "--expect other-db does not name this target, which is app-db",
    );
    expect(io.exists(join(root, ".wrangler", "state", ...STATE, "db.sqlite"))).toBe(true);
  });

  it("returns without querying the database when there is no state directory", async () => {
    const io = fakeDbIo();
    expect(await runReset(await context(appRoot(), io), { expect: "app-db", allowUnbacked: false })).toEqual({
      database: "app-db",
      rows: 0,
      removed: null,
      backedUpBy: null,
    });
    expect(io.d1Calls).toEqual([]);
  });

  it("removes the state, after releasing its handle, and names the dump whose census matches the live rows", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const io = await database(root, LIVE, [sidecar()]);
    const run = await context(root, io);

    expect(await runReset(run, { expect: "app-db", allowUnbacked: false })).toEqual({
      database: "app-db",
      rows: 2,
      removed: state,
      backedUpBy: sidecar().key,
    });
    expect([io.exists(join(state, "db.sqlite")), io.closed.at(-1)]).toEqual([false, join(root, ".wrangler", "state", "v3")]);
  });

  it("counts only the app's own rows toward needing a dump, and reads none of Cloudflare's tables", async () => {
    const root = appRoot();
    const io = await database(root, { _forge_migrations: 3 });
    expect((await runReset(await context(root, io), { expect: "app-db", allowUnbacked: false })).backedUpBy).toBeNull();
    expect(io.d1Calls.flatMap((call) => call.statements).some((statement) => statement.includes("_cf_KV"))).toBe(false);
  });

  it("refuses to empty a database holding rows when no complete dump exists, naming where it looked", async () => {
    const root = appRoot();
    const io = await database(root, LIVE);
    expect((await refusal(async () => runReset(await context(root, io), { expect: "app-db", allowUnbacked: false }))).message).toBe(
      `app-db holds 2 rows and no complete dump of app-db under BACKUPS:d1-backups/${DB_ID}/ — run \`forge db backup\` first`,
    );
    expect(io.exists(join(root, ".wrangler", "state", ...STATE, "db.sqlite"))).toBe(true);
  });

  it("refuses a dump whose census no longer describes the database, naming each table", async () => {
    const root = appRoot();
    const io = await database(root, { tasks: 3, _forge_migrations: 1 }, [sidecar()]);
    expect((await refusal(async () => runReset(await context(root, io), { expect: "app-db", allowUnbacked: false }))).message).toBe(
      `${sidecar().key} no longer describes app-db, so it does not prove these 3 rows are recoverable:\n  tasks: the dump holds 2 row(s) and the database now holds 3\n${UNBACKED}`,
    );
  });

  it("refuses a dump older than the window even when its census matches", async () => {
    const root = appRoot();
    const old = sidecar({ takenAt: new Date(NOW.getTime() - RESET_DUMP_MAX_AGE_MS - 60_000).toISOString() });
    const io = await database(root, LIVE, [old]);
    expect((await refusal(async () => runReset(await context(root, io), { expect: "app-db", allowUnbacked: false }))).message).toContain(
      `it was taken ${old.takenAt}, more than 24 hours ago`,
    );
  });

  it("refuses a dump whose takenAt is not an instant, or lies in the future, even when its census matches", async () => {
    for (const takenAt of ["", "2026-09-11T11:00:00.000Z"]) {
      const root = appRoot();
      const io = await database(root, LIVE, [{ ...sidecar(), takenAt }]);
      expect((await refusal(async () => runReset(await context(root, io), { expect: "app-db", allowUnbacked: false }))).message).toContain(
        `its takenAt ${JSON.stringify(takenAt)} is not an instant in the past`,
      );
    }
  });

  it("relies on the newest complete dump, passing over one with no sidecar", async () => {
    const root = appRoot();
    const io = await database(root, LIVE, [sidecar()]);
    const newer = backupKey(undefined, DB_ID, new Date("2026-09-11T09:30:00Z"), "local-2");
    (io.buckets.get("BACKUPS") as ReturnType<typeof fakeBackupBucket>).objects.set(newer, { bytes: new Uint8Array(1), customMetadata: {} });
    expect((await runReset(await context(root, io), { expect: "app-db", allowUnbacked: false })).backedUpBy).toBe(sidecar().key);
  });

  it("takes the dump --dump names, and refuses one taken from another database", async () => {
    const root = appRoot();
    const named = sidecar({ takenAt: "2026-09-11T08:00:00.000Z" });
    const foreign = sidecar({ databaseId: "other", key: backupKey(undefined, "other", new Date("2026-09-11T09:00:00Z"), "local-3") });
    const io = await database(root, LIVE, [sidecar(), named, foreign]);
    const run = await context(root, io);

    expect((await prepareReset(run, { expect: "app-db", allowUnbacked: false, dump: named.key })).backedUpBy).toBe(named.key);
    expect((await refusal(() => prepareReset(run, { expect: "app-db", allowUnbacked: false, dump: foreign.key }))).message).toBe(
      `app-db holds 2 rows and ${foreign.key} was taken from database other and this target is ${DB_ID}`,
    );
  });

  it("reads the dumps from the bucket --bucket names, and refuses when several are bound and none is BACKUPS", async () => {
    const root = appRoot({
      r2_buckets: [
        { binding: "ARCHIVE", bucket_name: "a" },
        { binding: "MEDIA", bucket_name: "m" },
      ],
    });
    const io = await database(root, LIVE, [sidecar()]);
    io.buckets.set("ARCHIVE", io.buckets.get("BACKUPS") ?? fakeBackupBucket());
    io.buckets.delete("BACKUPS");
    const run = await context(root, io);

    expect((await prepareReset(run, { expect: "app-db", allowUnbacked: false, bucket: "ARCHIVE" })).backedUpBy).toBe(sidecar().key);
    expect((await refusal(() => prepareReset(run, { expect: "app-db", allowUnbacked: false }))).message).toBe(
      `${join(root, "wrangler.jsonc")} binds several R2 buckets (ARCHIVE, MEDIA) and none named BACKUPS — pass --bucket`,
    );
  });

  it("refuses a local reset when another environment's database shares the state directory", async () => {
    const root = appRoot({
      env: { staging: { d1_databases: [{ binding: "DB", database_name: "app-db-staging", database_id: "1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }] } },
    });
    const io = await database(root, LIVE);
    expect((await refusal(async () => runReset(await context(root, io), { expect: "app-db", allowUnbacked: true }))).message).toBe(
      `${join(root, "wrangler.jsonc")} declares 2 d1 databases across its environments (app-db, app-db-staging) and the miniflare state filename is a hash — this tool cannot reset one of several`,
    );
  });

  it("empties an unbacked database when allowUnbacked says so, and reports no dump", async () => {
    const root = appRoot();
    const io = await database(root, LIVE);
    expect(await runReset(await context(root, io), { expect: "app-db", allowUnbacked: true })).toEqual({
      database: "app-db",
      rows: 2,
      removed: join(root, ".wrangler", "state", ...STATE),
      backedUpBy: null,
    });
  });
});
