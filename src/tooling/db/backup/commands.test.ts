import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { readD1Backup } from "../../../storage/backup/sidecar";
import { CliError } from "../../cli/errors";
import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import {
  bufferedIO,
  cfEnvelope,
  fakeDbIo,
  keyProbeAsked,
  keyProbeReply,
  minimalWranglerConfig,
  keysetPageReply,
  tableInfoAsked,
  tableSqlAsked,
  tableSqlReply,
  r2RestRules,
  REMOTE_ARGS,
  REMOTE_AUTH,
} from "../db.fixture";
import { sha256 } from "../digest";
import { RECORDED_CHECKSUM_SELECT } from "../migrate/checksum";
import type { FakeDbIo, Home } from "../types";
import { fakeD1Rest, fakeDatabase } from "./backup.fixture";
import { takeD1Census } from "./census";
import { createBackupCommands } from "./commands";
import { backupKey, writeSidecar } from "./store";
import type { BackupDatabase } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SCHEMA_SQL = [
  "PRAGMA defer_foreign_keys=TRUE;",
  "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);",
  "CREATE TABLE _forge_migrations (name TEXT PRIMARY KEY, sha256 TEXT);",
  "DELETE FROM sqlite_sequence;",
  "",
].join("\n");

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "_forge_migrations", tbl_name: "_forge_migrations", sql: "CREATE TABLE _forge_migrations (name TEXT PRIMARY KEY)" },
];

const COLUMNS: Readonly<Record<string, Record<string, unknown>[]>> = {
  tasks: [
    { cid: 0, name: "uuid", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "lane", type: "TEXT", notnull: 1, dflt_value: "''", pk: 0 },
  ],
  _forge_migrations: [
    { cid: 0, name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "sha256", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  ],
};

const ROWS: Readonly<Record<string, Record<string, unknown>[]>> = {
  tasks: [
    { uuid: "t1", lane: "todo" },
    { uuid: "t2", lane: "a line\nand another" },
  ],
  _forge_migrations: [{ name: "0001_init", sha256: "ab" }],
};

/** A temp root holding a real `wrangler.jsonc`, which `resolveDbConfig` reads from the real filesystem. */
function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-backup-"));
  roots.push(root);
  const config = minimalWranglerConfig(root, { r2_buckets: [{ binding: "BACKUPS", bucket_name: "app-backups" }] });
  writeFileSync(config.path, config.text);
  return root;
}

const REMOTE_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const SIGNED_URL = "https://d1-exports.example.com/schema.sql";

const REMOTE_HOME: Home = {
  label: "remote",
  database: "app-db",
  binding: "DB",
  dir: "/app",
  configPath: "/app/wrangler.jsonc",
  persistTo: null,
  place: "remote",
  env: null,
  databaseId: REMOTE_ID,
  auth: REMOTE_AUTH,
  synthesized: false,
};

/** A fake answering the reads these verbs make in process and over REST, and serving `schema.sql` when D1's export is asked for it. */
function fakeWrangler(rows: Readonly<Record<string, Record<string, unknown>[]>> = ROWS): FakeDbIo {
  const io = fakeDbIo({}, { homes: [REMOTE_HOME] });
  io.restRules.push(
    {
      match: (url) => url.endsWith("/export"),
      reply: () => cfEnvelope({ status: "complete", at_bookmark: "bm-schema", result: { filename: "schema.sql", signed_url: SIGNED_URL } }),
    },
    { match: (url) => url === SIGNED_URL, reply: () => new Response(SCHEMA_SQL) },
  );
  const answer = (statement: string): Record<string, unknown>[] => {
    const info = tableInfoAsked(statement);
    if (info !== null) return COLUMNS[info] ?? [];
    const ddl = tableSqlAsked(statement);
    if (ddl !== null) return tableSqlReply(INVENTORY.find((object) => object.name === ddl)?.sql);
    if (statement.includes("sqlite_master")) return INVENTORY;
    const probe = keyProbeAsked(statement);
    if (probe !== null) return keyProbeReply(probe.asks, rows[probe.table] ?? [], probe.column);
    const count = /^SELECT COUNT\(\*\) AS rows FROM "([^"]+)"$/.exec(statement);
    if (count !== null) return [{ rows: (rows[count[1] ?? ""] ?? []).length }];
    if (statement === RECORDED_CHECKSUM_SELECT) return (rows._forge_migrations ?? []).map((row) => ({ name: row.name }));
    return keysetPageReply(statement, rows) ?? [];
  };
  io.d1Rules.push({ match: () => true, reply: answer });
  return io;
}

async function runCli(io: FakeDbIo, argv: string[]): Promise<{ out: string[]; err: string[]; code: number | null }> {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so a failing run stops here rather than ending the process.
  }
  return buffer;
}

describe("forge db reset", () => {
  const STATE = ["v3", "d1", "miniflare-D1DatabaseObject"];

  it("refuses a deployed database, naming the bookmark verb", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["reset", "--root", root, "--target", "remote", "--expect", "app-db", "--yes"]);

    expect(buffer.err).toEqual([
      "Error: remote cannot be reset from here — return a deployed database to a point in time with `forge db bookmark restore`, or replace it with `wrangler d1 create`",
    ]);
  });

  it("refuses an --expect that does not name this target", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["reset", "--root", root, "--expect", "other-db", "--yes"]);

    expect(buffer.err).toEqual(["Error: --expect other-db does not name this target, which is app-db"]);
  });

  it("refuses to empty a database that holds rows and has no complete dump", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    io.buckets.set("BACKUPS", fakeBackupBucket());
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db", "--yes"]);

    expect(buffer.err).toEqual([
      `Error: app-db holds 2 rows and no complete dump of app-db under BACKUPS:d1-backups/${REMOTE_ID}/ — run \`forge db backup\` first`,
    ]);
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses before it asks, so a refused reset never prints the confirmation", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    io.buckets.set("BACKUPS", fakeBackupBucket());
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db"]);

    expect(buffer.out).toEqual([]);
    expect(buffer.err).toEqual([
      `Error: app-db holds 2 rows and no complete dump of app-db under BACKUPS:d1-backups/${REMOTE_ID}/ — run \`forge db backup\` first`,
    ]);
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("empties a database with no dump when --allow-unbacked says so", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db", "--yes", "--allow-unbacked"]);

    expect(buffer.err).toEqual([]);
    expect(buffer.out).toEqual([`✓ removed ${state} (2 rows) — miniflare recreates it on next use`]);
    expect(io.exists(join(state, "db.sqlite"))).toBe(false);
  });

  it("empties a database a complete dump describes, and says which dump proved it", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    const bucket = fakeBackupBucket();
    const key = backupKey(undefined, REMOTE_ID, new Date("2026-09-11T09:00:00Z"), "local-1");
    bucket.objects.set(key, { bytes: new Uint8Array(1) });
    await writeSidecar(bucket, {
      key,
      databaseId: REMOTE_ID,
      bookmark: "local-1",
      takenAt: "2026-09-11T09:00:00.000Z",
      size: 1,
      md5: "0".repeat(32),
      sha256: "1".repeat(64),
      schemaDigest: "2".repeat(64),
      migrationHead: null,
      rows: { tasks: 2, _forge_migrations: 1 },
      hazards: [],
    });
    io.buckets.set("BACKUPS", bucket);
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db", "--yes"]);

    expect(buffer.err).toEqual([]);
    expect(buffer.out).toEqual([`  backed up by ${key}`, `✓ removed ${state} (2 rows) — miniflare recreates it on next use`]);
  });

  it("says there is nothing to remove when the state directory is absent", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["reset", "--root", root, "--expect", "app-db", "--yes"]);

    expect(buffer.out).toEqual(["✓ app-db has no local state to remove"]);
  });

  it("refuses a local reset when the config declares more than one database", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-db-backup-"));
    roots.push(root);
    const config = minimalWranglerConfig(root, {
      d1_databases: [
        { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "config/db/migrations" },
        { binding: "LOGS", database_name: "log-db", database_id: "1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" },
      ],
    });
    writeFileSync(config.path, config.text);
    const buffer = await runCli(fakeWrangler(), ["reset", "--root", root, "--db", "DB", "--expect", "app-db", "--yes"]);

    expect(buffer.err).toEqual([
      `Error: ${config.path} declares 2 d1 databases across its environments (app-db, log-db) and the miniflare state filename is a hash — this tool cannot reset one of several`,
    ]);
  });
});

describe("forge db backup list / pull / push", () => {
  const KEY = backupKey(undefined, REMOTE_ID, new Date("2026-09-11T09:00:00Z"), "local-1");
  const DUMP = "PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE notes (body TEXT);\n";
  const SIDECAR = {
    key: KEY,
    databaseId: REMOTE_ID,
    bookmark: "local-1",
    takenAt: "2026-09-11T09:00:00.000Z",
    size: DUMP.length,
    md5: "0".repeat(32),
    sha256: sha256(DUMP),
    schemaDigest: "2".repeat(64),
    migrationHead: null,
    rows: {},
    hazards: [],
  };

  async function holding(dump: string): Promise<FakeDbIo> {
    const io = fakeWrangler();
    const bucket = fakeBackupBucket();
    await bucket.put(KEY, dump);
    await writeSidecar(bucket, SIDECAR);
    io.restRules.push(...r2RestRules(bucket));
    io.buckets.set("BACKUPS", bucket);
    return io;
  }

  it("hangs list, pull and push under backup, which stays runnable bare", () => {
    const [backup] = createBackupCommands();
    expect([backup?.commands.map((command) => command.name), backup !== undefined && "run" in backup]).toEqual([["list", "pull", "push"], true]);
  });

  it("lists a deployed bucket's dumps as JSON on --json", async () => {
    const root = appRoot();
    const buffer = await runCli(await holding(DUMP), ["backup", "list", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--json"]);
    expect(buffer.err).toEqual([]);
    expect(JSON.parse(buffer.out.join(""))).toEqual([
      { key: KEY, databaseId: REMOTE_ID, takenAt: "2026-09-11T09:00:00.000Z", bookmark: "local-1", size: DUMP.length, complete: true },
    ]);
  });

  it("lists a local bucket's dumps as one line each", async () => {
    const root = appRoot();
    const buffer = await runCli(await holding(DUMP), ["backup", "list", "--root", root]);
    expect(buffer.out).toEqual([`${KEY}  ${DUMP.length} bytes  2026-09-11T09:00:00.000Z  complete`]);
  });

  it("pulls a dump to --out and pushes it back, and exits non-zero on a pull whose bytes are corrupted, keeping no file", async () => {
    const root = appRoot();
    const out = join(root, "copies");
    const io = await holding(DUMP);
    const pulled = await runCli(io, ["backup", "pull", KEY, "--root", root, "--target", "remote", ...REMOTE_ARGS, "--out", out]);
    expect([pulled.err, pulled.code]).toEqual([[], null]);
    const file = join(out, KEY.split("/").at(-1) ?? "");
    expect(io.files.get(file)).toBe(DUMP);

    const pushed = await runCli(io, ["backup", "push", file, "--root", root, "--target", "remote", ...REMOTE_ARGS]);
    expect(pushed.err).toEqual([`Error: BACKUPS already holds ${KEY} — push never replaces an object`]);

    const corrupted = await holding(`${DUMP.slice(0, -2)}X\n`);
    const refused = await runCli(corrupted, ["backup", "pull", KEY, "--root", root, "--target", "remote", ...REMOTE_ARGS, "--out", out]);
    expect([refused.code !== 0 && refused.code !== null, corrupted.files.has(file)]).toEqual([true, false]);
  });
});

const DUMP = [
  "PRAGMA defer_foreign_keys=TRUE;",
  'CREATE TABLE IF NOT EXISTS "_forge_migrations" (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
  `INSERT INTO "_forge_migrations" ("id","name") VALUES(1,'0001_notes.sql');`,
  'CREATE TABLE IF NOT EXISTS "notes" (id INTEGER PRIMARY KEY, body TEXT);',
  `INSERT INTO "notes" ("id","body") VALUES(1,'one; two');`,
  `INSERT INTO "notes" ("id","body") VALUES(2,'three');`,
].join("\n");

const DUMP_STATEMENTS = 6;

const DUMP_KEY = `d1-backups/${REMOTE_ID}/2026-09-10T03:00:00.000Z-B1.sql`;

const NOW = "2026-09-11T10:00:00.000Z";

const NOW_MS = Date.parse(NOW);

const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb";

const SIGNED_DUMP = "https://d1-exports.example.com/dump.sql?X-Amz-Signature=deadbeef";

const hexOf = (algorithm: string, text: string) => createHash(algorithm).update(text).digest("hex");

const bytesOf = (text: string) => new TextEncoder().encode(text).byteLength;

const reportKeys = (bucket: FakeBackupBucket) => [...bucket.objects.keys()].filter((key) => key.includes("/restores/"));

/** A local binding over `dump` that answers miniflare's export pragma with the dump's statements, as miniflare does. */
function localBinding(dump = DUMP): BackupDatabase {
  const database = fakeDatabase(dump);
  return {
    batch: (statements) => database.batch(statements),
    prepare: (query) =>
      query === "PRAGMA miniflare_d1_export(?,?,?);"
        ? { all: async () => ({ results: [] }), bind: () => ({ raw: async () => [dump.split("\n")] }) }
        : database.prepare(query),
  };
}

/** A deployed database whose REST queries a SQLite copy of `DUMP` answers, and whose export completes at `BOOKMARK` with `DUMP`. */
function deployedSource(startReply?: Response): { io: FakeDbIo; bucket: FakeBackupBucket } {
  const io = fakeDbIo({}, { homes: [REMOTE_HOME] });
  const source = fakeDatabase(DUMP);
  const bucket = fakeBackupBucket();
  io.d1Rules.push({ match: () => true, reply: (statement) => source.sqlite.query(statement).all() as Record<string, unknown>[] });
  io.restRules.push(
    {
      match: (url) => url.endsWith("/export"),
      reply: (_url, init) => {
        const started = (JSON.parse(String(init?.body)) as { current_bookmark?: string }).current_bookmark !== undefined;
        if (!started) return startReply ?? cfEnvelope({ status: "active", at_bookmark: BOOKMARK });
        return cfEnvelope({ status: "complete", at_bookmark: BOOKMARK, result: { filename: "dump.sql", signed_url: SIGNED_DUMP } });
      },
    },
    { match: (url) => url === SIGNED_DUMP, reply: () => new Response(DUMP, { headers: { "content-length": String(bytesOf(DUMP)) } }) },
    ...r2RestRules(bucket),
  );
  return { io, bucket };
}

function localSource(): { io: FakeDbIo; bucket: FakeBackupBucket } {
  const io = fakeDbIo();
  const bucket = fakeBackupBucket();
  io.buckets.set("BACKUPS", bucket);
  io.databases.set("DB", localBinding());
  return { io, bucket };
}

describe("forge db backup", () => {
  const REMOTE_KEY = `d1-backups/${REMOTE_ID}/${NOW}-${BOOKMARK}.sql`;

  it("exports a deployed database into R2 beside its sidecar and prints what it stored, starting no Workflow", async () => {
    const root = appRoot();
    const { io, bucket } = deployedSource();
    const buffer = await runCli(io, ["backup", "--root", root, "--target", "remote", ...REMOTE_ARGS]);

    expect([buffer.err, buffer.code]).toEqual([[], null]);
    expect(buffer.out).toEqual([
      `✓ ${REMOTE_KEY}`,
      `  ${bytesOf(DUMP)} bytes at bookmark ${BOOKMARK}, migration head 0001_notes.sql`,
      "  rows: _forge_migrations 1, notes 2",
    ]);
    expect([bucket.objects.get(REMOTE_KEY)?.bytes.toBase64(), (await readD1Backup(bucket, REMOTE_KEY))?.sha256]).toEqual([
      new TextEncoder().encode(DUMP).toBase64(),
      hexOf("sha256", DUMP),
    ]);
    expect([io.restCalls.some((call) => call.url.endsWith("/export")), io.restCalls.filter((call) => call.url.includes("/workflows/"))]).toEqual([
      true,
      [],
    ]);
  });

  it("exports a local database through miniflare's dumper, stamping the run's clock and making no REST call", async () => {
    const root = appRoot();
    const { io, bucket } = localSource();
    const buffer = await runCli(io, ["backup", "--root", root]);

    const key = `d1-backups/${REMOTE_ID}/${NOW}-local-${NOW_MS}.sql`;
    const sidecar = await readD1Backup(bucket, key);
    expect([buffer.err, sidecar?.bookmark, sidecar?.takenAt, sidecar?.rows, io.restCalls]).toEqual([
      [],
      `local-${NOW_MS}`,
      NOW,
      { _forge_migrations: 1, notes: 2 },
      [],
    ]);
  });

  it("prunes an older complete dump past --keep", async () => {
    const root = appRoot();
    const { io, bucket } = localSource();
    const older = `d1-backups/${REMOTE_ID}/2026-09-10T03:00:00.000Z-local-1.sql`;
    bucket.objects.set(older, { bytes: new Uint8Array(1) });
    await writeSidecar(bucket, { ...(await seededSidecar()), key: older });
    const buffer = await runCli(io, ["backup", "--root", root, "--keep", "1"]);

    const kept = `d1-backups/${REMOTE_ID}/${NOW}-local-${NOW_MS}`;
    expect([buffer.err, [...bucket.objects.keys()].sort()]).toEqual([[], [`${kept}.json`, `${kept}.sql`]]);
  });

  it("says the dump is stored, and never to run the backup again, when only the prune after it fails", async () => {
    const root = appRoot();
    const { io, bucket } = localSource();
    const older = `d1-backups/${REMOTE_ID}/2026-09-10T03:00:00.000Z-local-1.sql`;
    bucket.objects.set(older, { bytes: new Uint8Array(1) });
    await writeSidecar(bucket, { ...(await seededSidecar()), key: older });
    bucket.delete = () => Promise.reject(new CliError("external", "deleting from BACKUPS failed: HTTP 500"));
    const buffer = await runCli(io, ["backup", "--root", root, "--keep", "1"]);

    const kept = `d1-backups/${REMOTE_ID}/${NOW}-local-${NOW_MS}.sql`;
    expect([buffer.code, buffer.err, (await readD1Backup(bucket, kept))?.key]).toEqual([
      1,
      [
        `Error: ${kept} and its sidecar are stored, but pruning to the newest 1 failed: deleting from BACKUPS failed: HTTP 500 — the next \`forge db backup --keep 1\` prunes again`,
      ],
      kept,
    ]);
  });

  it("refuses a config whose only R2 bucket is not BACKUPS, before any request, writing nothing there", async () => {
    const root = appRoot();
    const config = minimalWranglerConfig(root, { r2_buckets: [{ binding: "UPLOADS", bucket_name: "app-uploads" }] });
    writeFileSync(config.path, config.text);
    const { io } = localSource();
    const uploads = fakeBackupBucket();
    io.buckets.set("UPLOADS", uploads);
    const buffer = await runCli(io, ["backup", "--root", root]);

    expect([buffer.code, buffer.err, io.restCalls, uploads.objects.size]).toEqual([
      1,
      [
        `Error: ${config.path} binds no R2 bucket named BACKUPS (it binds UPLOADS) — declare one in r2_buckets to keep the dumps apart from other data, or pass --bucket`,
      ],
      [],
      0,
    ]);
  });

  it("refuses a --keep that is not a number before any request", async () => {
    const root = appRoot();
    const { io, bucket } = deployedSource();
    const buffer = await runCli(io, ["backup", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--keep", "x"]);

    expect([buffer.err, buffer.code, io.restCalls, bucket.objects.size]).toEqual([["Error: --keep takes a number of dumps, not x"], 1, [], 0]);
  });

  it("prints the sidecar alone on --json", async () => {
    const root = appRoot();
    const { io, bucket } = localSource();
    const buffer = await runCli(io, ["backup", "--root", root, "--json"]);

    const stored = await readD1Backup(bucket, `d1-backups/${REMOTE_ID}/${NOW}-local-${NOW_MS}.sql`);
    expect([buffer.out.length, JSON.parse(buffer.out.join(""))]).toEqual([1, stored]);
  });

  it("exits 1 on a failed export, saying to run the backup again", async () => {
    const root = appRoot();
    const { io, bucket } = deployedSource(cfEnvelope({ status: "error", error: "the database is busy" }));
    const buffer = await runCli(io, ["backup", "--root", root, "--target", "remote", ...REMOTE_ARGS]);

    expect([buffer.err, buffer.code, bucket.objects.size]).toEqual([
      [
        "Error: D1 refused to start the export: the database is busy\nno sidecar was written, so this run left no complete dump — run `forge db backup` again",
      ],
      1,
      0,
    ]);
  });
});

/** The sidecar `forge db backup` would have written for `DUMP` at `DUMP_KEY`. */
async function seededSidecar(rows: Record<string, number> = { _forge_migrations: 1, notes: 2 }) {
  return {
    key: DUMP_KEY,
    databaseId: REMOTE_ID,
    bookmark: "B1",
    takenAt: "2026-09-10T03:00:00.000Z",
    size: bytesOf(DUMP),
    md5: hexOf("md5", DUMP),
    sha256: hexOf("sha256", DUMP),
    rows,
    ...(await takeD1Census(fakeDatabase(DUMP))),
  };
}

async function dumpBucket(rows?: Record<string, number>): Promise<FakeBackupBucket> {
  const bucket = fakeBackupBucket();
  await bucket.put(DUMP_KEY, DUMP);
  await writeSidecar(bucket, await seededSidecar(rows));
  return bucket;
}

/** A deployed account whose D1 REST API `rest` serves, and whose R2 holds `DUMP` at `DUMP_KEY`. */
async function deployedTarget(rest = fakeD1Rest()): Promise<{ io: FakeDbIo; bucket: FakeBackupBucket; rest: ReturnType<typeof fakeD1Rest> }> {
  const io = fakeDbIo({}, { homes: [REMOTE_HOME] });
  const bucket = await dumpBucket();
  io.restRules.push(...r2RestRules(bucket), {
    match: (url) => url.includes("/d1/database") || url.startsWith("https://upload.example.com/"),
    reply: (url, init) => rest.fetch(url, init),
  });
  return { io, bucket, rest };
}

async function localTarget(standby: string, rows?: Record<string, number>): Promise<{ io: FakeDbIo; bucket: FakeBackupBucket }> {
  const io = fakeDbIo();
  const bucket = await dumpBucket(rows);
  io.buckets.set("BACKUPS", bucket);
  io.databases.set("DB", localBinding());
  io.databases.set("STANDBY", fakeDatabase(standby));
  return { io, bucket };
}

describe("forge db restore --from", () => {
  const FRESH = `app-db-restore-${NOW_MS}`;

  it("creates a fresh deployed database, imports the dump, prints the restore and keeps its report beside the dumps", async () => {
    const root = appRoot();
    const { io, bucket, rest } = await deployedTarget();
    const buffer = await runCli(io, ["restore", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY]);

    expect([buffer.err, buffer.code]).toEqual([[], null]);
    expect(buffer.out).toEqual([
      `✓ restored ${DUMP_KEY} into ${FRESH} (uuid-${FRESH}) at bookmark B-final`,
      "  it holds what the dump's sidecar recorded",
    ]);
    const stored = await bucket.get(`d1-backups/${REMOTE_ID}/restores/uuid-${FRESH}.json`);
    expect(JSON.parse((await stored?.text()) ?? "null")).toEqual({
      databaseId: `uuid-${FRESH}`,
      name: FRESH,
      key: DUMP_KEY,
      bookmark: "B-final",
      queries: DUMP_STATEMENTS,
      mismatches: [],
    });
    expect(rest.databases.get(`uuid-${FRESH}`)?.sqlite.query("SELECT body FROM notes ORDER BY id").all()).toEqual([
      { body: "one; two" },
      { body: "three" },
    ]);
  });

  it("prints on --json the report it stored", async () => {
    const root = appRoot();
    const { io, bucket } = await deployedTarget();
    const buffer = await runCli(io, ["restore", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY, "--json"]);

    const stored = await bucket.get(`d1-backups/${REMOTE_ID}/restores/uuid-${FRESH}.json`);
    expect([buffer.out.length, JSON.parse(buffer.out.join(""))]).toEqual([1, JSON.parse((await stored?.text()) ?? "null")]);
  });

  it("imports a local dump into an empty standby binding, making no REST call", async () => {
    const root = appRoot();
    const { io, bucket } = await localTarget("");
    const buffer = await runCli(io, ["restore", "--root", root, "--from", DUMP_KEY, "--into", "standby:STANDBY"]);

    expect([buffer.err, buffer.out, io.restCalls]).toEqual([
      [],
      [`✓ restored ${DUMP_KEY} into STANDBY (STANDBY)`, "  it holds what the dump's sidecar recorded"],
      [],
    ]);
    expect(reportKeys(bucket)).toEqual([`d1-backups/${REMOTE_ID}/restores/STANDBY.json`]);
  });

  it("refuses a local fresh restore before any request", async () => {
    const root = appRoot();
    const { io, bucket } = await localTarget("");
    const buffer = await runCli(io, ["restore", "--root", root, "--from", DUMP_KEY]);

    expect([buffer.err, buffer.code, io.restCalls, reportKeys(bucket)]).toEqual([
      ["Error: a local target cannot create a database — pass --into standby:<binding> to import into an empty standby"],
      1,
      [],
      [],
    ]);
  });

  it("refuses a standby that already holds a table, writing no report", async () => {
    const root = appRoot();
    const { io, bucket } = await localTarget("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);");
    const buffer = await runCli(io, ["restore", "--root", root, "--from", DUMP_KEY, "--into", "standby:STANDBY"]);

    expect([buffer.err, buffer.code, reportKeys(bucket)]).toEqual([
      ["Error: STANDBY already holds notes — a restore imports only into an empty database"],
      1,
      [],
    ]);
  });

  it("exits 1 on a restore that differs from the sidecar, still keeping its report", async () => {
    const root = appRoot();
    const { io, bucket } = await localTarget("", { _forge_migrations: 1, notes: 3 });
    const buffer = await runCli(io, ["restore", "--root", root, "--from", DUMP_KEY, "--into", "standby:STANDBY"]);

    expect([buffer.out, buffer.err, buffer.code]).toEqual([
      [`✗ restored ${DUMP_KEY} into STANDBY (STANDBY), but it differs from the dump's sidecar:`, "  ! notes holds 2 rows, but the dump holds 3"],
      ["Error: STANDBY differs from the dump's sidecar; the live database is untouched"],
      1,
    ]);
    const stored = await bucket.get(`d1-backups/${REMOTE_ID}/restores/STANDBY.json`);
    expect((JSON.parse((await stored?.text()) ?? "null") as { mismatches: string[] }).mismatches).toEqual([
      "notes holds 2 rows, but the dump holds 3",
    ]);
  });

  it("refuses an --into that is neither fresh nor standby:<id>, and a missing --from, before any request", async () => {
    const root = appRoot();
    const { io } = await deployedTarget();
    const into = await runCli(io, ["restore", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY, "--into", "elsewhere"]);
    const from = await runCli(io, ["restore", "--root", root, "--target", "remote", ...REMOTE_ARGS]);

    expect([into.err, into.code, from.code, from.err.join("\n").includes("--from"), io.restCalls]).toEqual([
      ["Error: --into takes fresh or standby:<id>, not elsewhere"],
      1,
      1,
      true,
      [],
    ]);
  });

  it("says to run the restore again into a new or empty database when the import fails, writing no report", async () => {
    const root = appRoot();
    const { io, bucket } = await deployedTarget(fakeD1Rest({ importError: "UNIQUE constraint failed" }));
    const buffer = await runCli(io, ["restore", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY]);

    expect([buffer.err, buffer.code, reportKeys(bucket)]).toEqual([
      [
        `Error: D1 reported the import into ${FRESH} failed: UNIQUE constraint failed\nthe restore did not finish — run \`forge db restore\` again into a new or empty database`,
      ],
      1,
      [],
    ]);
  });

  /** A temp root whose config names the database `name`, beside the BACKUPS bucket. */
  function namedRoot(name: string): string {
    const root = mkdtempSync(join(tmpdir(), "forge-db-backup-"));
    roots.push(root);
    const config = minimalWranglerConfig(root, {
      d1_databases: [{ binding: "DB", database_name: name, database_id: REMOTE_ID, migrations_dir: "config/db/migrations" }],
      r2_buckets: [{ binding: "BACKUPS", bucket_name: "app-backups" }],
    });
    writeFileSync(config.path, config.text);
    return root;
  }

  it("restores fresh a database whose 42-character name leaves the restored name at D1's 64-character limit", async () => {
    const name = "a".repeat(42);
    const { io, bucket } = await deployedTarget();
    const buffer = await runCli(io, ["restore", "--root", namedRoot(name), "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY]);

    expect([buffer.err, reportKeys(bucket)]).toEqual([[], [`d1-backups/${REMOTE_ID}/restores/uuid-${name}-restore-${NOW_MS}.json`]]);
  });

  it("refuses before any request a fresh restore of a 43-character name, which would pass D1's 64-character limit", async () => {
    const name = "a".repeat(43);
    const { io, bucket, rest } = await deployedTarget();
    const buffer = await runCli(io, ["restore", "--root", namedRoot(name), "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY]);

    expect([buffer.err, buffer.code, io.restCalls, rest.calls, reportKeys(bucket)]).toEqual([
      [
        `Error: ${name} is too long to restore fresh — ${name}-restore-${NOW_MS} would pass D1's 64-character database name limit, so pass --into standby:<id>`,
      ],
      1,
      [],
      [],
      [],
    ]);
  });
});

describe("forge db restore → promote", () => {
  it("round-trips the restore report into promote --restored", async () => {
    const restored = "9f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
    const root = appRoot();
    const { io } = await deployedTarget(fakeD1Rest({ id: () => restored }));
    const configPath = join(root, "wrangler.jsonc");
    io.writeText(configPath, minimalWranglerConfig(root, { r2_buckets: [{ binding: "BACKUPS", bucket_name: "app-backups" }] }).text);

    const restore = await runCli(io, ["restore", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--from", DUMP_KEY]);
    const promote = await runCli(io, ["promote", "--root", root, "--target", "remote", ...REMOTE_ARGS, "--restored", restored, "--yes"]);

    expect([restore.err, promote.err]).toEqual([[], []]);
    expect((JSON.parse(io.readText(configPath)) as { d1_databases: unknown[] }).d1_databases).toEqual([
      { binding: "DB", database_name: `app-db-restore-${NOW_MS}`, database_id: restored, migrations_dir: "config/db/migrations" },
    ]);
  });
});
