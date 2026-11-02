import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeBackupBucket } from "../../../storage/backup/backup.fixture";
import { backupKey } from "../../../storage/backup/list";
import { writeSidecar } from "../../../storage/backup/sidecar";
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
import { createBackupCommands } from "./commands";

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
    bucket.objects.set(key, { bytes: new Uint8Array(1), customMetadata: {} });
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
