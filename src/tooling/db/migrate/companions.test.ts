import { describe, expect, it } from "bun:test";

import { appHome } from "../home";
import { argvHas, fakeDbIo, OK } from "../test-support";
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

/** A fake that accepts the one batch `ensureCompanionTables` writes. */
function database(): FakeDbIo {
  const io = fakeDbIo();
  io.rules.push({ match: (a) => argvHas(a, "execute", "--yes", "--command"), reply: OK });
  return io;
}

const written = (io: FakeDbIo) =>
  io.calls.filter((call) => argvHas(call.slice(1), "execute", "--yes", "--command")).map((call) => call.at(-1) ?? "");

describe("ensureCompanionTables()", () => {
  it("creates both tables in one batch", () => {
    const io = database();
    ensureCompanionTables(io, home);

    const [batch = ""] = written(io);
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

  it("spawns once, with the two DDL constants and no read of any kind", () => {
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
      [FORGE_MIGRATIONS_DDL, FORGE_SEED_HISTORY_DDL].join("\n"),
    ]);
  });

  it("writes no cleanup of any older forge's rows, because pre-1.0 ships none", () => {
    const io = database();
    ensureCompanionTables(io, home);

    expect((written(io)[0] ?? "").includes("DELETE")).toBe(false);
  });
});
