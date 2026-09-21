import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "../db.fixture";
import type { DbConfig, DbRunContext, FakeDbIo, Home, Migration } from "../types";
import { applyMigrations } from "./applier";
import { FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL } from "./companions";

const NOW = new Date("2026-09-11T10:00:00Z");

const HOME: Home = {
  label: "local",
  database: "app-db",
  binding: "DB",
  dir: "/app",
  configPath: "/app/wrangler.jsonc",
  persistTo: "/app/.wrangler/state",
  place: "local",
  env: null,
  synthesized: false,
};

function migration(name: string, sql: string): Migration {
  return {
    name,
    version: Number(name.slice(0, 4)),
    path: `/app/migrations/${name}.sql`,
    sha256: `${name}-hash`,
    sql,
    origin: "custom",
    stamp: null,
  };
}

const THREE = [
  migration("0001_init", "CREATE TABLE users (id INTEGER);"),
  migration("0002_posts", "CREATE TABLE posts (id INTEGER);"),
  migration("0003_tags", "CREATE TABLE tags (id INTEGER);"),
];

function context(io: FakeDbIo): DbRunContext {
  return { config: { root: "/app" } as DbConfig, home: HOME, io, host: {}, json: false, yes: true, style: {} as never, print: () => {} };
}

function staged(io: FakeDbIo): string[] {
  return io.d1Calls.flatMap((call) => (call.source === null ? [] : [call.source]));
}

const ready = (io: FakeDbIo): FakeDbIo => io;

describe("applyMigrations()", () => {
  it("stages every migration in list order, one file each", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, THREE, { label: "migrate", record: false });
    expect(staged(io)).toEqual([
      "/app/.forge/scratch/migrate/0001_init.sql",
      "/app/.forge/scratch/migrate/0002_posts.sql",
      "/app/.forge/scratch/migrate/0003_tags.sql",
    ]);
  });

  it("creates both companion tables before the first migration is loaded when recording", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, THREE, { label: "migrate", record: true });
    const declared = [FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL].join("\n");
    expect(io.d1Calls[0]?.source).toBe(null);
    expect(io.d1Calls[0]?.statements.every((statement) => declared.includes(statement))).toBe(true);
    expect(io.d1Calls[1]?.source).toBe("/app/.forge/scratch/migrate/0001_init.sql");
  });

  it("stages a plain INSERT under each body, which a duplicate name is refused by", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, THREE.slice(0, 1), { label: "migrate", record: true });
    expect(io.files.get("/app/.forge/scratch/migrate/0001_init.sql")).toBe(
      "CREATE TABLE users (id INTEGER);\nINSERT INTO _forge_migrations (name, sha256, applied_at) VALUES ('0001_init', '0001_init-hash', 1789120800000);",
    );
  });

  it("writes no history row at all when recording is off, so a replay does not collide with the rows it restored", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, THREE.slice(0, 1), { label: "restore-verify-migrations", record: false });
    expect(io.files.get("/app/.forge/scratch/restore-verify-migrations/0001_init.sql")).toBe("CREATE TABLE users (id INTEGER);");
    expect(io.d1Calls.every((call) => call.source !== null)).toBe(true);
  });

  it("stops at the migration that failed, naming it, and never reaches the one after it", async () => {
    const io = fakeDbIo({}, { now: NOW });
    io.d1Rules.push({
      match: (statement) => statement.includes("CREATE TABLE posts"),
      reply: () => {
        throw new Error('near "posts": syntax error');
      },
    });
    await expect(applyMigrations(context(io), HOME, THREE, { label: "migrate", record: false })).rejects.toThrow(
      "loading /app/.forge/scratch/migrate/0002_posts.sql against local (app-db) failed",
    );
    expect(staged(io)).toEqual(["/app/.forge/scratch/migrate/0001_init.sql", "/app/.forge/scratch/migrate/0002_posts.sql"]);
  });

  it("reaches the database not at all for an empty list, not even the companion tables", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, [], { label: "migrate", record: true });
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([]);
    expect(io.files.size).toBe(0);
  });
});
