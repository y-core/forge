import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { resolveDbContext } from "../context";
import { sha256 } from "../digest";
import {
  argvHas,
  describeTableReply,
  fakeDbIo,
  jsonRows,
  keyProbeAsks,
  keyProbeReply,
  minimalWranglerConfig,
  projectReadRows,
} from "../test-support";
import type { BackupManifest, DbHostConfig, DbRunContext, FakeDbIo, SharedDbFlags } from "../types";
import { BACKUP_FORMAT_VERSION, canonicaliseRow, manifestSelfDigest } from "./artifact";
import { executeReset, findVerifiedBackup, prepareReset } from "./reset";
import type { ResetOptions, ResetOutcome } from "./types";

const STATE = ["v3", "d1", "miniflare-D1DatabaseObject"];

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "_forge_migrations", tbl_name: "_forge_migrations", sql: "CREATE TABLE _forge_migrations (name TEXT PRIMARY KEY)" },
];

const COLUMNS: Readonly<Record<string, Record<string, unknown>[]>> = {
  tasks: [
    { cid: 0, name: "uuid", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { cid: 1, name: "lane", type: "TEXT", notnull: 1, dflt_value: "''", pk: 0 },
  ],
};

const ROWS: readonly Record<string, unknown>[] = [
  { uuid: "t1", lane: "todo" },
  { uuid: "t2", lane: "doing" },
];

/** The digest `runBackup` records for `tasks`, over whichever rows the database holds. */
function tasksDigest(rows: readonly Record<string, unknown>[] = ROWS): string {
  return sha256(rows.map((row) => canonicaliseRow(["uuid", "lane"], "uuid", row).canonical).join("\n"));
}

function manifest(database: string, over: Partial<BackupManifest> = {}): BackupManifest {
  const written = {
    formatVersion: BACKUP_FORMAT_VERSION,
    drift: "match" as const,
    createdAt: "2026-09-11T09:00:00.000Z",
    label: null,
    dumper: { tool: "forge db backup", version: "wrangler 4.105.0" },
    database: { name: database, id: null, target: "local", persistPath: null },
    schema: { migrations: ["0001_init"], digest: "a".repeat(64), migrationsDigest: "b".repeat(64) },
    migrations: [{ name: "0001_init", sha256: "d".repeat(64) }],
    tables: [{ name: "tasks", rows: 2, digest: tasksDigest() }],
    artifacts: [],
    warnings: [],
    verified: [{ route: "full", divergent: 0 }],
    ...over,
    selfDigest: "",
  };
  return { ...written, selfDigest: manifestSelfDigest(written) };
}

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-reset-unit-"));
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

/** A fake wrangler answering the inventory, each app table's count, and a paged read of its rows. */
function fakeDatabase(seed: Record<string, string>, tasks: readonly Record<string, unknown>[] = ROWS): FakeDbIo {
  const io = fakeDbIo(seed);
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
      if (probe !== null) return keyProbeReply(tasks, probe.column);
      if (statement.includes("COUNT(*)")) return jsonRows([{ rows: tasks.length }]);
      const key = /ORDER BY t\."([^"]+)"/.exec(statement)?.[1] ?? "";
      const after = /WHERE t\."[^"]+" > '?([^']*)'?\s+ORDER BY/.exec(statement);
      const limit = Number(/LIMIT (\d+)$/.exec(statement)?.[1] ?? 0);
      const seek = after === null ? tasks : tasks.filter((row) => String(row[key]) > (after[1] ?? ""));
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

describe("findVerifiedBackup", () => {
  it("takes the newest artifact that names this database and proved every route", async () => {
    const root = appRoot();
    const backups = join(root, ".forge/backups");
    const io = fakeDbIo({
      [join(backups, "app-db-20260911T080000Z", "manifest.json")]: JSON.stringify(manifest("app-db")),
      [join(backups, "app-db-20260911T090000Z", "manifest.json")]: JSON.stringify(manifest("app-db")),
      [join(backups, "app-db-20260911T091000Z", "manifest.json")]: JSON.stringify(manifest("app-db", { verified: [] })),
      [join(backups, "app-db-20260911T092000Z", "manifest.json")]: JSON.stringify(
        manifest("app-db", { verified: [{ route: "full", divergent: 3 }] }),
      ),
      // Not JSON at all, so `JSON.parse` throws where the others validate.
      [join(backups, "app-db-20260911T093000Z", "manifest.json")]: "{ this is not json",
      [join(backups, "app-db-20260911T094000Z", "manifest.json")]: JSON.stringify(manifest("app-db", { formatVersion: 1 })),
      [join(backups, "app-db-20260911T095000Z", "notes.txt")]: "an artifact directory with no manifest",
      [join(backups, "other-db-20260911T096000Z", "manifest.json")]: JSON.stringify(manifest("other-db")),
    });

    expect(findVerifiedBackup(await context(root, io), "app-db")).toBe("app-db-20260911T090000Z");
  });

  it("looks under the host config's backupsDir rather than the default", async () => {
    const root = appRoot();
    const io = fakeDbIo({
      [join(root, "var/dumps", "app-db-20260911T090000Z", "manifest.json")]: JSON.stringify(manifest("app-db")),
      [join(root, ".forge/backups", "app-db-20260911T099000Z", "manifest.json")]: JSON.stringify(manifest("app-db")),
    });

    expect(findVerifiedBackup(await context(root, io, {}, { backupsDir: "var/dumps" }), "app-db")).toBe("app-db-20260911T090000Z");
  });

  it("is null when the backups directory does not exist", async () => {
    const root = appRoot();

    expect(findVerifiedBackup(await context(root, fakeDbIo()), "app-db")).toBe(null);
  });
});

describe("prepareReset + executeReset — the pair the CLI confirms between", () => {
  const runReset = (run: DbRunContext, options: ResetOptions): ResetOutcome => executeReset(run, prepareReset(run, options));

  it("refuses a deployed database, naming the bookmark verb that does reach one", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    const run = await context(root, io, { target: "remote" });

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false }))).toEqual({
      kind: "invalid-args",
      message:
        "remote cannot be reset from here — return a deployed database to a point in time with `forge db bookmark restore`, or replace it with `wrangler d1 create`",
    });
    expect(io.calls).toEqual([]);
  });

  it("refuses an expect that does not name this target", async () => {
    const root = appRoot();
    const io = fakeDbIo({ [join(root, ".wrangler", "state", ...STATE, "db.sqlite")]: "" });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "other-db", allowUnbacked: false }))).toEqual({
      kind: "invalid-args",
      message: "--expect other-db does not name this target, which is app-db",
    });
    expect(io.exists(join(root, ".wrangler", "state", ...STATE, "db.sqlite"))).toBe(true);
  });

  it("returns without querying the database when there is no state directory", async () => {
    const root = appRoot();
    const io = fakeDbIo();

    expect(runReset(await context(root, io), { expect: "app-db", allowUnbacked: false })).toEqual({
      database: "app-db",
      rows: 0,
      removed: null,
      backedUpBy: null,
    });
    expect(io.calls).toEqual([]);
  });

  it("removes the state directory and names the artifact that proved the rows are recoverable", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const io = fakeDatabase({
      [join(state, "db.sqlite")]: "",
      [join(root, ".forge/backups", "app-db-20260911T090000Z", "manifest.json")]: JSON.stringify(manifest("app-db")),
    });

    expect(runReset(await context(root, io), { expect: "app-db", allowUnbacked: false })).toEqual({
      database: "app-db",
      rows: 2,
      removed: state,
      backedUpBy: "app-db-20260911T090000Z",
    });
    expect(io.exists(join(state, "db.sqlite"))).toBe(false);
  });

  it("refuses an artifact whose declared file is truncated, before it removes anything", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const directory = join(root, ".forge/backups", "app-db-20260911T090000Z");
    const data = "PRAGMA defer_foreign_keys=TRUE;\n";
    const declared = manifest("app-db", { artifacts: [{ file: "data.sql", bytes: data.length, sha256: sha256(data) }] });
    const io = fakeDatabase({
      [join(state, "db.sqlite")]: "",
      [join(directory, "manifest.json")]: JSON.stringify(declared),
      [join(directory, "data.sql")]: data.slice(0, 10),
    });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false })).kind).toBe("invalid-args");
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses an artifact whose declared file is absent, before it removes anything", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const directory = join(root, ".forge/backups", "app-db-20260911T090000Z");
    const declared = manifest("app-db", { artifacts: [{ file: "data.sql", bytes: 32, sha256: "c".repeat(64) }] });
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "", [join(directory, "manifest.json")]: JSON.stringify(declared) });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false })).kind).toBe("invalid-args");
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses a local reset when the environment the run names declares more than one database", async () => {
    const root = appRoot();
    writeFileSync(
      join(root, "wrangler.jsonc"),
      minimalWranglerConfig(root, {
        env: {
          staging: {
            d1_databases: [
              { binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "migrations" },
              {
                binding: "REPORTS",
                database_name: "reports-db",
                database_id: "1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
                migrations_dir: "migrations",
              },
            ],
          },
        },
      }).text,
    );
    const state = join(root, ".wrangler", "state", ...STATE);
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "" });
    const run = await context(root, io, { env: "staging", db: "DB" });

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: true })).message).toBe(
      `${join(root, "wrangler.jsonc")} declares 2 d1 databases across its environments (app-db, reports-db) and the miniflare state filename is a hash — this tool cannot reset one of several`,
    );
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses a local reset when another environment's database shares the state directory, whichever env the run names", async () => {
    const root = appRoot();
    writeFileSync(
      join(root, "wrangler.jsonc"),
      minimalWranglerConfig(root, {
        env: {
          staging: {
            d1_databases: [
              { binding: "DB", database_name: "app-db-staging", database_id: "1f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", migrations_dir: "migrations" },
            ],
          },
        },
      }).text,
    );
    const state = join(root, ".wrangler", "state", ...STATE);
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "" });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: true })).message).toBe(
      `${join(root, "wrangler.jsonc")} declares 2 d1 databases across its environments (app-db, app-db-staging) and the miniflare state filename is a hash — this tool cannot reset one of several`,
    );
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
    expect(io.calls).toEqual([]);
  });

  it("refuses to empty a database holding rows that no verified backup names", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "" });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false }))).toEqual({
      kind: "invalid-args",
      message: `app-db holds 2 rows and no verified backup of it exists under ${join(root, ".forge/backups")} — run \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
    });
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses an artifact whose counts no longer describe the database, before reading a row", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const directory = join(root, ".forge/backups", "app-db-20260911T090000Z");
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "", [join(directory, "manifest.json")]: JSON.stringify(manifest("app-db")) }, [
      ...ROWS,
      { uuid: "t3", lane: "done" },
    ]);
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false }))).toEqual({
      kind: "invalid-args",
      message: `app-db-20260911T090000Z no longer describes app-db, so it does not prove these 3 rows are recoverable:\n  tasks: the artifact holds 2 row(s) and the database now holds 3\nRun \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
    });
    expect(io.calls.some((call) => call.some((arg) => arg.includes("forge:type:")))).toBe(false);
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses an artifact whose counts agree and whose rows do not, naming the table", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const directory = join(root, ".forge/backups", "app-db-20260911T090000Z");
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "", [join(directory, "manifest.json")]: JSON.stringify(manifest("app-db")) }, [
      { uuid: "t1", lane: "todo" },
      { uuid: "t2", lane: "done" },
    ]);
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false })).message).toBe(
      `app-db-20260911T090000Z no longer describes app-db, so it does not prove these 2 rows are recoverable:\n  tasks: 2 row(s) in both, and their contents differ\nRun \`forge db backup\` first, or pass --allow-unbacked if this database is genuinely disposable`,
    );
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("takes the artifact backup names rather than the most recent one", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const chosen = join(root, "elsewhere", "app-db-20260910T090000Z");
    const io = fakeDatabase({
      [join(state, "db.sqlite")]: "",
      [join(chosen, "manifest.json")]: JSON.stringify(manifest("app-db")),
      // Newer, and the one `findVerifiedBackup` would have taken.
      [join(root, ".forge/backups", "app-db-20260911T090000Z", "manifest.json")]: JSON.stringify(manifest("app-db")),
    });

    expect(runReset(await context(root, io), { expect: "app-db", allowUnbacked: false, backup: "elsewhere/app-db-20260910T090000Z" })).toEqual({
      database: "app-db",
      rows: 2,
      removed: state,
      backedUpBy: chosen,
    });
  });

  it("refuses a named artifact that its own run never proved", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const chosen = join(root, "elsewhere", "app-db-20260910T090000Z");
    const io = fakeDatabase({
      [join(state, "db.sqlite")]: "",
      [join(chosen, "manifest.json")]: JSON.stringify(manifest("app-db", { verified: [] })),
    });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false, backup: "elsewhere/app-db-20260910T090000Z" })).message).toBe(
      `${chosen} was taken from app-db and its own run never proved it rebuilds — a reset relies on an artifact that did`,
    );
    expect(io.exists(join(state, "db.sqlite"))).toBe(true);
  });

  it("refuses a named artifact taken from another database", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const chosen = join(root, "elsewhere", "other-db-20260910T090000Z");
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "", [join(chosen, "manifest.json")]: JSON.stringify(manifest("other-db")) });
    const run = await context(root, io);

    expect(refusal(() => runReset(run, { expect: "app-db", allowUnbacked: false, backup: "elsewhere/other-db-20260910T090000Z" })).message).toBe(
      `${chosen} was taken from other-db and this target is app-db`,
    );
  });

  it("empties an unbacked database when allowUnbacked says so, and reports no artifact", async () => {
    const root = appRoot();
    const state = join(root, ".wrangler", "state", ...STATE);
    const io = fakeDatabase({ [join(state, "db.sqlite")]: "" });

    expect(runReset(await context(root, io), { expect: "app-db", allowUnbacked: true })).toEqual({
      database: "app-db",
      rows: 2,
      removed: state,
      backedUpBy: null,
    });
    expect(io.exists(join(state, "db.sqlite"))).toBe(false);
  });
});
