import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../cf/types";
import { PLAIN } from "../term/color";
import { composed, fakeDbIo } from "./db.fixture";
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
  const io = fakeDbIo({ "/app/migrations/0001_init.sql": INIT, "/app/seeds/0001_users.sql": SEED, [STATE]: "" });
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
  return io.d1Calls.flatMap((call) => (call.source === null ? [] : [call.source.replace("/app/.forge/scratch/", "")]));
}

const OPTIONS = { seed: true, lint: true };

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

    const outcome = await runStandbyReset(run, { seed: false, lint: true });

    expect(staged(io)).toEqual(["migrate/0001_init.sql"]);
    expect(outcome.seeded).toEqual([]);
  });

  it("runs no seed when the migrations fail", async () => {
    const { run, io } = context();
    io.d1Rules.push(
      { match: (statement) => statement === RECORDED_CHECKSUM_SELECT, reply: () => noTable() as never },
      {
        match: (statement) => statement.includes("CREATE TABLE users"),
        reply: () => {
          throw new Error("SQLITE_ERROR");
        },
      },
    );

    await expect(runStandbyReset(run, OPTIONS)).rejects.toThrow("SQLITE_ERROR");
    expect(staged(io)).toEqual(["migrate/0001_init.sql"]);
  });
});
