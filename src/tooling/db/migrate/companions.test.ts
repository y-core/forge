import { describe, expect, it } from "bun:test";

import { appHome } from "../home";
import { argvHas, fakeDbIo, OK } from "../test-support";
import type { DbConfig, FakeDbIo, Home } from "../types";
import { ensureCompanionTables, FORGE_MIGRATIONS_DDL, FORGE_SCHEMA_META_DDL, FORGE_SEED_HISTORY_DDL } from "./companions";

function dbConfig(): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: { name: "app", d1_databases: [] } as never,
    env: null,
    entry: {
      binding: "DB",
      databaseName: "app-db",
      databaseId: null,
      previewDatabaseId: null,
      migrationsDir: "/app/migrations",
      migrationsTable: "d1_migrations",
    },
    target: { place: "local", database: null },
  };
}

const home: Home = appHome(dbConfig());

/** A fake that accepts the one batch `ensureCompanionTables` writes. */
function database(): FakeDbIo {
  const io = fakeDbIo();
  io.rules.push({ match: (a) => argvHas(a, "execute", "--yes", "--command"), reply: OK });
  return io;
}

const written = (io: FakeDbIo) =>
  io.calls.filter((call) => argvHas(call.slice(1), "execute", "--yes", "--command")).map((call) => call.at(-1) ?? "");

describe("ensureCompanionTables()", () => {
  it("creates all three tables in one batch", () => {
    const io = database();
    ensureCompanionTables(io, home);

    const [batch = ""] = written(io);
    expect(batch.includes("CREATE TABLE IF NOT EXISTS forge_migrations")).toBe(true);
    expect(batch.includes("CREATE UNIQUE INDEX IF NOT EXISTS forge_seed_history_source_name")).toBe(true);
    expect(batch.includes("CREATE TABLE IF NOT EXISTS forge_seed_history")).toBe(true);
    expect(batch.includes("CREATE TABLE IF NOT EXISTS forge_schema_meta")).toBe(true);
    expect(batch.includes("RENAME TO")).toBe(false);
  });

  // `applied_name` is the primary key and `d1_migrations` is what records the name and the time, so
  // a second index here would key a space the primary key already covers.
  it("gives forge_migrations two columns and no index of its own", () => {
    const io = database();
    ensureCompanionTables(io, home);

    const [batch = ""] = written(io);
    expect(batch.includes("forge_migrations_namespace_name")).toBe(false);
    expect(batch.includes("CREATE UNIQUE INDEX IF NOT EXISTS forge_migrations")).toBe(false);
    expect(FORGE_MIGRATIONS_DDL).toBe(
      ["CREATE TABLE IF NOT EXISTS forge_migrations (", "  applied_name TEXT PRIMARY KEY,", "  sha256 TEXT NOT NULL", ") STRICT;"].join("\n"),
    );
  });

  it("spawns once, with the three DDL constants and no read of any kind", () => {
    const io = database();
    ensureCompanionTables(io, home);

    expect(io.calls.length).toBe(1);
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "execute",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--local",
      "--persist-to",
      "/app/.wrangler/state",
      "--yes",
      "--command",
      [FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL, FORGE_SCHEMA_META_DDL].join("\n"),
    ]);
  });

  it("writes no cleanup of any older forge's rows, because pre-1.0 ships none", () => {
    const io = database();
    ensureCompanionTables(io, home);

    expect((written(io)[0] ?? "").includes("DELETE")).toBe(false);
  });
});
