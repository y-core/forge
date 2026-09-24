import { describe, expect, it } from "bun:test";

import { fakeDbIo } from "../db.fixture";
import { appHome } from "../home";
import type { DbConfig, FakeDbIo, Home } from "../types";
import { ensureCompanionTables, FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL } from "./companions";

function dbConfig(): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: { name: "app", d1_databases: [] } as never,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: null, previewDatabaseId: null },
    target: { place: "local", database: null },
  };
}

const home: Home = appHome(dbConfig());

const database = (): FakeDbIo => fakeDbIo();

const written = (io: FakeDbIo) => io.d1Calls.flatMap((call) => call.statements);

describe("ensureCompanionTables()", () => {
  it("creates both tables in one batch", async () => {
    const io = database();
    await ensureCompanionTables(io, home);

    const batch = written(io).join("\n");
    expect(batch.includes("CREATE TABLE IF NOT EXISTS _forge_migrations")).toBe(true);
    expect(batch.includes("CREATE UNIQUE INDEX IF NOT EXISTS _forge_seed_history_source_name")).toBe(true);
    expect(batch.includes("CREATE TABLE IF NOT EXISTS _forge_seed_history")).toBe(true);
    expect(batch.includes("RENAME TO")).toBe(false);
  });

  it("gives _forge_migrations an id primary key and a unique index on the name", () => {
    expect(FORGE_MIGRATIONS_DDL).toBe(
      [
        "CREATE TABLE IF NOT EXISTS _forge_migrations (",
        "  id INTEGER PRIMARY KEY,",
        "  name TEXT NOT NULL,",
        "  sha256 TEXT NOT NULL,",
        "  applied_at INTEGER NOT NULL,",
        "  fingerprint TEXT",
        ") STRICT;",
        "CREATE UNIQUE INDEX IF NOT EXISTS _forge_migrations_name ON _forge_migrations (name);",
      ].join("\n"),
    );
  });

  it("reaches the database once, with the two DDL constants and no read of any kind", async () => {
    const io = database();
    await ensureCompanionTables(io, home);

    expect(io.calls).toEqual([]);
    expect(io.d1Calls.length).toBe(1);
    expect(io.d1Calls[0]?.persistTo).toBe("/app/.wrangler/state/v3");
    const declared = [FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL].join("\n");
    expect(written(io).length).toBe(4);
    expect(written(io).every((statement) => declared.includes(statement))).toBe(true);
  });

  it("writes no cleanup of any older forge's rows, because pre-1.0 ships none", async () => {
    const io = database();
    await ensureCompanionTables(io, home);

    expect(written(io).join("\n").includes("DELETE")).toBe(false);
  });
});
