import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "./db.fixture";
import { applyRecordedSql } from "./recorded";
import type { DbConfig, DbRunContext, FakeDbIo, Home } from "./types";

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

function context(io: FakeDbIo): DbRunContext {
  return { config: { root: "/app" } as DbConfig, home: HOME, io, host: {}, json: false, yes: true, style: {} as never, print: () => {} };
}

function loaded(io: FakeDbIo): (string | null)[] {
  return io.d1Calls.map((call) => call.source);
}

describe("applyRecordedSql()", () => {
  it("stages the body, a newline and the record together, then loads that one file", async () => {
    const io = fakeDbIo();
    await applyRecordedSql(context(io), HOME, {
      label: "migrate",
      name: "0001_init",
      sql: "CREATE TABLE users (id INTEGER);",
      record: "INSERT INTO _forge_migrations (name) VALUES ('0001_init');",
      remove: false,
    });
    expect(loaded(io)).toEqual(["/app/.forge/scratch/migrate/0001_init.sql"]);
    expect(io.files.get("/app/.forge/scratch/migrate/0001_init.sql")).toBe(
      "CREATE TABLE users (id INTEGER);\nINSERT INTO _forge_migrations (name) VALUES ('0001_init');",
    );
  });

  it("stages the body alone when the caller records nothing, with no trailing newline of its own", async () => {
    const io = fakeDbIo();
    await applyRecordedSql(context(io), HOME, {
      label: "restore-verify",
      name: "0002_posts",
      sql: "CREATE TABLE posts (id INTEGER);",
      record: null,
      remove: false,
    });
    expect(io.files.get("/app/.forge/scratch/restore-verify/0002_posts.sql")).toBe("CREATE TABLE posts (id INTEGER);");
  });

  it("keeps the staged file when remove is false, so a failed load can be read afterwards", async () => {
    const io = fakeDbIo();
    await applyRecordedSql(context(io), HOME, { label: "migrate", name: "0001_init", sql: "SELECT 1;", record: null, remove: false });
    expect(io.files.has("/app/.forge/scratch/migrate/0001_init.sql")).toBe(true);
  });

  it("removes the staged file after a successful load when remove is true", async () => {
    const io = fakeDbIo();
    await applyRecordedSql(context(io), HOME, {
      label: "seed/data",
      name: "users",
      sql: "INSERT INTO users VALUES (1);",
      record: null,
      remove: true,
    });
    expect(loaded(io)).toEqual(["/app/.forge/scratch/seed/data/users.sql"]);
    expect(io.files.has("/app/.forge/scratch/seed/data/users.sql")).toBe(false);
  });

  it("removes the staged file when the load throws, so expanded environment text does not outlive it", async () => {
    const io = fakeDbIo();
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error('near "OOPS": syntax error');
      },
    });
    await expect(
      applyRecordedSql(context(io), HOME, { label: "seed/data", name: "users", sql: "OOPS", record: null, remove: true }),
    ).rejects.toThrow("loading /app/.forge/scratch/seed/data/users.sql against local (app-db) failed");
    expect(io.files.has("/app/.forge/scratch/seed/data/users.sql")).toBe(false);
  });

  it("leaves the staged file behind when the load throws and remove is false", async () => {
    const io = fakeDbIo();
    io.d1Rules.push({
      match: () => true,
      reply: () => {
        throw new Error("boom");
      },
    });
    await expect(
      applyRecordedSql(context(io), HOME, { label: "migrate", name: "0001_init", sql: "OOPS", record: null, remove: false }),
    ).rejects.toThrow("loading /app/.forge/scratch/migrate/0001_init.sql");
    expect(io.files.get("/app/.forge/scratch/migrate/0001_init.sql")).toBe("OOPS");
  });
});
