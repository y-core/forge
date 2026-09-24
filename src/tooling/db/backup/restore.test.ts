import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { resolveDbContext } from "../context";
import { fakeDbIo, keyProbeAsked, keyProbeReply, minimalWranglerConfig, tableInfoAsked, tableSqlAsked, tableSqlReply } from "../db.fixture";
import { sha256 } from "../digest";
import { RECORDED_CHECKSUM_SELECT } from "../migrate/checksum";
import { migrationsDigest } from "../migrate/files";
import { toSchemaObjects } from "../sql";
import type { BackupManifest, DbRunContext, FakeDbIo, SharedDbFlags } from "../types";
import { appSchemaDigestInput, BACKUP_FORMAT_VERSION, manifestSelfDigest } from "./artifact";
import { executeRestore, prepareRestore, readBackupManifest } from "./restore";
import type { RestoreOptions, RestoreOutcome } from "./types";

const INVENTORY = [
  { type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" },
  { type: "table", name: "_forge_migrations", tbl_name: "_forge_migrations", sql: "CREATE TABLE _forge_migrations (name TEXT PRIMARY KEY)" },
];

const DATA_SQL = "PRAGMA defer_foreign_keys=TRUE;\n";

const SCHEMA_SQL = [
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
    drift: "match" as const,
    createdAt: "2026-09-11T09:00:00.000Z",
    label: null,
    dumper: { tool: "forge db backup", version: "wrangler 4.105.0" },
    database: { name: database, id: null, target: "local", persistPath: null },
    schema: { migrations: ["0001_init"], digest: "a".repeat(64), migrationsDigest: "b".repeat(64) },
    migrations: [{ name: "0001_init", sha256: "d".repeat(64) }],
    tables: [{ name: "tasks", rows: 2, digest: "c".repeat(64) }],
    artifacts: [declares("schema.sql", SCHEMA_SQL), declares("data.sql", DATA_SQL)],
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
  const answer = (statement: string): Record<string, unknown>[] => {
    if (tableInfoAsked(statement) !== null) return [];
    const ddl = tableSqlAsked(statement);
    if (ddl !== null) return tableSqlReply(inventory.find((object) => object.name === ddl)?.sql);
    if (statement.includes("sqlite_master")) return inventory;
    const probe = keyProbeAsked(statement);
    if (probe !== null) return keyProbeReply(probe.asks, [], probe.column);
    const count = /^SELECT COUNT\(\*\) AS rows FROM "([^"]+)"$/.exec(statement);
    if (count !== null) return [{ rows: typeof rows === "number" ? rows : (rows[count[1] ?? ""] ?? 0) }];
    return [];
  };
  io.d1Rules.push({ match: () => true, reply: answer });
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

    expect(await refusal(() => readBackupManifest(run, artifact))).toEqual({
      kind: "invalid-args",
      message: `${join(artifact, "manifest.json")} does not exist — --artifact takes the directory, not a file inside it`,
    });
  });

  it("refuses a manifest that is not JSON as a CliError naming the file, not as the parser's own error", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const run = await context(root, fakeDbIo({ [join(artifact, "manifest.json")]: "{ this is not json" }));
    const thrown = await refusal(() => readBackupManifest(run, artifact));

    expect(thrown.kind).toBe("invalid-args");
    expect(thrown.message.startsWith(`${join(artifact, "manifest.json")} is not JSON: `)).toBe(true);
  });

  it("refuses the format before this one, which carries no selfDigest and a different meaning of verified", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { formatVersion: 3 })) });
    const run = await context(root, io);

    expect((await refusal(() => readBackupManifest(run, artifact))).message).toBe(
      `${join(artifact, "manifest.json")} is not a manifest this tool wrote:\n  formatVersion is 3 and this tool writes ${BACKUP_FORMAT_VERSION} — take the backup again, since full.sql is gone and route full now loads schema.sql then data.sql`,
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

    expect(await refusal(() => readBackupManifest(run, artifact))).toEqual({
      kind: "invalid-args",
      message: `${join(artifact, "manifest.json")} is not a manifest this tool wrote:\n  formatVersion is 1 and this tool writes ${BACKUP_FORMAT_VERSION} — take the backup again, since full.sql is gone and route full now loads schema.sql then data.sql\n  schema.digest is not a 64-character hex SHA-256`,
    });
  });
});

describe("prepareRestore + executeRestore — the pair the CLI confirms between", () => {
  const runRestore = async (run: DbRunContext, options: RestoreOptions): Promise<RestoreOutcome> =>
    executeRestore(run, await prepareRestore(run, options));

  it("refuses a deployed database before reading the artifact", async () => {
    const root = appRoot();
    const io = fakeDbIo();
    const run = await context(root, io, { target: "remote" });

    expect(await refusal(() => runRestore(run, { artifact: join(root, "artifact"), route: "full" }))).toEqual({
      kind: "invalid-args",
      message:
        "restore is refused for remote — return a deployed database to a point in time with `forge db bookmark restore`, which is D1's own undo",
    });
    expect(io.calls).toEqual([]);
  });

  it("refuses an artifact taken from a database expect does not name", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("other-db")), [join(artifact, "schema.sql")]: SCHEMA_SQL });
    const run = await context(root, io);

    expect(await refusal(() => runRestore(run, { artifact, route: "full", expect: "app-db" }))).toEqual({
      kind: "invalid-args",
      message: "--expect app-db does not match this artifact, which was taken from other-db",
    });
  });

  it("says an unproven artifact is unproven, then refuses the route whose file is missing", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { verified: [] })) });
    const run = await context(root, io);

    expect(await refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
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

    expect(await refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
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
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
      },
      2,
    );
    const run = await context(root, io);

    expect(await refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: "app-db already holds data (tasks 2, _forge_migrations 2) — run `forge db reset` first; a restore adds rows and never removes them",
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
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
      },
      { tasks: 0, _forge_migrations: 2 },
    );
    const run = await context(root, io);

    expect((await refusal(() => runRestore(run, { artifact, route: "migrations" }))).message).toBe(
      "app-db already holds data (_forge_migrations 2) — run `forge db reset` first; a restore adds rows and never removes them",
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

    expect(await refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
      kind: "invalid-args",
      message: `${artifact} was proven by route migrations with 2 divergence(s) — its own run refused it; take the backup again`,
    });
    expect(io.calls).toEqual([]);
  });

  it("binds the artifact by the app objects' digest, so a source with no forge_* tables restores by route migrations with no binding problem", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const sourceInventory = [{ type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" }];
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(
          manifest("app-db", {
            schema: {
              migrations: ["0001_init"],
              digest: sha256(appSchemaDigestInput(toSchemaObjects(sourceInventory))),
              migrationsDigest: migrationsDigest([{ name: "0001_init", sha256: sha256(taken) }]),
            },
            migrations: [{ name: "0001_init", sha256: sha256(taken) }],
            tables: [{ name: "tasks", rows: 0, digest: sha256("") }],
          }),
        ),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
      },
      0,
      // The restored target carries the companions the migrations route created, which the digest ignores.
      INVENTORY,
    );
    io.d1Rules.unshift({ match: (statement) => statement === RECORDED_CHECKSUM_SELECT, reply: [{ name: "0001_init" }] });
    const run = await context(root, io);

    expect(await runRestore(run, { artifact, route: "migrations" })).toEqual({
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
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
        // What the installed package holds now, which a restore must not reach for.
        [join(root, "migrations", "0001_init.sql")]: "CREATE TABLE moved (id TEXT);",
      },
      0,
    );
    const run = await context(root, io);

    // The restore fails its digest checks against this hand-built manifest; what matters is which
    // file wrangler was pointed at, and it is the artifact's own.
    try {
      await runRestore(run, { artifact, route: "migrations" });
    } catch {}

    expect(io.files.get(join(root, ".forge", "scratch", "restore", "0001_init.sql"))).toBe(taken);
  });

  it("stages the replayed migration with no history row of its own, since data.sql already carries every one", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { migrations: [{ name: "0001_init", sha256: sha256(taken) }] })),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
      },
      0,
    );
    const run = await context(root, io);

    try {
      await runRestore(run, { artifact, route: "migrations" });
    } catch {}

    const staged = io.files.get(join(root, ".forge", "scratch", "restore", "0001_init.sql")) ?? "";
    expect(staged.includes("INSERT INTO _forge_migrations")).toBe(false);
  });

  it("creates the companion tables before loading data.sql, which carries their rows", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db", { migrations: [{ name: "0001_init", sha256: sha256(taken) }] })),
        [join(artifact, "data.sql")]: DATA_SQL,
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: taken,
      },
      0,
    );
    const run = await context(root, io);

    try {
      await runRestore(run, { artifact, route: "migrations" });
    } catch {
      // The manifest is a fixture, not a real artifact's.
    }

    const created = io.d1Calls.findIndex((call) =>
      call.statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS _forge_migrations")),
    );
    const loaded = io.d1Calls.findIndex((call) => call.source === join(artifact, "data.sql"));
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
        [join(artifact, "schema.sql")]: SCHEMA_SQL.split("\n").slice(0, -2).join("\n"),
      },
      0,
    );
    const run = await context(root, io);

    expect((await refusal(() => runRestore(run, { artifact, route: "migrations" }))).message).toBe(
      `${join(artifact, "schema.sql")} does not hash to what the manifest declares for it — this artifact is damaged`,
    );
    expect(io.calls).toEqual([]);
  });

  it("refuses a declared file the artifact does not hold", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")), [join(artifact, "data.sql")]: DATA_SQL }, 0);
    const run = await context(root, io);

    expect((await refusal(() => runRestore(run, { artifact, route: "migrations" }))).message).toBe(
      `${join(artifact, "schema.sql")} is declared in the manifest and missing from the artifact`,
    );
    expect(io.calls).toEqual([]);
  });

  it("re-runs the data-only check on the file it is about to load", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const data = `${DATA_SQL}INSERT INTO "sqlite_sequence" VALUES('tasks',1);\n`;
    const io = fakeDatabase(
      {
        [join(artifact, "manifest.json")]: JSON.stringify(
          manifest("app-db", { artifacts: [declares("schema.sql", SCHEMA_SQL), declares("data.sql", data)] }),
        ),
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "data.sql")]: data,
      },
      0,
    );
    const run = await context(root, io);

    expect((await refusal(() => runRestore(run, { artifact, route: "migrations" }))).message).toBe(
      "data.sql is not what a data-only artifact must be:\n  line 2: sqlite_sequence is the engine's and is restored only by schema.sql, which clears it first — an insert here would duplicate a row in a table with no UNIQUE index on name",
    );
    expect(io.calls).toEqual([]);
  });

  it("refuses a manifest whose bytes no longer hash to the selfDigest it carries", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDbIo({ [join(artifact, "manifest.json")]: JSON.stringify({ ...manifest("app-db"), label: "edited after the fact" }) });
    const run = await context(root, io);

    expect((await refusal(() => readBackupManifest(run, artifact))).message).toBe(
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
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: escaped,
      },
      0,
    );
    const run = await context(root, io);

    expect(await refusal(() => runRestore(run, { artifact, route: "migrations" }))).toEqual({
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
        [join(artifact, "schema.sql")]: SCHEMA_SQL,
        [join(artifact, "migrations", "0001_init.sql")]: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY);",
      },
      0,
    );
    const run = await context(root, io);

    expect((await refusal(() => runRestore(run, { artifact, route: "migrations" }))).message).toBe(
      `${join(artifact, "migrations", "0001_init.sql")} does not hash to what the manifest declares for it`,
    );
  });

  it("refuses route full when the schema half is missing, naming it rather than the file it would load second", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const io = fakeDatabase({ [join(artifact, "manifest.json")]: JSON.stringify(manifest("app-db")), [join(artifact, "data.sql")]: DATA_SQL }, 0);
    const run = await context(root, io);

    expect(await refusal(() => runRestore(run, { artifact, route: "full" }))).toEqual({
      kind: "invalid-args",
      message: `schema.sql is missing from ${artifact}, and route full loads it`,
    });
  });

  it("loads route full as schema.sql then data.sql, and reports the target matching the manifest", async () => {
    const root = appRoot();
    const artifact = join(root, "artifact");
    const taken = "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT);";
    const restored = [{ type: "table", name: "tasks", tbl_name: "tasks", sql: "CREATE TABLE tasks (uuid TEXT PRIMARY KEY, lane TEXT)" }];
    const io = fakeDbIo({
      [join(artifact, "manifest.json")]: JSON.stringify(
        manifest("app-db", {
          schema: {
            migrations: ["0001_init"],
            digest: sha256(appSchemaDigestInput(toSchemaObjects(restored))),
            migrationsDigest: migrationsDigest([{ name: "0001_init", sha256: sha256(taken) }]),
          },
          migrations: [{ name: "0001_init", sha256: sha256(taken) }],
          tables: [{ name: "tasks", rows: 0, digest: sha256("") }],
        }),
      ),
      [join(artifact, "schema.sql")]: SCHEMA_SQL,
      [join(artifact, "data.sql")]: DATA_SQL,
      [join(artifact, "migrations", "0001_init.sql")]: taken,
    });
    // The target is empty until both files have been loaded, which is what route full demands of it.
    const loadedFiles = () => io.d1Calls.filter((call) => call.source !== null).length;
    const answer = (statement: string): Record<string, unknown>[] => {
      if (tableInfoAsked(statement) !== null) return [];
      const ddl = tableSqlAsked(statement);
      if (ddl !== null) return tableSqlReply(restored.find((object) => object.name === ddl)?.sql);
      if (statement === RECORDED_CHECKSUM_SELECT) return loadedFiles() > 0 ? [{ name: "0001_init" }] : [];
      if (statement.includes("sqlite_master")) return loadedFiles() > 0 ? restored : [];
      const probe = keyProbeAsked(statement);
      return probe === null ? [] : keyProbeReply(probe.asks, [], probe.column);
    };
    io.d1Rules.push({ match: () => true, reply: answer });
    const run = await context(root, io);

    expect(await runRestore(run, { artifact, route: "full" })).toEqual({
      database: "app-db",
      route: "full",
      artifact,
      tables: [{ name: "tasks", rows: 0, matches: true }],
    });
    expect(io.d1Calls.flatMap((call) => (call.source === null ? [] : [call.source]))).toEqual([
      join(artifact, "schema.sql"),
      join(artifact, "data.sql"),
    ]);
    expect(io.logs).toEqual([]);
  });
});
