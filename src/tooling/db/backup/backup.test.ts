import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { resolveDbContext } from "../context";
import { sha256 } from "../digest";
import { toSchemaObjects } from "../sql";
import {
  argvHas,
  describeTableReply,
  fakeDbIo,
  jsonRows,
  keyProbeAsks,
  keyProbeReply,
  minimalWranglerConfig,
  OK,
  projectReadRows,
} from "../test-support";
import type { DbHostConfig, DbRunContext, FakeDbIo, SharedDbFlags } from "../types";
import { appSchemaDigestInput, schemaDigestInput, SqlReal } from "./artifact";
import { resolveBackupsDir, runBackup } from "./backup";

const SCHEMA_SQL = [
  "PRAGMA defer_foreign_keys=TRUE;",
  "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);",
  "CREATE TABLE forge_migrations (name TEXT PRIMARY KEY, sha256 TEXT);",
  "DELETE FROM sqlite_sequence;",
  "",
].join("\n");

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "d1_migrations", tbl_name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)" },
  { type: "table", name: "forge_migrations", tbl_name: "forge_migrations", sql: "CREATE TABLE forge_migrations (name TEXT PRIMARY KEY)" },
];

const COLUMNS: Readonly<Record<string, Record<string, unknown>[]>> = {
  tasks: [
    { cid: 0, name: "uuid", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "lane", type: "TEXT", notnull: 1, dflt_value: "''", pk: 0 },
  ],
  d1_migrations: [
    { cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  ],
  forge_migrations: [
    { cid: 0, name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "sha256", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  ],
};

const ROWS: Readonly<Record<string, Record<string, unknown>[]>> = {
  tasks: [
    { uuid: "t1", lane: "todo" },
    { uuid: "t2", lane: "doing" },
  ],
  d1_migrations: [{ id: 1, name: "0001_init" }],
  forge_migrations: [{ name: "0001_init", sha256: "ab" }],
};

const DIRECTORY_NAME = "app-db-20260911T100000Z";

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-backup-unit-"));
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text);
  return root;
}

function flags(root: string, over: Partial<SharedDbFlags> = {}): SharedDbFlags {
  return { target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, root, json: false, yes: true, ...over };
}

function context(root: string, io: FakeDbIo, over: Partial<SharedDbFlags> = {}, host: DbHostConfig = {}): Promise<DbRunContext> {
  return resolveDbContext(flags(root, over), undefined, { io, host });
}

/** What a fake database answers with, source side and — where they differ — on the scratch a proof restores into. */
interface FakeDatabase {
  readonly seed?: Record<string, string>;
  readonly columns?: Readonly<Record<string, Record<string, unknown>[]>>;
  readonly counts?: Readonly<Record<string, number>>;
  readonly scratchInventory?: Record<string, unknown>[];
  readonly scratchRows?: Readonly<Record<string, Record<string, unknown>[]>>;
}

/** A fake wrangler answering the reads a backup makes, and writing `schema.sql` when asked to export. */
function fakeWrangler(over: FakeDatabase = {}): FakeDbIo {
  const io = fakeDbIo(over.seed ?? {});
  io.rules.push({ match: (args) => argvHas(args, "--version"), reply: { code: 0, stdout: "wrangler 4.105.0\n", stderr: "" } });
  io.rules.push({
    match: (args) => argvHas(args, "export", "--output"),
    reply: (args) => {
      io.writeText(args[args.indexOf("--output") + 1] ?? "", SCHEMA_SQL);
      return OK;
    },
  });
  io.rules.push({ match: (args) => argvHas(args, "migrations", "apply"), reply: OK });
  io.rules.push({ match: (args) => argvHas(args, "execute", "--file"), reply: OK });
  io.rules.push({
    match: (args) => argvHas(args, "execute", "--command"),
    reply: (args) => {
      // A proof reads its scratch under a database named for the route, which is what tells the two apart.
      const scratch = args.some((arg) => arg.includes("-verify-"));
      const rows = scratch ? (over.scratchRows ?? ROWS) : ROWS;
      const statement = args[args.length - 1] ?? "";
      const inventory = scratch ? (over.scratchInventory ?? INVENTORY) : INVENTORY;
      // The batched read `describeTable` makes names both, so it is recognised before either alone.
      const info = /pragma_table_info\('([^']+)'\)/.exec(statement);
      if (info !== null) {
        const table = info[1] ?? "";
        const columns = (over.columns ?? COLUMNS)[table] ?? [];
        if (!statement.includes("sqlite_master")) return jsonRows(columns);
        return describeTableReply(columns, String(inventory.find((object) => object.name === table)?.sql ?? ""));
      }
      if (statement.includes("sqlite_master")) return jsonRows(inventory);
      const probe = keyProbeAsks(statement);
      if (probe !== null) return keyProbeReply(rows[probe.table] ?? [], probe.column);
      const count = /^SELECT COUNT\(\*\) AS rows FROM "([^"]+)"$/.exec(statement);
      if (count !== null) {
        const table = count[1] ?? "";
        return jsonRows([{ rows: scratch ? (rows[table] ?? []).length : (over.counts?.[table] ?? (ROWS[table] ?? []).length) }]);
      }
      if (statement.startsWith("SELECT name FROM")) return jsonRows((ROWS.d1_migrations ?? []).map((row) => ({ name: row.name })));
      const from = /FROM "([^"]+)"/.exec(statement);
      const key = /ORDER BY t\."([^"]+)"/.exec(statement)?.[1] ?? "";
      const after = /WHERE t\."[^"]+" > '?([^']*)'?\s+ORDER BY/.exec(statement);
      const limit = Number(/LIMIT (\d+)$/.exec(statement)?.[1] ?? 0);
      const all = rows[from?.[1] ?? ""] ?? [];
      const seek = after === null ? all : all.filter((row) => String(row[key]) > (after[1] ?? ""));
      return jsonRows(projectReadRows(seek.slice(0, limit)));
    },
  });
  return io;
}

function refusal(run: () => unknown): { kind: string; message: string } {
  try {
    run();
  } catch (error) {
    if (error instanceof CliError) return { kind: error.kind, message: error.message };
    throw error;
  }
  throw new Error("expected a CliError, and the call returned");
}

describe("resolveBackupsDir", () => {
  it("takes the out argument, then the host config, then `.forge/backups`, resolving each against the root", async () => {
    const root = appRoot();
    const plain = await context(root, fakeDbIo());
    const hosted = await context(root, fakeDbIo(), {}, { backupsDir: "var/dumps" });

    expect([
      resolveBackupsDir(plain),
      resolveBackupsDir(hosted),
      resolveBackupsDir(hosted, "elsewhere"),
      resolveBackupsDir(hosted, "/tmp/forge-absolute-backups"),
    ]).toEqual([join(root, ".forge/backups"), join(root, "var/dumps"), join(root, "elsewhere"), "/tmp/forge-absolute-backups"]);
  });
});

describe("runBackup", () => {
  it("writes the three artifacts and a manifest, and proves nothing when verify is off", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const outcome = runBackup(await context(root, io), { out: null, verify: false, label: "before the cut" });
    const directory = join(root, ".forge/backups", DIRECTORY_NAME);

    expect(outcome.directory).toBe(directory);
    expect([...io.files.keys()].filter((path) => path.startsWith(`${directory}/`)).sort()).toEqual([
      join(directory, "data.sql"),
      join(directory, "full.sql"),
      join(directory, "manifest.json"),
      join(directory, "schema.sql"),
    ]);
    expect(io.logs).toEqual(["read ✓ 2 rows across 1 tables", "artifacts ✓ full.sql, data.sql, schema.sql"]);
    expect(outcome.manifest.verified).toEqual([]);
    expect(outcome.manifest.warnings).toEqual(["--no-verify: nothing in this artifact has been proven to rebuild"]);
    expect(outcome.manifest.label).toBe("before the cut");
    expect(outcome.manifest.createdAt).toBe("2026-09-11T10:00:00.000Z");
    expect(outcome.manifest.database).toEqual({
      name: "app-db",
      id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      target: "local",
      persistPath: join(root, ".wrangler", "state"),
    });
    expect(outcome.manifest.tables.map((table) => ({ name: table.name, rows: table.rows }))).toEqual([{ name: "tasks", rows: 2 }]);
    expect(outcome.manifest.artifacts.map((artifact) => artifact.file)).toEqual(["full.sql", "data.sql", "schema.sql"]);
    expect(JSON.parse(io.files.get(join(directory, "manifest.json")) ?? "{}")).toEqual(outcome.manifest);
  });

  it("writes the artifact directory under out, resolved against the root", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const outcome = runBackup(await context(root, io), { out: "var/dumps", verify: false, label: null });

    expect(outcome.directory).toBe(join(root, "var/dumps", DIRECTORY_NAME));
    expect(io.files.has(join(root, "var/dumps", DIRECTORY_NAME, "manifest.json"))).toBe(true);
  });

  it("backs up a remote database read-only, proving into a local scratch", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const outcome = runBackup(await context(root, io, { target: "remote" }), { out: null, verify: true, label: null });
    const directory = join(root, ".forge/backups", DIRECTORY_NAME);

    const d1 = io.calls.filter((call) => call[1] === "d1");
    const database = (call: string[]) => (call[2] === "migrations" ? call[4] : call[3]) ?? "";
    const app = d1.filter((call) => database(call) === "app-db");
    const scratch = d1.filter((call) => database(call).includes("-verify-"));
    expect(app.length + scratch.length).toBe(d1.length);
    expect(app.length).toBeGreaterThan(0);
    expect(scratch.length).toBeGreaterThan(0);
    expect(app.every((call) => call.includes("--remote") && !call.includes("--persist-to"))).toBe(true);
    expect(app.some((call) => call[2] === "time-travel" || (call.includes("--yes") && call.includes("--file")))).toBe(false);
    expect(
      scratch.every(
        (call) =>
          call.includes("--local") &&
          !call.includes("--remote") &&
          (call[call.indexOf("--persist-to") + 1] ?? "").startsWith(join(root, ".forge", "scratch") + "/"),
      ),
    ).toBe(true);
    expect(d1.find((call) => call[2] === "export")?.slice(2)).toEqual([
      "export",
      "app-db",
      "-c",
      join(root, "wrangler.jsonc"),
      "--remote",
      "--output",
      join(directory, "schema.sql"),
      "--no-data",
    ]);
    expect(outcome.manifest.database).toEqual({ name: "app-db", id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", target: "remote", persistPath: null });
    expect(outcome.manifest.verified).toEqual([
      { route: "full", divergent: 0 },
      { route: "migrations", divergent: 0 },
    ]);
    expect(outcome.manifest.warnings).toEqual([
      "taken from remote: restore is refused for remote and preview — this artifact restores into local, standby, or a rehearsal scratch",
    ]);
    expect(io.files.has(join(root, ".forge", "db-apply.lock"))).toBe(false);
  });

  it("backs up a preview database with --remote --preview", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-db-backup-unit-"));
    const config = minimalWranglerConfig(root, {
      d1_databases: [
        {
          binding: "DB",
          database_name: "app-db",
          database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
          preview_database_id: "1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5b",
          migrations_dir: "migrations",
        },
      ],
    });
    writeFileSync(config.path, config.text);
    const io = fakeWrangler();
    const outcome = runBackup(await context(root, io, { target: "preview" }), { out: null, verify: false, label: null });
    const directory = join(root, ".forge/backups", DIRECTORY_NAME);

    expect(io.calls.find((call) => call[2] === "export")?.slice(2)).toEqual([
      "export",
      "app-db",
      "-c",
      join(root, "wrangler.jsonc"),
      "--remote",
      "--preview",
      "--output",
      join(directory, "schema.sql"),
      "--no-data",
    ]);
    expect(outcome.manifest.database.target).toBe("preview");
    expect(outcome.manifest.warnings).toEqual([
      "--no-verify: nothing in this artifact has been proven to rebuild",
      "taken from preview: restore is refused for remote and preview — this artifact restores into local, standby, or a rehearsal scratch",
    ]);
  });

  it("writes an integral REAL as 1.0 and proves it back with no divergence", async () => {
    const root = appRoot();
    const tasks = [
      { uuid: "t1", lane: "todo", weight: new SqlReal(1) },
      { uuid: "t2", lane: "doing", weight: new SqlReal(2.5) },
    ];
    const io = fakeWrangler({
      columns: { ...COLUMNS, tasks: [...(COLUMNS.tasks ?? []), { cid: 2, name: "weight", type: "REAL", notnull: 0, dflt_value: null, pk: 0 }] },
      scratchRows: { ...ROWS, tasks },
    });
    // The source is answered from the same rows the scratch is, so the proof compares a REAL read on both sides.
    io.rules.unshift({
      match: (args) => argvHas(args, "execute", "--command") && /FROM "tasks"/.test(args.at(-1) ?? "") && !/COUNT/.test(args.at(-1) ?? ""),
      reply: () => jsonRows(projectReadRows(tasks)),
    });
    const outcome = runBackup(await context(root, io), { out: null, verify: true, label: null });
    const directory = join(root, ".forge/backups", DIRECTORY_NAME);

    expect(io.files.get(join(directory, "data.sql"))?.split("\n").slice(1, 3)).toEqual([
      `INSERT INTO "tasks" ("uuid","lane","weight") VALUES ('t1','todo',1.0);`,
      `INSERT INTO "tasks" ("uuid","lane","weight") VALUES ('t2','doing',2.5);`,
    ]);
    expect(outcome.manifest.verified).toEqual([
      { route: "full", divergent: 0 },
      { route: "migrations", divergent: 0 },
    ]);
  });

  it("records the rows the artifact holds, not a count taken after them", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const outcome = runBackup(await context(root, io), { out: null, verify: false, label: null });

    expect(outcome.manifest.tables).toEqual([{ name: "tasks", rows: 2, digest: outcome.manifest.tables[0]?.digest ?? "" }]);
  });

  it("refuses a second backup in the same second, leaving the first artifact intact", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const run = await context(root, io);
    const directory = join(root, ".forge/backups", DIRECTORY_NAME);
    runBackup(run, { out: null, verify: false, label: null });
    const before = new Map([...io.files].filter(([path]) => path.startsWith(`${directory}/`)));

    expect(refusal(() => runBackup(run, { out: null, verify: false, label: null }))).toEqual({
      kind: "invalid-args",
      message: `${directory} already exists — a backup a second ago took this name; wait a second and take it again`,
    });
    expect(new Map([...io.files].filter(([path]) => path.startsWith(`${directory}/`)))).toEqual(before);
  });

  it("refuses an artifact torn by a write during the read, naming the table and writing no manifest", async () => {
    const root = appRoot();
    const io = fakeWrangler({ counts: { tasks: 3 } });
    const run = await context(root, io);
    const directory = join(root, ".forge/backups", DIRECTORY_NAME);

    expect(refusal(() => runBackup(run, { out: null, verify: false, label: null }))).toEqual({
      kind: "invalid-args",
      message: `app-db changed while it was being read, so this artifact is not a snapshot of any one instant:\n  tasks: 2 rows read and 3 now in the table\nStop whatever is writing to it and take the backup again — ${directory} is incomplete and holds no manifest, so no verb will read it.`,
    });
    expect(io.files.has(join(directory, "manifest.json"))).toBe(false);
  });

  it("counts a restored app schema that differs as a divergence on every route", async () => {
    const root = appRoot();
    const io = fakeWrangler({
      scratchInventory: [
        { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT, note TEXT)" },
        { type: "table", name: "d1_migrations", tbl_name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)" },
        { type: "table", name: "forge_migrations", tbl_name: "forge_migrations", sql: "CREATE TABLE forge_migrations (name TEXT PRIMARY KEY)" },
      ],
    });
    const run = await context(root, io);

    expect(refusal(() => runBackup(run, { out: null, verify: true, label: null })).message).toBe(
      "route full left 1 divergence(s); route migrations left 1 divergence(s)",
    );
    expect(io.logs.filter((line) => line.startsWith("    ✗ schema")).length).toBe(2);
    expect(io.files.has(join(root, ".forge/backups", DIRECTORY_NAME, "manifest.json"))).toBe(false);
  });

  it("records the app objects' digest as the schema digest — the value the proof compares, with the managed tables left out", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const outcome = runBackup(await context(root, io), { out: null, verify: false, label: null });

    expect(outcome.manifest.schema.digest).toBe(sha256(appSchemaDigestInput(toSchemaObjects(INVENTORY), "d1_migrations")));
    expect(outcome.manifest.schema.digest).not.toBe(sha256(schemaDigestInput(toSchemaObjects(INVENTORY))));
  });

  it("proves the companion tables as well as the app's own", async () => {
    const root = appRoot();
    const io = fakeWrangler({ scratchRows: { ...ROWS, forge_migrations: [{ name: "0001_init", sha256: "cd" }] } });
    const run = await context(root, io);

    expect(refusal(() => runBackup(run, { out: null, verify: true, label: null })).message).toBe(
      "route full left 1 divergence(s); route migrations left 1 divergence(s)",
    );
    expect(io.logs.filter((line) => line.includes("✗ forge_migrations")).length).toBe(2);
  });

  it("holds the apply lock for the run, and gives it back", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const lock = join(root, ".forge", "db-apply.lock");

    runBackup(await context(root, io), { out: null, verify: false, label: null });

    expect(io.files.has(lock)).toBe(false);
  });

  it("refuses while another run holds the lock, naming backup rather than apply", async () => {
    const root = appRoot();
    const lock = join(root, ".forge", "db-apply.lock");
    const io = fakeWrangler({ seed: { [lock]: JSON.stringify({ pid: 4242, startedAt: new Date("2026-09-11T09:59:00Z").getTime() }) } });
    const run = await context(root, io);

    expect(refusal(() => runBackup(run, { out: null, verify: false, label: null }))).toEqual({
      kind: "invalid-args",
      message: `Another backup holds ${lock} (pid 4242, since 2026-09-11T09:59:00.000Z). Wait for it to finish, or delete that file if the process is gone.`,
    });
    expect(io.calls).toEqual([]);
  });
});
