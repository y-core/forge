import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../cf/types";
import { PLAIN } from "../term/color";
import { composed, fakeDbIo, schemaModelRows } from "./db.fixture";
import { resolveHome } from "./home";
import { RECORDED_CHECKSUM_SELECT } from "./migrate/checksum";
import { migrationChecksum } from "./migrate/files";
import { runStandbyReset } from "./standby";
import type { DbConfig, DbRunContext, FakeDbIo, Place } from "./types";

const STATE = "/app/.forge/standby/app-db-standby/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/db.sqlite";
const INIT = composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;");
const SEED = "-- forge:places standby\nINSERT OR IGNORE INTO users (id) VALUES (1);";

function dbConfig(place: Place): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: { name: "app", compatibility_date: "2026-01-01" } as WranglerConfig,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: null, previewDatabaseId: null },
    target: { place, database: null },
  };
}

function context(place: Place = "standby"): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo({ "/app/config/db/migrations/0001_init.sql": INIT, "/app/seeds/0001_users.sql": SEED, [STATE]: "" });
  const config = dbConfig(place);
  const run: DbRunContext = {
    config,
    home: resolveHome(config, io),
    io,
    host: { seeds: ["seeds"] },
    json: false,
    yes: true,
    style: PLAIN,
    print: () => {},
  };
  return { run, io };
}

const noTable = () => {
  throw new Error("no such table: _forge_migrations");
};

/** The history read answers as the database would: nothing until a migration's body and record have loaded, that migration afterwards. */
function wire(io: FakeDbIo): void {
  const applied = () => staged(io).some((file) => file.startsWith("migrate/"));
  io.d1Rules.push({
    match: (statement) => statement === RECORDED_CHECKSUM_SELECT,
    reply: () => (applied() ? [{ name: "0001_init", sha256: migrationChecksum(INIT), applied_at: 1, fingerprint: null }] : (noTable() as never)),
  });
}

/** What each file load was aimed at, in order, so the wipe-migrate-seed sequence is readable. */
function staged(io: FakeDbIo): string[] {
  return io.d1Calls.flatMap((call) =>
    call.source === null || call.home.startsWith("scratch:") ? [] : [call.source.replace("/app/.forge/scratch/", "")],
  );
}

const OPTIONS = { seed: true };

describe("runStandbyReset()", () => {
  it("refuses a target that is not standby, before anything is removed", async () => {
    const { run, io } = context("local");
    wire(io);

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow(
      "standby reset only builds a standby database, and --target names local — pass --target standby[:<database>]",
    );
    expect(io.d1Calls).toEqual([]);
  });

  it("refuses a deployed target too, naming the place rather than the generated home", async () => {
    const { run, io } = context("remote");
    wire(io);

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow("--target names remote");
  });

  it("wipes the state, applies the migrations, then applies the seeds, in that order", async () => {
    const { run, io } = context();
    wire(io);

    const outcome = await runStandbyReset(run, OPTIONS);

    expect(io.exists(STATE)).toBe(false);
    expect(staged(io)).toEqual(["migrate/0001_init.sql", "seed/seeds/0001_users.sql"]);
    expect(outcome).toEqual({ database: "app-db-standby", applied: ["0001_init"], seeded: ["seeds:0001_users"], excluded: [] });
  });

  it("stops after the migrations under seed: false", async () => {
    const { run, io } = context();
    wire(io);

    const outcome = await runStandbyReset(run, { seed: false });

    expect(staged(io)).toEqual(["migrate/0001_init.sql"]);
    expect(outcome.seeded).toEqual([]);
  });

  it("refuses before anything is removed when no seed is found, naming --no-seed", async () => {
    const { run, io } = context();
    wire(io);
    run.host = { seeds: ["nowhere"] };

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow(
      "standby reset found no seeds in any directory config/db.ts names — add one, or pass --no-seed to build the standby database with every table empty",
    );
    expect([io.exists(STATE), io.d1Calls]).toEqual([true, []]);
  });

  it("names the directory --dir gave when that one holds no seed", async () => {
    const { run, io } = context();
    wire(io);
    await expect(runStandbyReset(run, { ...OPTIONS, dir: "nowhere" })).rejects.toThrow("standby reset found no seeds in nowhere");
  });

  it("runs no seed when the migrations fail", async () => {
    const { run, io } = context();
    io.d1Rules.push(
      { match: (statement) => statement === RECORDED_CHECKSUM_SELECT, reply: () => noTable() as never },
      {
        match: (statement, home) => !home.label.startsWith("scratch:") && statement.includes("CREATE TABLE users"),
        reply: () => {
          throw new Error("SQLITE_ERROR");
        },
      },
    );

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow("SQLITE_ERROR");
    expect(staged(io)).toEqual(["migrate/0001_init.sql"]);
  });

  it("refuses a pending migration with no compose stamp before any migration is staged", async () => {
    const { run, io } = context();
    io.files.set("/app/config/db/migrations/0001_init.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;\n");
    wire(io);

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow("0001_init.sql:1 generated-edited");
    expect(staged(io)).toEqual([]);
  });

  it("refuses a lint finding in a pending migration before any migration is staged", async () => {
    const { run, io } = context();
    io.files.set("/app/config/db/migrations/0001_init.sql", composed("DELETE FROM users;"));
    wire(io);

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow(
      "1 lint finding(s) in the pending migrations, so nothing was applied:\n/app/config/db/migrations/0001_init.sql:3 unbounded-delete",
    );
    expect(staged(io)).toEqual([]);
  });

  it("refuses a lint finding in a seed after the migrations, staging no seed", async () => {
    const { run, io } = context();
    io.files.set("/app/seeds/0001_users.sql", "-- forge:places standby\nINSERT INTO users (id) VALUES (1);");
    wire(io);

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow(
      "1 lint finding(s) in the seeds, so nothing was seeded:\n/app/seeds/0001_users.sql:2 seed-insert-not-idempotent",
    );
    expect(staged(io)).toEqual(["migrate/0001_init.sql"]);
  });

  describe("a pending migration that drops the table the one before it creates", () => {
    const DROP = "DROP TABLE IF EXISTS users;";
    const USERS = {
      inventory: [{ type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT" }],
      columns: [{ tbl: "users", cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1, hidden: 0 }],
    };

    function dropping(sql: string): { run: DbRunContext; io: FakeDbIo } {
      const { run, io } = context();
      io.files.set("/app/config/db/migrations/0002_drop.sql", sql);
      wire(io);
      const ran = (text: string) =>
        io.d1Calls.some((call) => call.home === "scratch:compose-analysis" && call.statements.some((statement) => statement.includes(text)));
      io.d1Rules.unshift({
        match: (_statement, home) => home.label === "scratch:compose-analysis",
        reply: (statement) => schemaModelRows(statement, ran("CREATE TABLE users") && !ran(DROP.slice(0, -1)) ? USERS : {}),
      });
      return { run, io };
    }

    it("refuses it with no line approving the drop, before any migration is staged", async () => {
      const { run, io } = dropping(composed(DROP));

      await expect(runStandbyReset(run, { seed: false })).rejects.toThrow(
        '0002_drop does not match the lines compose wrote for it on app-db-standby (standby), so nothing was applied:\n  drops table "users"',
      );
      expect(staged(io)).toEqual([]);
    });

    it("applies it once its line approves the drop", async () => {
      const { run, io } = dropping(composed(`-- forge:drops table "users"\n${DROP}`));

      await runStandbyReset(run, { seed: false });

      expect(staged(io)).toEqual(["migrate/0001_init.sql", "migrate/0002_drop.sql"]);
    });
  });
});
