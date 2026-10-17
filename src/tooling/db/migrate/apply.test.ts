import { describe, expect, it } from "bun:test";

import { INVENTORY_SELECT } from "../../../storage/db/schema";
import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { OK, argvHas, composed, fakeDbIo, jsonRows, onStdin, schemaModelRows } from "../db.fixture";
import { appHome } from "../home";
import { formatComposeHeader } from "../schema/header";
import type { DbConfig, DbRunContext, FakeDbIo, Place, Spawned } from "../types";
import { lintPendingMigrations, runMigrate } from "./apply";
import { RECORDED_CHECKSUM_SELECT, recordMigrationSql } from "./checksum";
import { migrationChecksum, migrationsDigest } from "./files";
import { schemaFingerprint } from "./fingerprint";

const NOW = new Date("2026-09-11T10:00:00Z");
const MIGRATIONS = "/app/config/db/migrations";
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

const OPTIONS = { dryRun: false, bookmark: true, rehearse: false };

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

const noTable = () => {
  throw new Error("no such table: _forge_migrations");
};

/** The rule table a run that reaches the database needs, with the recorded rows it should read back. */
function wire(io: FakeDbIo, recorded: Record<string, unknown>[] | null = null): void {
  io.d1Rules.push(
    { match: (statement) => statement === RECORDED_CHECKSUM_SELECT, reply: () => recorded ?? (noTable() as never) },
    { match: (statement) => statement === INVENTORY_SELECT, reply: INVENTORY },
  );
  io.rules.push(
    { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
    { match: isRecordedSelect, reply: recorded === null ? NO_TABLE : jsonRows(recorded) },
    { match: isInventorySelect, reply: jsonRows(INVENTORY) },
    { match: isWrite, reply: OK },
    { match: isFileApply, reply: OK },
  );
}

const targetCalls = (io: FakeDbIo) => io.d1Calls.filter((call) => !call.home.startsWith("scratch:"));

/** What one group of statements did, named as the trace names it. */
function verbOf(statements: readonly string[], source: string | null): string {
  if (source !== null) return `stage:${source.split("/").at(-1)}`;
  if (statements[0] === RECORDED_CHECKSUM_SELECT) return "read-recorded";
  if (statements[0] === INVENTORY_SELECT) return "read-inventory";
  return "write";
}

// A deployed run reaches the database only by spawning and a local one only in process, so the two
// recorders never interleave and concatenating them is the order the run made them in.
/** The verb of each thing the run did against the database, in order. */
function trace(io: FakeDbIo): string[] {
  const spawned = io.calls.map((call) => {
    const args = call.slice(1);
    if (isFileApply(args)) return `stage:${(args.at(-1) ?? "").split("/").at(-1)}`;
    if (argvHas(args, "time-travel", "info")) return "bookmark";
    if (isRecordedSelect(args)) return "read-recorded";
    if (isInventorySelect(args)) return "read-inventory";
    if (isWrite(args)) return "write";
    return args.join(" ");
  });
  return [...spawned, ...targetCalls(io).map((call) => verbOf(call.statements, call.source))];
}

const writes = (io: FakeDbIo) => [
  ...io.calls.filter((call) => isWrite(call.slice(1))).map((call) => call.at(-1) ?? ""),
  ...targetCalls(io)
    .filter((call) => verbOf(call.statements, call.source) === "write")
    .map((call) => call.statements.join("\n")),
];

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

    const migration = { name: "0001_init", version: 1, path: "", sha256: migrationChecksum(INIT), sql: INIT, stamp: null };
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

    const [companions] = writes(io);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS _forge_migrations")).toBe(true);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS _forge_seed_history")).toBe(true);
    expect(writes(io).at(-1)?.startsWith("UPDATE _forge_migrations SET fingerprint")).toBe(true);
  });

  it("reads the applied names out of _forge_migrations when it exists", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("says the database is up to date and writes only the companion tables when nothing is pending", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: ACTUAL_FINGERPRINT }]);

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

  for (const place of ["local", "standby", "remote", "preview"] as const) {
    it(`refuses a lint finding on ${place} before it writes anything, with no option that passes it`, async () => {
      const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: DROP }, place);
      wire(io);

      await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
        "1 lint finding(s) in the pending migrations, so nothing was applied:\n/app/config/db/migrations/0001_init.sql:3 drop-no-if-exists — DROP without IF EXISTS fails the whole migration when the object is already gone — write DROP … IF EXISTS",
      );
      expect(trace(io)).toEqual(["read-recorded", "read-inventory"]);
    });
  }

  it("lints only the pending files, so a rule added since cannot abort an apply over an applied one", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: DROP, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, [{ name: "0001_init", sha256: DROP_SHA, applied_at: 1, fingerprint: null }]);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  const uncomposed: [string, string][] = [
    ["with no compose stamp", "CREATE TABLE strays (id INTEGER PRIMARY KEY) STRICT;\n"],
    ["whose body digest fails", `${INIT}SELECT 1;\n`],
  ];
  for (const [what, sql] of uncomposed) {
    it(`refuses a pending migration ${what} before anything is staged`, async () => {
      const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: sql });
      wire(io);

      const refusal = runMigrate(run, OPTIONS);
      await expect(refusal).rejects.toThrow("app-db (local) has 1 pending migration(s) compose did not write");
      await expect(refusal).rejects.toThrow(/\/app\/config\/db\/migrations\/0001_init\.sql:\d generated-edited — .*compose/);
      expect(trace(io).filter((step) => step.startsWith("stage:"))).toEqual([]);
    });
  }

  it("applies over an unstamped migration the target already holds, judging it by its recorded checksum", async () => {
    const raw = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;\n";
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: raw, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, [{ name: "0001_init", sha256: migrationChecksum(raw), applied_at: 1, fingerprint: null }]);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("refuses the same unstamped migration on a fresh target, with no exemption for an early file", async () => {
    const raw = "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;\n";
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: raw, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("0001_init.sql:1 generated-edited");
    expect(trace(io).filter((step) => step.startsWith("stage:"))).toEqual([]);
  });

  it("refuses to apply over an applied migration whose file is gone, naming it", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, [{ name: "0001_init", sha256: DROP_SHA, applied_at: 1, fingerprint: null }]);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("app-db (local) has applied migrations that are no longer on disk:\n  0001_init");
  });

  it("refuses an applied migration whose file was edited since, before the lock and the apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, [{ name: "0001_init", sha256: "old-hash", applied_at: 1, fingerprint: null }]);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "app-db (local) has applied migrations whose files were edited after they were applied:\n  0001_init\nRestore each file from version control to the bytes _forge_migrations recorded, or reset the database; forge will not apply over an edited history.",
    );
    expect(trace(io)).not.toContain("stage:0001_init.sql");
    expect(io.files.has(LOCK)).toBe(false);
  });

  const STALE = [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: "stale" }];
  const DRIFT_REFUSAL = (place: Place) =>
    `app-db (${place}) schema fingerprint ${ACTUAL_FINGERPRINT} is not the stale the last apply certified — either the schema was changed outside the migrations, or an earlier batch part-applied and is being resumed. Inspect with \`forge db migrate status\`, then restore the database to the schema its migrations describe — \`forge db bookmark restore\` on a deployed one, \`forge db reset\` and \`forge db restore\` on a local one — and run again; nothing passes this check.`;

  for (const place of ["local", "remote"] as const) {
    it(`refuses a schema fingerprint that moved since the last apply certified it on ${place}, with a migration pending or not`, async () => {
      for (const files of [
        { [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT },
        { [`${MIGRATIONS}/0001_init.sql`]: INIT },
      ]) {
        const { run, io } = context(files, place);
        wire(io, STALE);

        await expect(runMigrate(run, OPTIONS)).rejects.toThrow(DRIFT_REFUSAL(place));
        expect(trace(io).filter((step) => step === "write" || step.startsWith("stage:"))).toEqual([]);
      }
    });
  }

  it("applies over a fingerprint that matches the last one certified", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: ACTUAL_FINGERPRINT }]);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("certifies a fingerprint never certified before when there is nothing to apply", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: false });
    expect(writes(io).at(-1)).toBe(
      `UPDATE _forge_migrations SET fingerprint = '${ACTUAL_FINGERPRINT}' WHERE id = (SELECT id FROM _forge_migrations ORDER BY id DESC LIMIT 1)`,
    );
    expect(out).toEqual([`certified the schema fingerprint as ${ACTUAL_FINGERPRINT}`, "app-db (local) is up to date — 1 migration(s) applied"]);
  });

  it("certifies nothing when no migration is applied, since the fingerprint rides on the last one", async () => {
    const { run, io, out } = context({}, "local");
    io.mkdir(MIGRATIONS);
    wire(io, []);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], dryRun: false });
    expect(writes(io).filter((sql) => sql.includes("SET fingerprint"))).toEqual([]);
    expect(out).toEqual(["app-db (local) is up to date — 0 migration(s) applied"]);
  });

  it("passes the fingerprint check when none was ever certified", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("refuses a pending generated migration stamped against another history, and names the restamp", async () => {
    const wrong = stamped(NEXT, "wrong");
    const digest = migrationsDigest([{ name: "0001_init", sha256: INIT_SHA }]);
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong });
    wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      `app-db (local): 1 pending generated migration(s) were composed against a different migration history than is now on disk:\n  0002_schema (stamped wrong, on disk ${digest.slice(0, 12)})\nCompose again, or once the files before it are correct, restamp with \`forge db migrate compose --restamp 0002_schema\`.`,
    );
    expect(trace(io)).not.toContain("stage:0002_schema.sql");
  });

  it("applies a generated migration stamped against the history on disk, and one with no baseline", async () => {
    const digest = migrationsDigest([{ name: "0001_init", sha256: INIT_SHA }]);
    for (const sql of [stamped(NEXT, digest), stamped(NEXT, "")]) {
      const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: sql });
      wire(io, [{ name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null }]);

      expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_schema"]);
    }
  });

  it("warns, and does not refuse, when the mis-stamped migration is already applied", async () => {
    const wrong = stamped(NEXT, "wrong");
    const digest = migrationsDigest([{ name: "0001_init", sha256: INIT_SHA }]);
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong });
    wire(io, [
      { name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null },
      { name: "0002_schema", sha256: WRONG_SHA, applied_at: 1, fingerprint: ACTUAL_FINGERPRINT },
    ]);

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
    io.d1Rules.push(
      { match: (statement) => statement === RECORDED_CHECKSUM_SELECT, reply: () => noTable() as never },
      { match: (statement) => statement === INVENTORY_SELECT, reply: [] },
      {
        match: (statement) => statement.includes("CREATE TABLE users"),
        reply: () => {
          heldDuringApply = io.files.has(LOCK);
          return [];
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
    expect(trace(io)).toEqual(["read-recorded", "read-inventory", "write", "bookmark", "stage:0001_init.sql", "read-inventory", "write"]);
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

  it("prints no part-migrated line when the companion tables are refused, since the bookmark is not yet taken", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    io.rules.push(
      { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
      { match: isRecordedSelect, reply: NO_TABLE },
      { match: isInventorySelect, reply: jsonRows(INVENTORY) },
      { match: isWrite, reply: { code: 1, stdout: "", stderr: "Authentication error [code: 10000]" } },
      { match: isFileApply, reply: OK },
    );

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "the API token cannot write D1 — add Account → D1 → Edit to it, then run again. Nothing was applied.",
    );
    expect(trace(io)).toEqual(["read-recorded", "read-inventory", "write"]);
    expect(out).toEqual([]);
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("repeats the undo when a later migration fails after an earlier one applied under the bookmark", async () => {
    const { run, io, out } = context(
      { [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT, [`${MIGRATIONS}/0002_next.sql`]: stamped(NEXT, "") },
      "remote",
    );
    io.rules.push(
      { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
      { match: isRecordedSelect, reply: NO_TABLE },
      { match: isInventorySelect, reply: jsonRows(INVENTORY) },
      { match: isWrite, reply: OK },
      { match: (a) => isFileApply(a) && (a.at(-1) ?? "").endsWith("0002_next.sql"), reply: { code: 1, stdout: "", stderr: "boom" } },
      { match: isFileApply, reply: OK },
    );

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "loading /app/.forge/scratch/migrate/0002_next.sql against remote (app-db) failed (exit 1)",
    );
    expect(trace(io)).toContain("stage:0001_init.sql");
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

    await expect(onStdin(false, "", () => runMigrate(run, OPTIONS))).rejects.toThrow(
      "Refusing to migrate app-db (remote) without a terminal to confirm at: 0001_init.\nMigrations are forward-only; the undo is `forge db bookmark restore`. Pass --yes to say so deliberately.",
    );
  });

  it("names the local undo when the deployed database is not the one being migrated", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT }, "standby");
    run.yes = false;
    wire(io);

    await expect(onStdin(false, "", () => runMigrate(run, OPTIONS))).rejects.toThrow(
      "Refusing to migrate app-db (standby) without a terminal to confirm at: 0001_init.\nMigrations are forward-only; the undo is `forge db reset` and `forge db restore`. Pass --yes to say so deliberately.",
    );
  });

  it("writes nothing and releases the lock when the deployed confirmation is declined", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    run.yes = false;
    wire(io);

    await expect(onStdin(false, "", () => runMigrate(run, OPTIONS))).rejects.toThrow(
      "Refusing to migrate app-db (remote) without a terminal to confirm at: 0001_init.",
    );
    expect(writes(io)).toEqual([]);
    expect(trace(io)).not.toContain("stage:0001_init.sql");
    expect(trace(io)).not.toContain("bookmark");
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("holds the lock over every write, the companion tables included, and removes it after", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);
    const heldWhileWriting: boolean[] = [];
    io.d1Rules.unshift({
      match: (statement) => statement.includes("CREATE TABLE IF NOT EXISTS _forge_migrations") || statement.includes("UPDATE _forge_migrations"),
      reply: () => {
        heldWhileWriting.push(io.files.has(LOCK));
        return [];
      },
    });

    await runMigrate(run, OPTIONS);

    expect(heldWhileWriting).toEqual([true, true]);
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("refuses a generated migration edited since compose, naming the file", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_schema.sql`]: `${stamped(INIT, "")}SELECT 1;` });
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "app-db (local) has 1 pending migration(s) compose did not write, or that were edited after it wrote them, so nothing was applied:\n/app/config/db/migrations/0001_schema.sql:2 generated-edited — a generated migration was edited after compose wrote it — edit schema.sql and compose again",
    );
    expect(trace(io)).not.toContain("stage:0001_schema.sql");
  });

  it("asks nothing before a local apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    run.yes = false;
    wire(io);

    expect((await onStdin(false, "", () => runMigrate(run, OPTIONS))).value.applied).toEqual(["0001_init"]);
  });
});

const ANALYSIS = "scratch:compose-analysis";
const APPLIED_INIT = { name: "0001_init", sha256: INIT_SHA, applied_at: 1, fingerprint: null };
const DROP_USERS = "DROP TABLE IF EXISTS users;";
const REBUILD_USERS = [
  'CREATE TABLE "_forge_new_users" (id INTEGER PRIMARY KEY) STRICT;',
  'INSERT INTO "_forge_new_users" (id) SELECT id FROM "users";',
  'DROP TABLE "users";',
  'ALTER TABLE "_forge_new_users" RENAME TO "users";',
].join("\n");

function usersRows(columns: readonly string[]) {
  return {
    inventory: [
      {
        type: "table",
        name: "users",
        tbl_name: "users",
        sql: `CREATE TABLE users (${columns.map((name) => `${name} ${name === "id" ? "INTEGER PRIMARY KEY" : "TEXT"}`).join(", ")}) STRICT`,
      },
    ],
    columns: columns.map((name, cid) => ({
      tbl: "users",
      cid,
      name,
      type: name === "id" ? "INTEGER" : "TEXT",
      notnull: 0,
      dflt_value: null,
      pk: name === "id" ? 1 : 0,
      hidden: 0,
    })),
  };
}

/** Answers the analysis copy's model reads: `before` until a statement holding `marker` is staged into it, `after` from then on. */
function analysedAs(io: FakeDbIo, marker: string, before: ReturnType<typeof usersRows> | null, after: ReturnType<typeof usersRows> | null): void {
  const staged = () => io.d1Calls.some((call) => call.home === ANALYSIS && call.statements.some((statement) => statement.includes(marker)));
  io.d1Rules.unshift({
    match: (_statement, home) => home.label === ANALYSIS,
    reply: (statement) => schemaModelRows(statement, (staged() ? after : before) ?? {}),
  });
}

const stagedForApply = (io: FakeDbIo) => [...io.files.keys()].filter((path) => path.startsWith("/app/.forge/scratch/migrate/"));

describe("runMigrate() — the migration analysis", () => {
  const files = (next: string) => ({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: next });
  const unapproved = "0002_next does not match the lines compose wrote for it on app-db";

  for (const place of ["local", "remote"] as const) {
    it(`refuses a drop no line approves on ${place}, before any bookmark, staged migration or history row`, async () => {
      const { run, io } = context(files(composed(DROP_USERS)), place);
      wire(io, [APPLIED_INIT]);
      analysedAs(io, DROP_USERS.slice(0, -1), usersRows(["id"]), null);

      await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
        `${unapproved} (${place}), so nothing was applied:\n  drops table "users" — no \`-- forge:drops table "users"\` line approves it`,
      );
      expect(trace(io)).toEqual(["read-recorded", "read-inventory"]);
      expect(io.calls.some((call) => argvHas(call, "time-travel"))).toBe(false);
      expect(stagedForApply(io)).toEqual([]);
    });

    it(`applies the same drop on ${place} once its line approves it`, async () => {
      const { run, io } = context(files(composed(`-- forge:drops table "users"\n${DROP_USERS}`)), place);
      wire(io, [APPLIED_INIT]);
      analysedAs(io, DROP_USERS.slice(0, -1), usersRows(["id"]), null);

      expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
    });
  }

  for (const place of ["local", "remote"] as const) {
    it(`refuses a rebuild that drops a column with no line on ${place}, and applies it with one`, async () => {
      const refused = context(files(composed(REBUILD_USERS)), place);
      wire(refused.io, [APPLIED_INIT]);
      analysedAs(refused.io, "_forge_new_users", usersRows(["id", "nickname"]), usersRows(["id"]));
      await expect(runMigrate(refused.run, OPTIONS)).rejects.toThrow(
        `${unapproved} (${place}), so nothing was applied:\n  drops column "users"."nickname" — no \`-- forge:drops column "users"."nickname"\` line approves it`,
      );
      expect(trace(refused.io)).toEqual(["read-recorded", "read-inventory"]);
      expect(stagedForApply(refused.io)).toEqual([]);

      const approved = context(files(composed(`-- forge:drops column "users"."nickname"\n${REBUILD_USERS}`)), place);
      wire(approved.io, [APPLIED_INIT]);
      analysedAs(approved.io, "_forge_new_users", usersRows(["id", "nickname"]), usersRows(["id"]));
      expect((await runMigrate(approved.run, OPTIONS)).applied).toEqual(["0002_next"]);
    });
  }

  it("lists each pending file in the deployed confirmation with the approved drops it makes, and a file that makes none by name alone", async () => {
    const { run, io } = context(
      { ...files(composed(`-- forge:drops table "users"\n${DROP_USERS}`)), [`${MIGRATIONS}/0003_notes.sql`]: NEXT },
      "remote",
    );
    run.yes = false;
    wire(io, [APPLIED_INIT]);
    analysedAs(io, DROP_USERS.slice(0, -1), usersRows(["id"]), null);

    await expect(onStdin(false, "", () => runMigrate(run, OPTIONS))).rejects.toThrow(
      'Refusing to migrate app-db (remote) without a terminal to confirm at: 0002_next (drops table "users"), 0003_notes.\nMigrations are forward-only; the undo is `forge db bookmark restore`. Pass --yes to say so deliberately.',
    );
    expect(stagedForApply(io)).toEqual([]);
    expect(io.calls.some((call) => argvHas(call, "time-travel"))).toBe(false);
  });

  it("refuses the same unapproved drop under --dry-run, as the real run would", async () => {
    const { run, io } = context(files(composed(DROP_USERS)));
    wire(io, [APPLIED_INIT]);
    analysedAs(io, DROP_USERS.slice(0, -1), usersRows(["id"]), null);

    await expect(runMigrate(run, { ...OPTIONS, dryRun: true })).rejects.toThrow(`${unapproved} (local), so nothing was applied`);
  });

  it("builds no copy when nothing is pending", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, [APPLIED_INIT]);

    await runMigrate(run, OPTIONS);

    expect(io.d1Calls.some((call) => call.home === ANALYSIS)).toBe(false);
  });

  it("refuses a remote target whose inventory wrangler cannot read, with wrangler's error, building no copy", async () => {
    const { run, io } = context(files(composed(DROP_USERS)), "remote");
    io.rules.push(
      { match: isRecordedSelect, reply: jsonRows([APPLIED_INIT]) },
      { match: isInventorySelect, reply: { code: 1, stdout: "", stderr: "Authentication error [code: 10000]" } },
    );

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("Authentication error [code: 10000]");
    expect(io.d1Calls.some((call) => call.home === ANALYSIS)).toBe(false);
  });

  it("refuses a local target it cannot open, with the open error, building no copy", async () => {
    const { run, io } = context(files(composed(DROP_USERS)));
    io.d1 = () => Promise.reject(new Error("SQLITE_CANTOPEN: unable to open database file"));

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("SQLITE_CANTOPEN");
    expect(stagedForApply(io)).toEqual([]);
  });
});

describe("lintPendingMigrations()", () => {
  const files = (next: string) => ({ [`${MIGRATIONS}/0001_init.sql`]: composed("DELETE FROM users;"), [`${MIGRATIONS}/0002_next.sql`]: next });

  it("judges only the files the target does not hold, so an applied one a rule now fails is not reported", async () => {
    const { run, io } = context(files(NEXT));
    wire(io, [{ ...APPLIED_INIT, sha256: migrationChecksum(composed("DELETE FROM users;")) }]);

    expect(await lintPendingMigrations(run)).toEqual({ pending: ["0002_next"], findings: [], approved: [] });
  });

  it("returns the lint findings without analysing", async () => {
    const { run, io } = context(files(composed("UPDATE users SET id = 1;")));
    wire(io, [APPLIED_INIT]);

    const outcome = await lintPendingMigrations(run);

    expect(outcome.findings.map((finding) => finding.rule)).toEqual(["unbounded-update"]);
    expect(outcome.approved).toEqual([]);
    expect(io.d1Calls.some((call) => call.home === ANALYSIS)).toBe(false);
  });

  it("refuses a drop no line approves", async () => {
    const { run, io } = context(files(composed(DROP_USERS)));
    wire(io, [APPLIED_INIT]);
    analysedAs(io, DROP_USERS.slice(0, -1), usersRows(["id"]), null);

    await expect(lintPendingMigrations(run)).rejects.toThrow("0002_next does not match the lines compose wrote for it on app-db (local)");
  });

  it("hands back each finding its line approves", async () => {
    const { run, io } = context(files(composed(`-- forge:drops table "users"\n${DROP_USERS}`)));
    wire(io, [APPLIED_INIT]);
    analysedAs(io, DROP_USERS.slice(0, -1), usersRows(["id"]), null);

    expect(await lintPendingMigrations(run)).toEqual({
      pending: ["0002_next"],
      findings: [],
      approved: [{ migration: "0002_next", severity: "destructive", change: { action: "drops", object: { type: "table", name: "users" } } }],
    });
  });

  it("runs while another apply holds the lock, since it writes only the analysis scratch", async () => {
    const held = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() });
    const { run, io } = context({ ...files(NEXT), [LOCK]: held });
    wire(io, [APPLIED_INIT]);

    expect((await lintPendingMigrations(run)).pending).toEqual(["0002_next"]);
    expect(io.files.get(LOCK)).toBe(held);
  });
});
