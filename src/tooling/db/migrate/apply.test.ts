import { describe, expect, it } from "bun:test";

import { INVENTORY_SELECT } from "../../../storage/db/schema";
import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { OK, argvHas, composed, fakeDbIo, jsonRows } from "../db.fixture";
import { appHome } from "../home";
import { formatComposeHeader } from "../schema/header";
import type { DbConfig, DbRunContext, FakeDbIo, Place, Spawned } from "../types";
import { runMigrate } from "./apply";
import { RECORDED_CHECKSUM_SELECT, recordMigrationSql } from "./checksum";
import { migrationChecksum, migrationsDigest } from "./files";
import { schemaFingerprint } from "./fingerprint";

const NOW = new Date("2026-09-11T10:00:00Z");
const MIGRATIONS = "/app/migrations";
const LOCK = "/app/.forge/db-apply.lock";

const INIT = composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;");
const NEXT = composed("CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;");
const DROP = composed("DROP TABLE users;");
const INIT_SHA = migrationChecksum(INIT);
const WRONG_SHA = migrationChecksum(stamped(NEXT, "wrong"));
const DROP_SHA = migrationChecksum(DROP);

function wranglerConfig(): WranglerConfig {
  return {
    name: "app",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
  } as WranglerConfig;
}

function dbConfig(place: Place): DbConfig {
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config: wranglerConfig(),
    env: null,
    entry: {
      binding: "DB",
      databaseName: "app-db",
      databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      previewDatabaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5b",
    },
    target: { place, database: null },
  };
}

function context(files: Record<string, string>, place: Place = "local"): { run: DbRunContext; io: FakeDbIo; out: string[] } {
  const io = fakeDbIo(files, { now: NOW });
  const config = dbConfig(place);
  const out: string[] = [];
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: (line) => out.push(line) };
  return { run, io, out };
}

const OPTIONS = { dryRun: false, lint: true, allowWarnings: false, allowDrift: false, bookmark: true, rehearse: false };

const NO_TABLE: Spawned = { code: 1, stdout: "", stderr: "no such table: _forge_migrations" };
const INVENTORY = [{ type: "table", name: "users", tbl_name: "users", sql: INIT }];
const ACTUAL_FINGERPRINT = schemaFingerprint([{ type: "table", name: "users", tblName: "users", sql: INIT }]);

const command = (a: readonly string[]) => (argvHas(a, "execute", "--json", "--command") ? (a.at(-1) ?? "") : "");
const isRecordedSelect = (a: readonly string[]) => command(a) === RECORDED_CHECKSUM_SELECT;
const isInventorySelect = (a: readonly string[]) => command(a) === INVENTORY_SELECT;
const isWrite = (a: readonly string[]) => argvHas(a, "execute", "--yes", "--command");
const isFileApply = (a: readonly string[]) => argvHas(a, "execute", "--yes", "--file");

/** A generated migration: the compose header over `body`, stamped against `baseline`. */
function stamped(body: string, baseline: string): string {
  return `${formatComposeHeader({ desired: {}, baseline, forge: "test" }, body)}${body}`;
}

const STAMPED_INIT = stamped(INIT, migrationsDigest([]));

/** The rule table a run that reaches the database needs, with the recorded rows it should read back. */
function wire(io: FakeDbIo, recorded: Spawned = NO_TABLE): void {
  io.rules.push(
    { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
    { match: isRecordedSelect, reply: recorded },
    { match: isInventorySelect, reply: jsonRows(INVENTORY) },
    { match: isWrite, reply: OK },
    { match: isFileApply, reply: OK },
  );
}

/** The verb of each wrangler call, in the order it was made. */
function trace(io: FakeDbIo): string[] {
  return io.calls.map((call) => {
    const args = call.slice(1);
    if (isFileApply(args)) return `stage:${(args.at(-1) ?? "").split("/").at(-1)}`;
    if (argvHas(args, "time-travel", "info")) return "bookmark";
    if (isRecordedSelect(args)) return "read-recorded";
    if (isInventorySelect(args)) return "read-inventory";
    if (isWrite(args)) return "write";
    return args.join(" ");
  });
}

const writes = (io: FakeDbIo) => io.calls.filter((call) => isWrite(call.slice(1))).map((call) => call.at(-1) ?? "");

describe("runMigrate()", () => {
  it("applies every pending migration, then records the checksum and certifies the fingerprint", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome.applied).toEqual(["0001_init", "0002_next"]);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.dryRun).toBe(false);
    expect(outcome.bookmark).toBe(undefined);
    expect(trace(io)).toEqual([
      "read-recorded",
      "read-inventory",
      "write",
      "stage:0001_init.sql",
      "stage:0002_next.sql",
      "read-inventory",
      "write",
    ]);
    expect(out).toEqual([]);
  });

  it("stages each migration's SQL with its own INSERT into _forge_migrations, in one file", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    const migration = {
      name: "0001_init",
      version: 1,
      path: "",
      sha256: migrationChecksum(INIT),
      sql: INIT,
      origin: "custom" as const,
      stamp: null,
    };
    expect(io.files.get("/app/.forge/scratch/migrate/0001_init.sql")).toBe(`${INIT.trimEnd()}\n${recordMigrationSql(migration, NOW.getTime())}`);
  });

  it("terminates a body whose last statement omits its semicolon before appending the history row", async () => {
    const unterminated = composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT");
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: unterminated });
    wire(io);

    await runMigrate(run, OPTIONS);

    const staged = io.files.get("/app/.forge/scratch/migrate/0001_init.sql") ?? "";
    expect(staged.includes("STRICT;\nINSERT INTO _forge_migrations")).toBe(true);
  });

  it("creates the companion tables in one write before staging the first migration", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    const [companions, extra] = writes(io);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS _forge_migrations")).toBe(true);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS _forge_seed_history")).toBe(true);
    expect(extra?.startsWith("UPDATE _forge_migrations SET fingerprint")).toBe(true);
  });

  it("reads the applied names out of _forge_migrations when it exists", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]));

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("says the database is up to date and writes only the companion tables when nothing is pending", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: ACTUAL_FINGERPRINT }]));

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: false });
    expect(trace(io)).toEqual(["read-recorded", "read-inventory", "write"]);
    expect(out).toEqual(["app-db (local) is up to date — 1 migration(s) applied"]);
  });

  it("lists what a dry run would apply and writes nothing, not even the lock", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    const outcome = await runMigrate(run, { ...OPTIONS, dryRun: true });

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: true });
    expect(trace(io)).toEqual(["read-recorded", "read-inventory"]);
    expect(out).toEqual(["would apply 1 to app-db (local): 0001_init"]);
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("aborts on a lint error before it writes anything", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: DROP });
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "1 lint error(s) in the migrations:\nerror /app/migrations/0001_init.sql:3 drop-no-if-exists — DROP without IF EXISTS fails the whole migration when the object is already gone — write DROP … IF EXISTS",
    );
    expect(trace(io)).toEqual(["read-recorded", "read-inventory"]);
  });

  it("lints only the pending files, so a rule added since cannot abort an apply over an applied one", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: DROP, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", sha256: DROP_SHA, applied_at: 1, fingerprint: null }]));

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("logs a lint warning against a local database and applies anyway", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: composed("ALTER TABLE users DROP COLUMN nickname;") });
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(io.logs).toEqual([
      "warning /app/migrations/0001_init.sql:3 drop-column — DROP COLUMN discards the column's data, and a migration is forward-only",
    ]);
    expect(trace(io)).toContain("stage:0001_init.sql");
  });

  it("refuses a lint warning against a deployed database until --allow-warnings says so", async () => {
    const sql = composed("ALTER TABLE users DROP COLUMN nickname;");
    const refused = context({ [`${MIGRATIONS}/0001_init.sql`]: sql }, "remote");
    wire(refused.io);
    await expect(runMigrate(refused.run, OPTIONS)).rejects.toThrow(
      [
        "1 lint warning(s) against remote. Read them, then pass --allow-warnings to apply anyway:",
        "warning /app/migrations/0001_init.sql:3 drop-column — DROP COLUMN discards the column's data, and a migration is forward-only",
      ].join("\n"),
    );

    const allowed = context({ [`${MIGRATIONS}/0001_init.sql`]: sql }, "remote");
    wire(allowed.io);
    expect((await runMigrate(allowed.run, { ...OPTIONS, allowWarnings: true })).applied).toEqual(["0001_init"]);
  });

  it("does not lint at all when the run said not to", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: DROP });
    wire(io);

    expect((await runMigrate(run, { ...OPTIONS, lint: false })).applied).toEqual(["0001_init"]);
    expect(io.logs).toEqual([]);
  });

  it("refuses unstamped DDL even under --no-lint, since a table no schema.sql declares would read as a deletion later", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: "CREATE TABLE strays (id INTEGER PRIMARY KEY) STRICT;" });
    wire(io);

    await expect(runMigrate(run, { ...OPTIONS, lint: false })).rejects.toThrow("custom-ddl");
    expect(trace(io)).not.toContain("stage:0001_init.sql");
  });

  it("refuses to apply over an applied migration whose file is gone, naming it", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", sha256: DROP_SHA, applied_at: 1, fingerprint: null }]));

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("app-db (local) has applied migrations that are no longer on disk:\n  0001_init");
  });

  it("refuses an applied migration whose file was edited since, before the lock and the apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, jsonRows([{ name: "0001_init", sha256: "old-hash", applied_at: 1, fingerprint: null }]));

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "app-db (local) has applied migrations whose files were edited after they were applied:\n  0001_init\nRestore each file from version control to the bytes _forge_migrations recorded, or reset the database; forge will not apply over an edited history.",
    );
    expect(trace(io)).not.toContain("stage:0001_init.sql");
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("refuses a schema fingerprint that moved since the last apply certified it, until --allow-drift says so", async () => {
    const recorded = jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: "stale" }]);

    const refused = context({ [`${MIGRATIONS}/0001_init.sql`]: composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;") }, "local");
    wire(refused.io, recorded);
    await expect(runMigrate(refused.run, OPTIONS)).rejects.toThrow(
      `app-db (local) schema fingerprint ${ACTUAL_FINGERPRINT} is not the stale the last apply certified — either the schema was changed outside the migrations, or an earlier batch part-applied and is being resumed. Inspect with \`forge db migrate status\`, then pass --allow-drift to apply anyway; the apply certifies the fingerprint again.`,
    );
    expect(trace(refused.io)).not.toContain("stage:0001_init.sql");

    const allowed = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT }, "local");
    wire(allowed.io, recorded);
    expect((await runMigrate(allowed.run, { ...OPTIONS, allowDrift: true })).applied).toEqual(["0002_next"]);

    const matching = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT }, "local");
    wire(matching.io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: ACTUAL_FINGERPRINT }]));
    expect((await runMigrate(matching.run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("certifies a moved fingerprint under --allow-drift when there is nothing to apply", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: "stale" }]));

    const outcome = await runMigrate(run, { ...OPTIONS, allowDrift: true });

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: false });
    expect(writes(io).at(-1)).toBe(
      `UPDATE _forge_migrations SET fingerprint = '${ACTUAL_FINGERPRINT}' WHERE id = (SELECT id FROM _forge_migrations ORDER BY id DESC LIMIT 1);`,
    );
    expect(out).toEqual([`certified the schema fingerprint as ${ACTUAL_FINGERPRINT}`, "app-db (local) is up to date — 1 migration(s) applied"]);
  });

  it("does not certify a moved fingerprint under --allow-drift when nothing is applied yet", async () => {
    const { run, io, out } = context({}, "local");
    io.mkdir(MIGRATIONS);
    wire(io, jsonRows([]));

    const outcome = await runMigrate(run, { ...OPTIONS, allowDrift: true });

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: false });
    expect(out).toEqual([
      `${ACTUAL_FINGERPRINT} was not certified — no migration is applied, and the fingerprint rides on the last one`,
      "app-db (local) is up to date — 0 migration(s) applied",
    ]);
  });

  it("passes the fingerprint check when none was ever certified", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]));

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("refuses a pending generated migration stamped against another history, and names the restamp", async () => {
    const wrong = stamped(NEXT, "wrong");
    const digest = migrationsDigest([{ name: "0001_init", sha256: INIT_SHA }]);
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong });
    wire(io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]));

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      `app-db (local): 1 pending generated migration(s) were composed against a different migration history than is now on disk:\n  0002_schema (stamped wrong, on disk ${digest.slice(0, 12)})\nCompose again, or once the files before it are correct, restamp with \`forge db migrate compose --restamp 0002_schema\`.`,
    );
    expect(trace(io)).not.toContain("stage:0002_schema.sql");
  });

  it("applies a generated migration stamped against the history on disk, one with no baseline, and a custom one", async () => {
    const digest = migrationsDigest([{ name: "0001_init", sha256: INIT_SHA }]);
    // A custom migration moves data and never carries DDL, which `custom-ddl` refuses outright.
    for (const sql of [stamped(NEXT, digest), stamped(NEXT, ""), "-- custom\n-- forge:custom {}\nINSERT INTO users (id) VALUES (1);\n"]) {
      const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: sql });
      wire(io, jsonRows([{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]));

      expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_schema"]);
    }
  });

  it("warns, and does not refuse, when the mis-stamped migration is already applied", async () => {
    const wrong = stamped(NEXT, "wrong");
    const digest = migrationsDigest([{ name: "0001_init", sha256: INIT_SHA }]);
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong });
    wire(
      io,
      jsonRows([
        { name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null },
        { name: "0002_schema", sha256: WRONG_SHA, applied_at: 1, fingerprint: ACTUAL_FINGERPRINT },
      ]),
    );

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: false });
    expect(io.logs).toEqual([
      `warning: 0002_schema (stamped wrong, on disk ${digest.slice(0, 12)}) was composed against a different migration history than is now on disk, and is already applied here`,
    ]);
  });

  it("leaves a mis-stamped migration past the --to cut unchecked", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT, [`${MIGRATIONS}/0002_schema.sql`]: stamped(NEXT, "wrong") });
    wire(io);

    const outcome = await runMigrate(run, { ...OPTIONS, to: "0001" });

    expect(outcome.applied).toEqual(["0001_init"]);
    expect(outcome.skipped).toEqual(["0002_schema"]);
    expect(io.logs).toEqual([]);
  });

  it("stops applying at the --to cut and reports the rest as skipped", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io);

    const outcome = await runMigrate(run, { ...OPTIONS, to: "0001" });

    expect(outcome.applied).toEqual(["0001_init"]);
    expect(outcome.skipped).toEqual(["0002_next"]);
    expect(trace(io)).not.toContain("stage:0002_next.sql");
  });

  it("takes the apply lock against the app's own home", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    let heldDuringApply = false;
    io.rules.push(
      { match: isRecordedSelect, reply: NO_TABLE },
      { match: isInventorySelect, reply: jsonRows([]) },
      { match: isWrite, reply: OK },
      {
        match: isFileApply,
        reply: () => {
          heldDuringApply = io.files.has(LOCK);
          return OK;
        },
      },
    );

    await runMigrate(run, OPTIONS);

    expect(heldDuringApply).toBe(true);
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("captures a Time Travel bookmark before a deployed apply and prints the undo", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    wire(io);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome.bookmark).toEqual({
      bookmark: "bm-1",
      restoreCommand: "forge db bookmark restore --target remote --bookmark bm-1 --root '/app' --config '/app/wrangler.jsonc' --db 'DB'",
    });
    expect(trace(io)).toEqual(["read-recorded", "read-inventory", "bookmark", "write", "stage:0001_init.sql", "read-inventory", "write"]);
    expect(out).toEqual(["undo: forge db bookmark restore --target remote --bookmark bm-1 --root '/app' --config '/app/wrangler.jsonc' --db 'DB'"]);
  });

  it("skips the bookmark when the run said not to capture one", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    wire(io);

    expect((await runMigrate(run, { ...OPTIONS, bookmark: false })).bookmark).toBe(undefined);
    expect(trace(io)).not.toContain("bookmark");
    expect(out).toEqual([]);
  });

  it("never captures a bookmark for a local database, which has no Time Travel", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(trace(io)).not.toContain("bookmark");
  });

  it("releases the lock and repeats the undo when the apply fails part way", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    io.rules.push(
      { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
      { match: isRecordedSelect, reply: NO_TABLE },
      { match: isInventorySelect, reply: jsonRows(INVENTORY) },
      { match: isWrite, reply: OK },
      { match: isFileApply, reply: { code: 1, stdout: "", stderr: "boom" } },
    );

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "loading /app/.forge/scratch/migrate/0001_init.sql against remote (app-db) failed (exit 1)",
    );
    expect(io.files.has(LOCK)).toBe(false);
    expect(out).toEqual([
      "undo: forge db bookmark restore --target remote --bookmark bm-1 --root '/app' --config '/app/wrangler.jsonc' --db 'DB'",
      "the database may be part-migrated — undo with: forge db bookmark restore --target remote --bookmark bm-1 --root '/app' --config '/app/wrangler.jsonc' --db 'DB'",
    ]);
  });

  it("refuses to start while another apply holds the lock", async () => {
    const held = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() });
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [LOCK]: held });
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(`Another apply holds ${LOCK} (pid 4242, since 2026-09-11T10:00:00.000Z)`);
    expect(io.calls).toEqual([]);
  });

  it("writes nothing to stdout in JSON mode, leaving the document to the caller", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    run.json = true;
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(out).toEqual([]);
  });

  it("refuses a deployed apply that was not confirmed and has no terminal to ask at", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    run.yes = false;
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "Refusing to migrate app-db (remote) without a terminal to confirm at: 0001_init.\nMigrations are forward-only; the undo is `forge db bookmark restore`. Pass --yes to say so deliberately.",
    );
  });

  it("names the local undo when the deployed database is not the one being migrated", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT }, "standby");
    run.yes = false;
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "Refusing to migrate app-db (standby) without a terminal to confirm at: 0001_init.\nMigrations are forward-only; the undo is `forge db reset` and `forge db restore`. Pass --yes to say so deliberately.",
    );
  });

  it("writes nothing and releases the lock when the deployed confirmation is declined", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    run.yes = false;
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("Refusing to migrate app-db (remote) without a terminal to confirm at: 0001_init.");
    expect(writes(io)).toEqual([]);
    expect(trace(io)).not.toContain("stage:0001_init.sql");
    expect(trace(io)).not.toContain("bookmark");
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("holds the lock over every write, the companion tables included, and removes it after", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);
    const heldWhileWriting: boolean[] = [];
    io.rules.unshift({
      match: isWrite,
      reply: () => {
        heldWhileWriting.push(io.files.has(LOCK));
        return OK;
      },
    });

    await runMigrate(run, OPTIONS);

    expect(heldWhileWriting).toEqual([true, true]);
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("refuses --no-lint against a deployed target before anything is read, naming the flag that accepts warnings there", async () => {
    for (const place of ["remote", "preview"] as const) {
      const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT }, place);
      await expect(runMigrate(run, { ...OPTIONS, lint: false })).rejects.toThrow(
        "--no-lint is local-only; on a deployed target use --allow-warnings to accept warnings.",
      );
      expect(io.calls).toEqual([]);
    }
  });

  it("refuses a generated migration edited since compose even under --no-lint, which judges only the SQL", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_schema.sql`]: `${stamped(INIT, "")}SELECT 1;` });
    wire(io);

    await expect(runMigrate(run, { ...OPTIONS, lint: false })).rejects.toThrow(
      "1 lint error(s) in the migrations:\nerror /app/migrations/0001_schema.sql:2 generated-edited — a generated migration was edited after compose wrote it — edit schema.sql and compose again",
    );
    expect(trace(io)).not.toContain("stage:0001_schema.sql");
  });

  it("asks nothing before a local apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    run.yes = false;
    wire(io);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0001_init"]);
  });
});
