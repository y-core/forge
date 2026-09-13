import { describe, expect, it } from "bun:test";

import { fakeDbIo, OK } from "../test-support";
import type { DbConfig, DbRunContext, FakeDbIo, Home, Migration } from "../types";
import { applyMigrations } from "./applier";
import { FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL } from "./companions";

const NOW = new Date("2026-09-11T10:00:00Z");

const HOME: Home = {
  label: "local",
  database: "app-db",
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
  return io.calls.filter((call) => call.includes("--file")).map((call) => call[call.indexOf("--file") + 1] ?? "");
}

function ready(io: FakeDbIo): FakeDbIo {
  io.rules.push({ match: () => true, reply: OK });
  return io;
}

describe("applyMigrations()", () => {
  it("stages every migration in list order, one file each", () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    applyMigrations(context(io), HOME, THREE, { label: "migrate", record: false });
    expect(staged(io)).toEqual([
      "/app/.forge/scratch/migrate/0001_init.sql",
      "/app/.forge/scratch/migrate/0002_posts.sql",
      "/app/.forge/scratch/migrate/0003_tags.sql",
    ]);
  });

  it("creates both companion tables before the first migration is loaded when recording", () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    applyMigrations(context(io), HOME, THREE, { label: "migrate", record: true });
    expect(io.calls[0]?.[io.calls[0].indexOf("--command") + 1]).toBe([FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL].join("\n"));
    expect(io.calls[1]?.includes("/app/.forge/scratch/migrate/0001_init.sql")).toBe(true);
  });

  it("stages a plain INSERT under each body, which a duplicate name is refused by", () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    applyMigrations(context(io), HOME, THREE.slice(0, 1), { label: "migrate", record: true });
    expect(io.files.get("/app/.forge/scratch/migrate/0001_init.sql")).toBe(
      "CREATE TABLE users (id INTEGER);\nINSERT INTO _forge_migrations (name, sha256, applied_at) VALUES ('0001_init', '0001_init-hash', 1789120800000);",
    );
  });

  it("writes no history row at all when recording is off, so a replay does not collide with the rows it restored", () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    applyMigrations(context(io), HOME, THREE.slice(0, 1), { label: "restore-verify-migrations", record: false });
    expect(io.files.get("/app/.forge/scratch/restore-verify-migrations/0001_init.sql")).toBe("CREATE TABLE users (id INTEGER);");
    expect(io.calls.some((call) => call.includes("--command"))).toBe(false);
  });

  it("stops at the migration that failed, naming it, and never reaches the one after it", () => {
    const io = fakeDbIo({}, { now: NOW });
    io.rules.push({
      match: (args) => args.includes("/app/.forge/scratch/migrate/0002_posts.sql"),
      reply: { code: 1, stdout: "", stderr: 'near "posts": syntax error' },
    });
    io.rules.push({ match: () => true, reply: OK });
    expect(() => applyMigrations(context(io), HOME, THREE, { label: "migrate", record: false })).toThrow(
      "loading /app/.forge/scratch/migrate/0002_posts.sql against local (app-db) failed (exit 1)",
    );
    expect(staged(io)).toEqual(["/app/.forge/scratch/migrate/0001_init.sql", "/app/.forge/scratch/migrate/0002_posts.sql"]);
  });

  it("spawns nothing at all for an empty list, not even the companion tables", () => {
    const io = ready(fakeDbIo({}, { now: NOW }));
    applyMigrations(context(io), HOME, [], { label: "migrate", record: true });
    expect(io.calls).toEqual([]);
    expect(io.files.size).toBe(0);
  });
});
