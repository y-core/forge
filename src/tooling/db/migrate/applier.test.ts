import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "../db.fixture";
import type { DbConfig, DbRunContext, FakeDbIo, Home, Migration } from "../types";
import { applyMigrations } from "./applier";

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
  return { name, version: Number(name.slice(0, 4)), path: `/app/config/db/migrations/${name}.sql`, sha256: `${name}-hash`, sql, stamp: null };
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

  it("leaves the companion tables to its caller, so a recorded apply sends no DDL of its own", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, THREE, { label: "migrate", record: true });
    expect(io.d1Calls[0]?.source).toBe("/app/.forge/scratch/migrate/0001_init.sql");
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

  it("names the foreign key a local migration's commit was refused on, ahead of the opaque refusal", async () => {
    const io = fakeDbIo({}, { now: NOW });
    const orphan = migration("0002_orphan", "PRAGMA defer_foreign_keys = true;\nINSERT INTO child (id, parent_id) VALUES (1, 99);");
    let calls = 0;
    io.d1 = () =>
      Promise.reject(
        new Error(
          ++calls === 1
            ? "internal error; reference = unf7bq10q3mobq6tis9d5gbn"
            : `D1_ERROR: bad JSON path: 'forge-fk 1 "child" "parent"': SQLITE_ERROR`,
        ),
      );
    await expect(applyMigrations(context(io), HOME, [orphan], { label: "migrate", record: false })).rejects.toThrow(
      "loading /app/.forge/scratch/migrate/0002_orphan.sql against local (app-db) failed:\n" +
        "FOREIGN KEY constraint failed: child first held a row with no match in parent after `INSERT INTO child (id, parent_id) VALUES (1, 99)`\n" +
        "internal error; reference = unf7bq10q3mobq6tis9d5gbn",
    );
    expect(calls).toBe(2);
  });

  it("reaches the database not at all for an empty list, not even the companion tables", async () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    await applyMigrations(context(io), HOME, [], { label: "migrate", record: true });
    expect(io.calls).toEqual([]);
    expect(io.d1Calls).toEqual([]);
    expect(io.files.size).toBe(0);
  });
});
