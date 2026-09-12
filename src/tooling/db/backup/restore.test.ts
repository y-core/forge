import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { resolveDbContext } from "../context";
import { sha256 } from "../digest";
import { migrationsDigest } from "../migrate/files";
import { toSchemaObjects } from "../sql";
import { argvHas, describeTableReply, fakeDbIo, jsonRows, keyProbeAsks, keyProbeReply, minimalWranglerConfig, OK } from "../test-support";
import type { BackupManifest, DbRunContext, FakeDbIo, SharedDbFlags } from "../types";
import { appSchemaDigestInput, BACKUP_FORMAT_VERSION, manifestSelfDigest } from "./artifact";
import { executeRestore, prepareRestore, readBackupManifest } from "./restore";
import type { RestoreOptions, RestoreOutcome } from "./types";

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "d1_migrations", tbl_name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)" },
  { type: "table", name: "forge_migrations", tbl_name: "forge_migrations", sql: "CREATE TABLE forge_migrations (name TEXT PRIMARY KEY)" },
];

const DATA_SQL = "PRAGMA defer_foreign_keys=TRUE;\n";

const FULL_SQL = [
  "PRAGMA defer_foreign_keys=TRUE;",
  "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);",
  "DELETE FROM sqlite_sequence;",
  "",
].join("\n");

/** What `manifest.artifacts` declares for one file this tool wrote. */
function declares(file: string, text: string): { file: string; bytes: number; sha256: string } {
  return { file, bytes: new TextEncoder().encode(text).length, sha256: sha256(text) };
}

function manifest(database: string, over: Partial<BackupManifest> = {}): BackupManifest {
  const written = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: "2026-09-11T09:00:00.000Z",
    label: null,
    dumper: { tool: "forge db backup", version: "wrangler 4.105.0" },
    database: { name: database, id: null, target: "local", persistPath: null },
    schema: { migrations: ["0001_init"], digest: "a".repeat(64), migrationsDigest: "b".repeat(64) },
    migrations: [{ name: "0001_init", sha256: "d".repeat(64) }],
    tables: [{ name: "tasks", rows: 2, digest: "c".repeat(64) }],
    artifacts: [declares("full.sql", FULL_SQL), declares("data.sql", DATA_SQL)],
    warnings: [],
    verified: [{ route: "full", divergent: 0 }],
    ...over,
    selfDigest: "",
  };
  return { ...written, selfDigest: manifestSelfDigest(written) };
}

function appRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-restore-unit-"));
  const config = minimalWranglerConfig(root);
  writeFileSync(config.path, config.text);
  return root;
}

function flags(root: string, over: Partial<SharedDbFlags> = {}): SharedDbFlags {
  return { target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, root, json: false, yes: true, ...over };
}

function context(root: string, io: FakeDbIo, over: Partial<SharedDbFlags> = {}): Promise<DbRunContext> {
  return resolveDbContext(flags(root, over), undefined, { io, host: {} });
}

/** A fake wrangler answering the inventory and a row count for every table: `rows` for each, or per table by name. */
function fakeDatabase(seed: Record<string, string>, rows: number | Readonly<Record<string, number>>, inventory = INVENTORY): FakeDbIo {
  const io = fakeDbIo(seed);
  io.rules.push({
    match: (args) => argvHas(args, "execute", "--command"),
    reply: (args) => {
      const statement = args[args.length - 1] ?? "";
      // The batched read `describeTable` makes names both, so it is recognised before either alone.
      const info = /pragma_table_info\('([^']+)'\)/.exec(statement);
      if (info !== null && statement.includes("sqlite_master")) {
        const table = info[1] ?? "";
        return describeTableReply([], inventory.find((object) => object.name === table)?.sql);
      }
      if (statement.includes("sqlite_master")) return jsonRows(inventory);
      const probe = keyProbeAsks(statement);
      if (probe !== null) return keyProbeReply([], probe.column);
      const count = /^SELECT COUNT\(\*\) AS rows FROM "([^"]+)"$/.exec(statement);
      if (count !== null) return jsonRows([{ rows: typeof rows === "number" ? rows : (rows[count[1] ?? ""] ?? 0) }]);
      return jsonRows([]);
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

describe("readBackupManifest", () => {
  it("returns the manifest an artifact directory holds", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")) });

    expect(readBackupManifest(await context(root, io), artifact)).toEqual(manifest("app-db"));
  });

  it("refuses a directory with no manifest, naming what artifact takes", async () => {
    const root = appRoot();
    const artifact = join(root, "nowhere");
    const run = await context(root, fakeDbIo());

    expect(refusal(() => readBackupManifest(run, artifact))).toEqual({
      kind: "invalid-args",
      message: `${join(artifact, "manifest.json")} does not exist — --artifact takes the directory, not a file inside it`,
    });
  });

  it("refuses a manifest that is not JSON as a CliError naming the file, not as the parser's own error", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const run = await context(root, fakeDbIo({ [join(artifact, "manifest.json")]: "{ this is not json" }));
    const thrown = refusal(() => readBackupManifest(run, artifact));

    expect(thrown.kind).toBe("invalid-args");
    expect(thrown.message.startsWith(`${join(artifact, "manifest.json")} is not JSON: `)).toBe(true);
  });

  it("refuses the format before this one, which carries no selfDigest and a different meaning of verified", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { formatVersion: 3 })) });
    const run = await context(root, io);

    expect(refusal(() => readBackupManifest(run, artifact)).message).toBe(
      `${join(artifact, "manifest.json")} is not a manifest this tool wrote:\n  formatVersion is 3 and this tool writes ${BACKUP_FORMAT_VERSION}`,
    );
  });

  it("refuses a manifest some other tool wrote, listing what is wrong with it", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    // A format this tool never wrote, with a digest that is not a SHA-256.
    const io = fakeDbIo({
      [join(artifact, "manifest.json")]: JSON.stringify(
        manifest("app-db", { formatVersion: 1, schema: { migrations: [], digest: "short", migrationsDigest: "b".repeat(64) } }),
      ),
    });
    const run = await context(root, io);

    expect(refusal(() => readBackupManifest(run, artifact))).toEqual({
      kind: "invalid-args",
      message: `${join(artifact, "manifest.json")} is not a manifest this tool wrote:\n  formatVersion is 1 and this tool writes ${BACKUP_FORMAT_VERSION}\n  schema.digest is not a 64-character hex SHA-256`,
    });
  });
});

describe("prepareRestore + executeRestore — the pair the CLI confirms between", () => {
  const runRestore = (run: DbRunContext, options: RestoreOptions): RestoreOutcome => executeRestore(run, prepareRestore(run, options));

  it("refuses a deployed database before reading the artifact", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    const run = await context(root, io, { target: "remote" });

    expect(refusal(() => runRestore(run, { artifact: join(root, "artifact"), route: "full" }))).toEqual({
      kind: "invalid-args",
      message:
        "restore is refused for remote — return a deployed database to a point in time with `forge db bookmark restore`, which is D1's own undo",
    });
    expect(io.calls).toEqual([]);
  });

  it("refuses an artifact taken from a database expect does not name", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("other-db")), [join(artifact, "full.sql")]: FULL_SQL });
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "full", expect: "app-db" }))).toEqual({
      kind: "invalid-args",
      message: "--expect app-db does not match this artifact, which was taken from other-db",
    });
  });

  it("says an unproven artifact is unproven, then refuses the route whose file is missing", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { verified: [] })) });
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: `data.sql is missing from ${artifact}, and route migrations loads it`,
    });
    expect(io.logs).toEqual(["! this artifact was produced with --no-verify and has never been proven to rebuild"]);
  });

  it("repeats every warning the manifest carries, so a remote artifact's note is read on the way in", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const warning =
      "taken from remote: restore is refused for remote and preview — this artifact restores into local, standby, or a rehearsal scratch";
    const io = fakeDbIo({
      [join(artifact, "manifest.json")]: JSON.stringify(
        manifest("app-db", { database: { name: "app-db", id: null, target: "remote", persistPath: null }, warnings: [warning] }),
      ),
    });
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: `data.sql is missing from ${artifact}, and route migrations loads it`,
    });
    expect(io.logs).toEqual([`! ${warning}`]);
  });

  it("refuses a target that already holds rows, and names the verb that empties one", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
      },
      2,
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: "app-db already holds data (tasks 2, forge_migrations 2) — run `forge db reset` first; a restore adds rows and never removes them",
    });
    expect(io.logs).toEqual([]);
  });

  it("refuses a target whose app tables are empty and whose companion tables are not, before any file is loaded", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
      },
      { tasks: 0, forge_migrations: 2 },
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" })).message).toBe(
      "app-db already holds data (forge_migrations 2) — run `forge db reset` first; a restore adds rows and never removes them",
    );
    expect(io.calls.filter((call) => call.includes("--file"))).toEqual([]);
  });

  it("refuses an artifact whose own run found a divergence, before verifying its files", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(
          manifest("app-db", {
            verified: [
              { route: "full", divergent: 0 },
              { route: "migrations", divergent: 2 },
            ],
          }),
        ),
        // Truncated, which verifyBackupArtifact would refuse — the divergence is refused first.
        [join(artifact, "data.sql")]: DATA_SQL.slice(0, 5),
      },
      0,
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: `${artifact} was proven by route migrations with 2 divergence(s) — its own run refused it; take the backup again`,
    });
    expect(io.calls).toEqual([]);
  });

  it("binds the artifact by the app objects' digest, so a source with no forge_* tables restores by route migrations with no binding problem", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const sourceInventory = [
      { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
      { type: "table", name: "d1_migrations", tbl_name: "d1_migrations", sql: "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)" },
    ];
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(
          manifest("app-db", {
            schema: {
              migrations: ["0001_init"],
              digest: sha256(appSchemaDigestInput(toSchemaObjects(sourceInventory), "d1_migrations")),
              migrationsDigest: migrationsDigest([{ name: "0001_init", sql: taken }]),
            },
            migrations: [{ name: "0001_init", sha256: sha256(taken) }],
            tables: [{ name: "tasks", rows: 0, digest: sha256("") }],
          }),
        ),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
      },
      0,
      // The restored target carries the companions the migrations route created, which the digest ignores.
      INVENTORY,
    );
    io.rules.push({ match: (args) => argvHas(args, "migrations", "apply"), reply: OK }, { match: (args) => argvHas(args, "--file"), reply: OK });
    io.rules.unshift({
      match: (args) => argvHas(args, "execute", "--command") && (args.at(-1) ?? "").startsWith("SELECT name FROM"),
      reply: jsonRows([{ name: "0001_init" }]),
    });
    const run = await context(root, io);

    expect(runRestore(run, { artifact, route: "migrations" })).toEqual({
      database: "app-db",
      route: "migrations",
      artifact,
      tables: [{ name: "tasks", rows: 0, matches: true }],
    });
    expect(io.logs).toEqual([]);
  });

  it("replays the migrations the artifact embeds, not the ones the checkout holds today", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { migrations: [{ name: "0001_init", sha256: sha256(taken) }] })),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
        // What the installed package holds now, which a restore must not reach for.
        [join(root, "migrations", "0001_init.sql")]: "CREATE TABLE moved (id TEXT);",
      },
      0,
    );
    const run = await context(root, io);

    // The restore itself fails its digest checks against this hand-built manifest; what matters is
    // which directory wrangler was pointed at, and it is the artifact's own.
    try {
      runRestore(run, { artifact, route: "migrations" });
    } catch {
      // The manifest is a fixture, not a real artifact's.
    }

    expect(io.files.get(join(root, ".forge", "scratch", "restore", "migrations", "0001_init.sql"))).toBe(taken);
    const generated = JSON.parse(io.readText(join(root, ".forge", "scratch", "restore", "wrangler.jsonc")));
    expect(generated.d1_databases[0].migrations_dir).toBe(join(root, ".forge", "scratch", "restore", "migrations"));
  });

  it("creates the companion tables before loading data.sql, which carries their rows", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { migrations: [{ name: "0001_init", sha256: sha256(taken) }] })),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
      },
      0,
    );
    io.rules.push({ match: (args) => argvHas(args, "migrations", "apply"), reply: OK });
    const run = await context(root, io);

    try {
      runRestore(run, { artifact, route: "migrations" });
    } catch {
      // The manifest is a fixture, not a real artifact's.
    }

    const created = io.calls.findIndex((call) => call.some((arg) => arg.includes("CREATE TABLE IF NOT EXISTS forge_migrations")));
    const loaded = io.calls.findIndex((call) => call.includes("--file") && call.includes(join(artifact, "data.sql")));
    expect(created).toBeGreaterThan(-1);
    expect(loaded).toBeGreaterThan(created);
  });

  it("refuses a declared file that does not hash to its entry, before anything is loaded", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")),
        [join(artifact, "data.sql")]: DATA_SQL,
        // One line short of what the manifest declares for it.
        [join(artifact, "full.sql")]: FULL_SQL.split("\n").slice(0, -2).join("\n"),
      },
      0,
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" })).message).toBe(
      `${join(artifact, "full.sql")} does not hash to what the manifest declares for it — this artifact is damaged`,
    );
    expect(io.calls).toEqual([]);
  });

  it("refuses a declared file the artifact does not hold", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")), [join(artifact, "data.sql")]: DATA_SQL }, 0);
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" })).message).toBe(
      `${join(artifact, "full.sql")} is declared in the manifest and missing from the artifact`,
    );
    expect(io.calls).toEqual([]);
  });

  it("re-runs the data-only check on the file it is about to load", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const data = `${DATA_SQL}INSERT INTO "d1_migrations" ("id") VALUES (1);\n`;
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { artifacts: [declares("data.sql", data)] })),
        [join(artifact, "data.sql")]: data,
      },
      0,
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" })).message).toBe(
      "data.sql is not what a data-only artifact must be:\n  line 2: d1_migrations is written by `wrangler d1 migrations apply`, and a row here collides with the one it just wrote",
    );
    expect(io.calls).toEqual([]);
  });

  it("refuses a manifest whose bytes no longer hash to the selfDigest it carries", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify({ ...manifest("app-db"), label: "edited after the fact" }) });
    const run = await context(root, io);

    expect(refusal(() => readBackupManifest(run, artifact)).message).toBe(
      `${join(artifact, "manifest.json")} does not hash to the selfDigest it carries — it has been truncated, swapped or corrupted since it was written. The digest detects damage and not tampering: anyone who edits a manifest can recompute it.`,
    );
  });

  it("refuses a manifest whose migration name is a path, before any file is written under the scratch home", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const escaped = "CREATE TABLE anywhere (id TEXT);";
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(
          manifest("app-db", { migrations: [{ name: "../../../migrations/0001_init", sha256: sha256(escaped) }] }),
        ),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: escaped,
      },
      0,
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: `${join(artifact, "manifest.json")} is not a manifest this tool wrote:\n  migrations[0].name "../../../migrations/0001_init" is not a migration name — <NNNN>_<name>, with no path separator`,
    });
    expect([...io.files.keys()].filter((path) => path.startsWith(join(root, ".forge", "scratch", "restore")))).toEqual([]);
    expect(io.calls).toEqual([]);
  });

  it("refuses an embedded migration whose bytes do not hash to what the manifest declares", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "full.sql")]: FULL_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY);",
      },
      0,
    );
    const run = await context(root, io);

    expect(refusal(() => runRestore(run, { artifact, route: "migrations" })).message).toBe(
      `${join(artifact, "migrations", "0001_init.sql")} does not hash to what the manifest declares for it`,
    );
  });
});
