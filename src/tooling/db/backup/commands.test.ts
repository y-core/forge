import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execute } from "../../cli/execute";
import { createDbCommands } from "../commands";
import { sha256 } from "../digest";
import {
  argvHas,
  bufferedIO,
  describeTableReply,
  fakeDbIo,
  jsonRows,
  keyProbeAsks,
  keyProbeReply,
  minimalWranglerConfig,
  OK,
  projectReadRows,
} from "../test-support";
import type { BackupManifest, FakeDbIo } from "../types";
import { BACKUP_FORMAT_VERSION, canonicaliseRow, manifestSelfDigest } from "./artifact";

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
    { uuid: "t2", lane: "a line\nand another" },
  ],
  d1_migrations: [{ id: 1, name: "0001_init" }],
  forge_migrations: [{ name: "0001_init", sha256: "ab" }],
};

/** A temp root holding a real `wrangler.jsonc`, which `resolveDbConfig` reads from the real filesystem. */
function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-backup-"));
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text);
  return root;
}

/** A fake wrangler answering the reads these verbs make, and writing `schema.sql` when asked to export. */
function fakeWrangler(rows: Readonly<Record<string, Record<string, unknown>[]>> = ROWS): FakeDbIo {
  const io = fakeDbIo();
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
      const statement = args[args.length - 1] ?? "";
      // The batched read `describeTable` makes names both, so it is recognised before either alone.
      const info = /pragma_table_info\('([^']+)'\)/.exec(statement);
      if (info !== null) {
        const table = info[1] ?? "";
        const columns = COLUMNS[table] ?? [];
        if (!statement.includes("sqlite_master")) return jsonRows(columns);
        return describeTableReply(columns, INVENTORY.find((object) => object.name === table)?.sql);
      }
      if (statement.includes("sqlite_master")) return jsonRows(INVENTORY);
      const probe = keyProbeAsks(statement);
      if (probe !== null) return keyProbeReply(rows[probe.table] ?? [], probe.column);
      const count = /^SELECT COUNT\(\*\) AS rows FROM "([^"]+)"$/.exec(statement);
      if (count !== null) return jsonRows([{ rows: (rows[count[1] ?? ""] ?? []).length }]);
      if (statement.startsWith("SELECT name FROM")) return jsonRows((rows.d1_migrations ?? []).map((row) => ({ name: row.name })));
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

async function runCli(io: FakeDbIo, argv: string[]): Promise<{ out: string[]; err: string[]; code: number | null }> {
  const buffer = bufferedIO();
  try {
    await execute(createDbCommands({ io }), argv, buffer);
  } catch {
    // `bufferedIO().exit` throws so a failing run stops here rather than ending the process.
  }
  return buffer;
}

describe("forge db backup", () => {
  it("writes the four artifact files and a manifest naming what it proved", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const buffer = await runCli(io, ["backup", "--root", root, "--yes"]);
    const directory = join(root, ".forge/backups", "app-db-20260911T100000Z");
    const manifest = JSON.parse(io.files.get(join(directory, "manifest.json")) ?? "{}") as BackupManifest;

    expect(buffer.err).toEqual([]);
    expect(buffer.out).toEqual([`✓ ${directory}`, "  route full: 0 divergent", "  route migrations: 0 divergent"]);
    expect([...io.files.keys()].filter((path) => path.startsWith(`${directory}/`)).sort()).toEqual([
      join(directory, "data.sql"),
      join(directory, "full.sql"),
      join(directory, "manifest.json"),
      join(directory, "schema.sql"),
    ]);
    expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.createdAt).toBe("2026-09-11T10:00:00.000Z");
    expect(manifest.label).toBeNull();
    expect(manifest.dumper).toEqual({ tool: "forge db backup (schema via wrangler d1 export --no-data)", version: "wrangler 4.105.0" });
    expect(manifest.database).toEqual({
      name: "app-db",
      id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      target: "local",
      persistPath: join(root, ".wrangler", "state"),
    });
    expect(manifest.schema.migrations).toEqual(["0001_init"]);
    expect(manifest.tables).toEqual([{ name: "tasks", rows: 2, digest: manifest.tables[0]?.digest ?? "" }]);
    expect(manifest.artifacts.map((artifact) => artifact.file)).toEqual(["full.sql", "data.sql", "schema.sql"]);
    expect(manifest.warnings).toEqual([]);
    expect(manifest.verified).toEqual([
      { route: "full", divergent: 0 },
      { route: "migrations", divergent: 0 },
    ]);
  });

  it("authors data.sql itself, carrying a newline on a token rather than on wrangler's escape", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    await runCli(io, ["backup", "--root", root, "--yes", "--no-verify"]);
    const directory = join(root, ".forge/backups", "app-db-20260911T100000Z");

    expect(io.files.get(join(directory, "data.sql"))).toBe(
      [
        "PRAGMA defer_foreign_keys=TRUE;",
        `INSERT INTO "tasks" ("uuid","lane") VALUES ('t1','todo');`,
        `INSERT INTO "tasks" ("uuid","lane") VALUES ('t2',replace('a line~~N~~and another','~~N~~',char(10)));`,
        `INSERT INTO "forge_migrations" ("name","sha256") VALUES ('0001_init','ab');`,
        "",
      ].join("\n"),
    );
  });

  it("records that --no-verify proved nothing, and verifies nothing", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const buffer = await runCli(io, ["backup", "--root", root, "--yes", "--no-verify", "--label", "before the cut"]);
    const directory = join(root, ".forge/backups", "app-db-20260911T100000Z");
    const manifest = JSON.parse(io.files.get(join(directory, "manifest.json")) ?? "{}") as BackupManifest;

    expect(manifest.verified).toEqual([]);
    expect(manifest.label).toBe("before the cut");
    expect(manifest.warnings).toEqual(["--no-verify: nothing in this artifact has been proven to rebuild"]);
    expect(buffer.out).toEqual([`✓ ${directory}`, "  ! --no-verify: nothing in this artifact has been proven to rebuild"]);
  });

  it("backs up a deployed database without asking, and prints the note that restore is refused there", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["backup", "--root", root, "--target", "remote", "--no-verify"]);
    const directory = join(root, ".forge/backups", "app-db-20260911T100000Z");

    expect(buffer.err).toEqual([]);
    expect(buffer.out).toEqual([
      `✓ ${directory}`,
      "  ! --no-verify: nothing in this artifact has been proven to rebuild",
      "  ! taken from remote: restore is refused for remote and preview — this artifact restores into local, standby, or a rehearsal scratch",
    ]);
  });
});

/** A manifest as an artifact directory holds it: the digest over everything else in it, filled in. */
function written(manifest: BackupManifest): BackupManifest {
  const blank = { ...manifest, selfDigest: "" };
  return { ...blank, selfDigest: manifestSelfDigest(blank) };
}

const MANIFEST: BackupManifest = {
  formatVersion: BACKUP_FORMAT_VERSION,
  createdAt: "2026-09-11T10:00:00.000Z",
  label: null,
  dumper: { tool: "forge db backup", version: "wrangler 4.105.0" },
  database: { name: "other-db", id: null, target: "local", persistPath: null },
  schema: { migrations: ["0001_init"], digest: "a".repeat(64), migrationsDigest: "b".repeat(64) },
  migrations: [{ name: "0001_init", sha256: "d".repeat(64) }],
  tables: [
    {
      name: "tasks",
      rows: 2,
      digest: sha256((ROWS.tasks ?? []).map((row) => canonicaliseRow(["uuid", "lane"], "uuid", row).canonical).join("\n")),
    },
  ],
  artifacts: [],
  warnings: [],
  verified: [{ route: "full", divergent: 0 }],
  selfDigest: "",
};

describe("forge db restore", () => {
  it("refuses an artifact taken from a database --expect does not name", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeWrangler();
    io.writeText(join(artifact, "manifest.json"), JSON.stringify(written(MANIFEST)));
    io.writeText(join(artifact, "data.sql"), "PRAGMA defer_foreign_keys=TRUE;\n");
    const buffer = await runCli(io, ["restore", "--root", root, "--artifact", artifact, "--expect", "app-db", "--yes"]);

    expect(buffer.err).toEqual(["Error: --expect app-db does not match this artifact, which was taken from other-db"]);
  });

  it("refuses a directory with no manifest, naming what --artifact takes", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["restore", "--root", root, "--artifact", join(root, "nowhere"), "--yes"]);

    expect(buffer.err).toEqual([
      `Error: ${join(root, "nowhere", "manifest.json")} does not exist — --artifact takes the directory, not a file inside it`,
    ]);
  });

  it("refuses a target that already holds rows, and names the verb that empties one", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeWrangler();
    io.writeText(join(artifact, "manifest.json"), JSON.stringify(written({ ...MANIFEST, database: { ...MANIFEST.database, name: "app-db" } })));
    io.writeText(join(artifact, "data.sql"), "PRAGMA defer_foreign_keys=TRUE;\n");
    const buffer = await runCli(io, ["restore", "--root", root, "--artifact", artifact, "--yes"]);

    expect(buffer.err).toEqual([
      "Error: app-db already holds data (tasks 2, forge_migrations 1) — run `forge db reset` first; a restore adds rows and never removes them",
    ]);
  });

  it("refuses before it asks, so a refused restore never prints the confirmation", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeWrangler();
    io.writeText(join(artifact, "manifest.json"), JSON.stringify(written({ ...MANIFEST, database: { ...MANIFEST.database, name: "app-db" } })));
    io.writeText(join(artifact, "data.sql"), "PRAGMA defer_foreign_keys=TRUE;\n");
    const buffer = await runCli(io, ["restore", "--root", root, "--artifact", artifact]);

    expect(buffer.out).toEqual([]);
    expect(buffer.err).toEqual([
      "Error: app-db already holds data (tasks 2, forge_migrations 1) — run `forge db reset` first; a restore adds rows and never removes them",
    ]);
  });

  it("refuses a deployed database, naming Time Travel as the route there", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["restore", "--root", root, "--target", "remote", "--artifact", root, "--yes"]);

    expect(buffer.err).toEqual([
      "Error: restore is refused for remote — return a deployed database to a point in time with `forge db bookmark restore`, which is D1's own undo",
    ]);
  });
});

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

  it("refuses to empty a database that holds rows and has no verified backup", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db", "--yes"]);

    expect(buffer.err).toEqual([
      `Error: app-db holds 2 rows and no verified backup of it exists under ${join(root, ".forge/backups")} — run \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
    ]);
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses before it asks, so a refused reset never prints the confirmation", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db"]);

    expect(buffer.out).toEqual([]);
    expect(buffer.err).toEqual([
      `Error: app-db holds 2 rows and no verified backup of it exists under ${join(root, ".forge/backups")} — run \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
    ]);
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("empties a database with no verified backup when --allow-unbacked says so", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db", "--yes", "--allow-unbacked"]);

    expect(buffer.err).toEqual([]);
    expect(buffer.out).toEqual([`✓ removed ${state} (2 rows) — miniflare recreates it on next use`]);
    expect(io.exists(join(state, "db.sqlite"))).toBe(false);
  });

  it("empties a database a verified backup names, and says which artifact proved it", async () => {
    const root = appRoot();
    const io = fakeWrangler();
    const state = join(root, ".wrangler", "state", ...STATE);
    io.writeText(join(state, "db.sqlite"), "");
    const backup = join(root, ".forge/backups", "app-db-20260911T090000Z");
    io.writeText(join(backup, "manifest.json"), JSON.stringify(written({ ...MANIFEST, database: { ...MANIFEST.database, name: "app-db" } })));
    const buffer = await runCli(io, ["reset", "--root", root, "--expect", "app-db", "--yes"]);

    expect(buffer.out).toEqual(["  backed up by app-db-20260911T090000Z", `✓ removed ${state} (2 rows) — miniflare recreates it on next use`]);
  });

  it("says there is nothing to remove when the state directory is absent", async () => {
    const root = appRoot();
    const buffer = await runCli(fakeWrangler(), ["reset", "--root", root, "--expect", "app-db", "--yes"]);

    expect(buffer.out).toEqual(["✓ app-db has no local state to remove"]);
  });

  it("refuses a local reset when the config declares more than one database", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-db-backup-"));
    const config = minimalWranglerConfig(root, {
      d1_databases: [
        { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" },
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
