import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { BACKUP_FORMAT_VERSION, manifestSelfDigest } from "../backup/artifact";
import { sha256 } from "../digest";
import { appHome } from "../home";
import { argvHas, fakeDbIo, jsonRows, OK } from "../test-support";
import type { BackupManifest, DbConfig, DbRunContext, FakeDbIo, Migration, Place, Spawned } from "../types";
import { recordMigrationSql } from "./checksum";
import { rehearseMigrations } from "./rehearse";

const NOW = new Date("2026-09-11T10:00:00Z");
const ROOT = "/app";
const BACKUPS = `${ROOT}/.forge/backups`;
const ARTIFACT = `${BACKUPS}/app-db-20260911T090000Z`;

const TAKEN = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT) STRICT;";
const APPLIED = ["0001_init"];
const PENDING: Migration[] = [
  {
    name: "0002_email_not_null",
    version: 2,
    path: `${ROOT}/migrations/0002_email_not_null.sql`,
    sha256: sha256("x"),
    sql: "CREATE TABLE _forge_new_users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT;",
    origin: "generated",
    stamp: null,
  },
];

function manifest(over: Partial<BackupManifest> = {}): BackupManifest {
  const written = {
    formatVersion: BACKUP_FORMAT_VERSION,
    drift: "match" as const,
    createdAt: "2026-09-11T09:00:00.000Z",
    label: null,
    dumper: { tool: "forge db backup", version: "wrangler 4.105.0" },
    database: { name: "app-db", id: null, target: "local", persistPath: null },
    schema: { migrations: ["0001_init"], digest: "a".repeat(64), migrationsDigest: "b".repeat(64) },
    migrations: [{ name: "0001_init", sha256: sha256(TAKEN) }],
    tables: [{ name: "users", rows: 218, digest: "c".repeat(64) }],
    artifacts: [],
    warnings: [],
    verified: [
      { route: "full", divergent: 0 },
      { route: "migrations", divergent: 0 },
    ],
    ...over,
    selfDigest: "",
  };
  return { ...written, selfDigest: manifestSelfDigest(written) };
}

function dbConfig(place: Place): DbConfig {
  return {
    root: ROOT,
    configPath: `${ROOT}/wrangler.jsonc`,
    config: { name: "app", compatibility_date: "2026-01-01", d1_databases: [{ binding: "DB", database_name: "app-db" }] } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place, database: null },
  };
}

function artifactFiles(over: Partial<BackupManifest> = {}): Record<string, string> {
  return {
    [join(ARTIFACT, "manifest.json")]: JSON.stringify(manifest(over)),
    [join(ARTIFACT, "data.sql")]: 'PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "users" ("id","email") VALUES (1,NULL);\n',
    [join(ARTIFACT, "migrations", "0001_init.sql")]: TAKEN,
  };
}

function context(files: Record<string, string>, place: Place = "local"): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo(files, { now: NOW });
  const config = dbConfig(place);
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  return { run, io };
}

function wire(io: FakeDbIo, options: { failApply?: boolean } = {}): void {
  io.rules.push(
    {
      match: (a) => argvHas(a, "execute", "--yes", "--file"),
      reply: (a) =>
        options.failApply === true && a.some((arg) => arg.includes("rehearse-apply"))
          ? ({ code: 1, stdout: "", stderr: "NOT NULL constraint failed: users.email" } as Spawned)
          : OK,
    },
    { match: (a) => argvHas(a, "execute", "--file"), reply: OK },
    { match: (a) => argvHas(a, "execute", "--command"), reply: jsonRows([]) },
  );
}

function capture(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, and the call returned");
}

describe("rehearseMigrations()", () => {
  it("restores the latest verified backup, applies the pending migrations to it, and reports its rows", () => {
    const { run, io } = context(artifactFiles());
    wire(io);

    expect(rehearseMigrations(run, PENDING, undefined, APPLIED)).toEqual({ artifact: ARTIFACT, rows: 218, applied: ["0002_email_not_null"] });
    const migration = PENDING[0];
    if (migration === undefined) throw new Error("PENDING must not be empty");
    expect(io.files.get(`${ROOT}/.forge/scratch/rehearse-apply/0002_email_not_null.sql`)).toBe(
      `${migration.sql}\n${recordMigrationSql(migration, NOW.getTime())}`,
    );
  });

  it("takes the artifact it is given, resolved against the root", () => {
    const { run, io } = context(artifactFiles());
    wire(io);

    expect(rehearseMigrations(run, PENDING, ".forge/backups/app-db-20260911T090000Z", APPLIED).artifact).toBe(ARTIFACT);
  });

  it("touches nothing outside the scratch, so the app's own state is never restored into", () => {
    const { run, io } = context(artifactFiles());
    wire(io);

    rehearseMigrations(run, PENDING, undefined, APPLIED);

    const live = io.calls.filter((call) => call.includes("--persist-to") && call.includes(`${ROOT}/.wrangler/state`));
    expect(live).toEqual([]);
  });

  it("names the migration the rehearsal stopped on and repeats what the database said", () => {
    const { run, io } = context(artifactFiles());
    wire(io, { failApply: true });

    expect(capture(() => rehearseMigrations(run, PENDING, undefined, APPLIED))).toContain(
      "the rehearsal failed on 0002_email_not_null — these migrations do not apply to the 218 row(s)",
    );
    expect(capture(() => rehearseMigrations(run, PENDING, undefined, APPLIED))).toContain("NOT NULL constraint failed: users.email");
  });

  it("refuses when no verified backup of this database exists, naming the verb that makes one", () => {
    const { run, io } = context({});
    wire(io);

    expect(capture(() => rehearseMigrations(run, PENDING, undefined, APPLIED))).toBe(
      `--rehearse needs an artifact and no verified backup of app-db exists under ${BACKUPS} — run \`forge db backup\` first, or name one with --artifact`,
    );
  });

  it("refuses an artifact taken from another database", () => {
    const { run, io } = context(artifactFiles({ database: { name: "other-db", id: null, target: "local", persistPath: null } }));
    wire(io);

    expect(capture(() => rehearseMigrations(run, PENDING, ARTIFACT, APPLIED))).toBe(
      `${ARTIFACT} was taken from other-db and this target is app-db`,
    );
  });

  it("refuses an artifact taken with other migrations applied than this target has, naming each side, before it restores", () => {
    const { run, io } = context(artifactFiles());
    wire(io);

    expect(capture(() => rehearseMigrations(run, PENDING, ARTIFACT, ["0001_init", "0002_x"]))).toBe(
      `${ARTIFACT} was taken with [0001_init] applied and this target has [0001_init, 0002_x] (missing: 0002_x; extra: none) — a rehearsal needs an artifact of this target as it stands; run \`forge db backup\` first, or name one with --artifact`,
    );
    expect(capture(() => rehearseMigrations(run, PENDING, ARTIFACT, []))).toBe(
      `${ARTIFACT} was taken with [0001_init] applied and this target has [] (missing: none; extra: 0001_init) — a rehearsal needs an artifact of this target as it stands; run \`forge db backup\` first, or name one with --artifact`,
    );
    expect(io.calls.filter((call) => call.includes("--file"))).toEqual([]);
  });

  it("refuses a deployed target, which has no local scratch to restore into", () => {
    const { run, io } = context(artifactFiles(), "remote");
    wire(io);

    expect(capture(() => rehearseMigrations(run, PENDING, undefined, APPLIED))).toBe(
      "--rehearse restores an artifact into a local scratch database, and remote is deployed — rehearse the same migrations against `--target local` or `--target standby`, then apply here",
    );
    expect(io.calls).toEqual([]);
  });
});
