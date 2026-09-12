import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { appHome } from "../home";
import { formatComposeHeader } from "../schema/header";
import { OK, argvHas, composed, fakeDbIo, jsonRows } from "../test-support";
import type { DbConfig, DbRunContext, FakeDbIo, Place, Spawned } from "../types";
import { runMigrate } from "./apply";
import { migrationChecksum, migrationsDigest } from "./files";
import { schemaFingerprint } from "./fingerprint";

const NOW = new Date("2026-09-11T10:00:00Z");
const MIGRATIONS = "/app/migrations";
const LOCK = "/app/.forge/db-apply.lock";

const INIT = composed("CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;");
const NEXT = composed("CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT;");

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
      migrationsDir: MIGRATIONS,
      migrationsTable: "d1_migrations",
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

const OPTIONS = { dryRun: false, lint: true, allowWarnings: false, allowDrift: false, bookmark: true, updateLock: false, rehearse: false };

const NO_TABLE: Spawned = { code: 1, stdout: "", stderr: "no such table: d1_migrations" };
const INVENTORY = [{ type: "table", name: "users", tbl_name: "users", sql: INIT }];
const ACTUAL_FINGERPRINT = schemaFingerprint([{ type: "table", name: "users", tblName: "users", sql: INIT }], "d1_migrations");

const command = (a: readonly string[]) => (argvHas(a, "execute", "--json", "--command") ? (a.at(-1) ?? "") : "");
const isApplied = (a: readonly string[]) => command(a).includes('FROM "d1_migrations"');
const isRecorded = (a: readonly string[]) => command(a).includes("FROM forge_migrations");
const isMeta = (a: readonly string[]) => command(a).includes("FROM forge_schema_meta");
const isInventory = (a: readonly string[]) => command(a).includes("sqlite_master");
const isWrite = (a: readonly string[]) => argvHas(a, "execute", "--yes", "--command");
const isApply = (a: readonly string[]) => argvHas(a, "migrations", "apply");

/** A generated migration: the compose header over `body`, stamped against `baseline`. */
function stamped(body: string, baseline: string): string {
  return `${formatComposeHeader({ desired: {}, baseline, forge: "test" }, body)}${body}`;
}

const STAMPED_INIT = stamped(INIT, migrationsDigest([]));

/** What the target records about itself. */
function facts(io: FakeDbIo, over: { recorded?: Record<string, unknown>[]; meta?: Record<string, unknown>[] }): void {
  io.rules.unshift({ match: isRecorded, reply: jsonRows(over.recorded ?? []) }, { match: isMeta, reply: jsonRows(over.meta ?? []) });
}

/** The rule table a run that reaches the database needs, with the applied names it should read back. */
function wire(io: FakeDbIo, applied: Spawned = NO_TABLE): void {
  io.rules.push(
    { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
    { match: isApplied, reply: applied },
    { match: isRecorded, reply: jsonRows([]) },
    { match: isMeta, reply: jsonRows([]) },
    { match: isInventory, reply: jsonRows(INVENTORY) },
    { match: isWrite, reply: OK },
    { match: isApply, reply: OK },
  );
}

/** The verb of each wrangler call, in the order it was made. */
function trace(io: FakeDbIo): string[] {
  return io.calls.map((call) => {
    const args = call.slice(1);
    if (isApply(args)) return "apply";
    if (argvHas(args, "time-travel", "info")) return "bookmark";
    if (isApplied(args)) return "read-applied";
    if (isRecorded(args)) return "read-recorded";
    if (isMeta(args)) return "read-meta";
    if (isInventory(args)) return "read-inventory";
    if (isWrite(args)) return "write";
    return args.join(" ");
  });
}

const writes = (io: FakeDbIo) => io.calls.filter((call) => isWrite(call.slice(1))).map((call) => call.at(-1) ?? "");

describe("runMigrate()", () => {
  it("applies every pending migration, then records the checksums and the schema facts", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome.applied).toEqual(["0001_init", "0002_next"]);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.dryRun).toBe(false);
    expect(outcome.bookmark).toBe(undefined);
    expect(trace(io)).toEqual(["read-applied", "read-recorded", "read-meta", "read-inventory", "write", "apply", "read-inventory", "write"]);
    expect(out).toEqual([]);
  });

  it("creates the three companion tables before it applies, then records the checksums and the meta in one write", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    const [companions, record, extra] = writes(io);
    expect(extra).toBe(undefined);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS forge_migrations")).toBe(true);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS forge_seed_history")).toBe(true);
    expect((companions ?? "").includes("CREATE TABLE IF NOT EXISTS forge_schema_meta")).toBe(true);
    expect((record ?? "").split("\n").map((line) => line.slice(0, line.indexOf(" VALUES")))).toEqual([
      "INSERT OR REPLACE INTO forge_migrations (applied_name, sha256)",
      "INSERT OR REPLACE INTO forge_schema_meta (key, value)",
      "INSERT OR REPLACE INTO forge_schema_meta (key, value)",
    ]);
    expect(trace(io).slice(-3)).toEqual(["apply", "read-inventory", "write"]);
  });

  it("reads the applied names out of the migrations table when it exists", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", applied_at: "2026-01-01" }]));

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("says the database is up to date and applies nothing when nothing is pending", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, jsonRows([{ name: "0001_init", applied_at: "2026-01-01" }]));
    facts(io, { recorded: [{ applied_name: "0001_init", sha256: migrationChecksum(INIT) }] });

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: [], dryRun: false });
    expect(trace(io)).toEqual(["read-applied", "read-recorded", "read-meta", "read-inventory", "write"]);
    expect(out).toEqual(["app-db (local) is up to date — 1 migration(s) applied"]);
  });

  it("lists what a dry run would apply and writes nothing, not even the lock", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    const outcome = await runMigrate(run, { ...OPTIONS, dryRun: true });

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: [], dryRun: true });
    expect(trace(io)).toEqual(["read-applied", "read-recorded", "read-meta", "read-inventory"]);
    expect(out).toEqual(["would apply 1 to app-db (local): 0001_init"]);
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("aborts on a lint error before it writes anything", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: composed("DROP TABLE users;") });
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "1 lint error(s) in the migrations:\nerror /app/migrations/0001_init.sql:3 drop-no-if-exists — DROP without IF EXISTS fails the whole migration when the object is already gone — write DROP … IF EXISTS",
    );
    expect(trace(io)).toEqual(["read-applied", "read-recorded", "read-meta", "read-inventory"]);
  });

  it("lints only the pending files, so a rule added since cannot abort an apply over an applied one", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: composed("DROP TABLE users;"), [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", applied_at: "t" }]));

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("logs a lint warning against a local database and applies anyway", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: composed("ALTER TABLE users DROP COLUMN nickname;") });
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(io.logs).toEqual([
      "warning /app/migrations/0001_init.sql:3 drop-column — DROP COLUMN discards the column's data, and a migration is forward-only",
    ]);
    expect(trace(io)).toContain("apply");
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
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: composed("DROP TABLE users;") });
    wire(io);

    expect((await runMigrate(run, { ...OPTIONS, lint: false })).applied).toEqual(["0001_init"]);
    expect(io.logs).toEqual([]);
  });

  it("refuses unstamped DDL even under --no-lint, since a table no schema.sql declares would read as a deletion later", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: "CREATE TABLE strays (id INTEGER PRIMARY KEY) STRICT;" });
    wire(io);

    await expect(runMigrate(run, { ...OPTIONS, lint: false })).rejects.toThrow("custom-ddl");
    expect(trace(io)).not.toContain("apply");
  });

  it("refuses to apply over an applied migration whose file is gone, naming it", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, jsonRows([{ name: "0001_init", applied_at: "t" }]));

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("app-db (local) has applied migrations that are no longer on disk:\n  0001_init");
  });

  it("applies through the synthesized home, which holds only the pending files a --to cut leaves", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io);

    const outcome = await runMigrate(run, { ...OPTIONS, to: "0001" });

    expect(outcome.applied).toEqual(["0001_init"]);
    expect(outcome.skipped).toEqual(["0002_next"]);
    expect(io.files.get("/app/.forge/scratch/migrate/migrations/0001_init.sql")).toBe(INIT);
    expect(io.files.has("/app/.forge/scratch/migrate/migrations/0002_next.sql")).toBe(false);
    const generated = JSON.parse(io.files.get("/app/.forge/scratch/migrate/wrangler.jsonc") ?? "{}");
    expect(generated.d1_databases[0].migrations_dir).toBe("/app/.forge/scratch/migrate/migrations");
    expect(io.calls.some((call) => argvHas(call.slice(1), "migrations", "apply", "-c", "/app/.forge/scratch/migrate/wrangler.jsonc"))).toBe(true);
  });

  it("takes the apply lock against the app's own home, never the synthesized one", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    let heldDuringApply = false;
    io.rules.push(
      { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
      { match: isApplied, reply: NO_TABLE },
      { match: isRecorded, reply: jsonRows([]) },
      { match: isMeta, reply: jsonRows([]) },
      { match: isInventory, reply: jsonRows([]) },
      { match: isWrite, reply: OK },
      {
        match: isApply,
        reply: () => {
          heldDuringApply = io.files.has(LOCK) && !io.files.has("/app/.forge/scratch/migrate/.forge/db-apply.lock");
          return OK;
        },
      },
    );

    await runMigrate(run, OPTIONS);

    expect(heldDuringApply).toBe(true);
  });

  it("reaches the configured database_id through the synthesized home on a remote apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    wire(io);

    await runMigrate(run, OPTIONS);

    const generated = JSON.parse(io.files.get("/app/.forge/scratch/migrate/wrangler.jsonc") ?? "{}");
    expect(generated.d1_databases[0].database_id).toBe("0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a");
    expect(
      io.calls.some((call) =>
        argvHas(call.slice(1), "migrations", "apply", "app-db", "-c", "/app/.forge/scratch/migrate/wrangler.jsonc", "--remote"),
      ),
    ).toBe(true);
  });

  it("captures a Time Travel bookmark before a deployed apply and prints the undo", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    wire(io);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome.bookmark).toEqual({
      bookmark: "bm-1",
      restoreCommand: "forge db bookmark restore --target remote --bookmark bm-1 --root /app --config /app/wrangler.jsonc --db DB",
    });
    expect(trace(io)).toEqual([
      "read-applied",
      "read-recorded",
      "read-meta",
      "read-inventory",
      "write",
      "bookmark",
      "apply",
      "read-inventory",
      "write",
    ]);
    expect(out).toEqual(["undo: forge db bookmark restore --target remote --bookmark bm-1 --root /app --config /app/wrangler.jsonc --db DB"]);
  });

  it("skips the bookmark when the run said not to capture one", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    wire(io);

    expect((await runMigrate(run, { ...OPTIONS, bookmark: false })).bookmark).toBe(undefined);
    expect(trace(io)).toEqual(["read-applied", "read-recorded", "read-meta", "read-inventory", "write", "apply", "read-inventory", "write"]);
    expect(out).toEqual([]);
  });

  it("never captures a bookmark for a local database, which has no Time Travel", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(trace(io)).not.toContain("bookmark");
  });

  it("releases the lock when the apply succeeds", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(io.files.has(LOCK)).toBe(false);
  });

  it("releases the lock and repeats the undo when the apply fails part way", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: STAMPED_INIT }, "remote");
    io.rules.push(
      { match: (a) => argvHas(a, "time-travel", "info"), reply: { code: 0, stdout: '{"bookmark":"bm-1"}', stderr: "" } },
      { match: isApplied, reply: NO_TABLE },
      { match: isRecorded, reply: jsonRows([]) },
      { match: isMeta, reply: jsonRows([]) },
      { match: isInventory, reply: jsonRows(INVENTORY) },
      { match: isWrite, reply: OK },
      { match: isApply, reply: { code: 1, stdout: "", stderr: "boom" } },
    );

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("migrations apply against migrate (app-db) failed (exit 1)");
    expect(io.files.has(LOCK)).toBe(false);
    expect(out).toEqual([
      "undo: forge db bookmark restore --target remote --bookmark bm-1 --root /app --config /app/wrangler.jsonc --db DB",
      "the database may be part-migrated — undo with: forge db bookmark restore --target remote --bookmark bm-1 --root /app --config /app/wrangler.jsonc --db DB",
    ]);
  });

  it("refuses to start while another apply holds the lock", async () => {
    const held = JSON.stringify({ pid: 4242, startedAt: NOW.getTime() });
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [LOCK]: held });
    wire(io);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(`Another apply holds ${LOCK} (pid 4242, since 2026-09-11T10:00:00.000Z)`);
    expect(trace(io)).toEqual([]);
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
    expect(trace(io)).not.toContain("apply");
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
    expect(trace(io)).not.toContain("apply");
  });

  it("asks nothing before a local apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    run.yes = false;
    wire(io);

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0001_init"]);
  });
});

describe("runMigrate() — repair, then check", () => {
  const applied1 = jsonRows([{ name: "0001_init", applied_at: "t" }]);
  const applied12 = jsonRows([
    { name: "0001_init", applied_at: "t" },
    { name: "0002_next", applied_at: "t" },
  ]);
  const recorded = (name: string, sha: string) => ({ applied_name: name, sha256: sha });

  it("repairs an unrecorded applied migration from its file, then reports up to date", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, applied1);

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: ["0001_init"], dryRun: false });
    const [, repair, extra] = writes(io);
    expect(extra).toBe(undefined);
    expect(repair).toBe(
      [
        `INSERT OR REPLACE INTO forge_migrations (applied_name, sha256) VALUES ('0001_init', '${migrationChecksum(INIT)}');`,
        `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('migrations_digest', '${migrationsDigest([{ name: "0001_init", sql: INIT }])}');`,
      ].join("\n"),
    );
    expect((repair ?? "").includes("schema_fingerprint")).toBe(false);
    expect(out).toEqual([
      "recorded 1 applied without a forge checksum, from the file: 0001_init",
      "app-db (local) is up to date — 1 migration(s) applied",
    ]);
  });

  it("refuses drift before it records the repair, so a refusal writes nothing", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, applied12);

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("app-db (local) has applied migrations that are no longer on disk:\n  0001_init");
    expect(writes(io)).toEqual([]);
  });

  it("reports the repair on a dry run and writes nothing", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, applied1);

    const outcome = await runMigrate(run, { ...OPTIONS, dryRun: true });

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: ["0001_init"], dryRun: true });
    expect(trace(io)).not.toContain("write");
    expect(out).toEqual(["would record 1 applied without a forge checksum, from the file: 0001_init", "app-db (local) is up to date"]);
  });

  it("refuses an applied migration whose file was edited since, before the lock and the apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, applied1);
    facts(io, { recorded: [recorded("0001_init", "old")] });

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      "app-db (local) has applied migrations whose files were edited after they were applied:\n  0001_init\nRestore each file from version control to the bytes forge_migrations recorded, or reset the database; forge will not apply over an edited history.",
    );
    expect(trace(io)).not.toContain("apply");
    expect(io.files.has(LOCK)).toBe(false);
  });

  it("refuses a schema fingerprint that moved since the last apply recorded it, until --allow-drift says so", async () => {
    const refused = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(refused.io, applied1);
    facts(refused.io, { recorded: [recorded("0001_init", migrationChecksum(INIT))], meta: [{ key: "schema_fingerprint", value: "stale" }] });

    await expect(runMigrate(refused.run, OPTIONS)).rejects.toThrow(
      `app-db (local) schema fingerprint ${ACTUAL_FINGERPRINT} is not the stale the last apply recorded — the schema was changed outside the migrations. Inspect with \`forge db migrate status\`, then pass --allow-drift to apply anyway; the apply re-records the fingerprint.`,
    );
    expect(trace(refused.io)).not.toContain("apply");

    const allowed = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(allowed.io, applied1);
    facts(allowed.io, { recorded: [recorded("0001_init", migrationChecksum(INIT))], meta: [{ key: "schema_fingerprint", value: "stale" }] });
    expect((await runMigrate(allowed.run, { ...OPTIONS, allowDrift: true })).applied).toEqual(["0002_next"]);

    const matching = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(matching.io, applied1);
    facts(matching.io, {
      recorded: [recorded("0001_init", migrationChecksum(INIT))],
      meta: [{ key: "schema_fingerprint", value: ACTUAL_FINGERPRINT }],
    });
    expect((await runMigrate(matching.run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("re-records a moved fingerprint under --allow-drift when there is nothing to apply", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io, applied1);
    facts(io, { recorded: [recorded("0001_init", migrationChecksum(INIT))], meta: [{ key: "schema_fingerprint", value: "stale" }] });

    const outcome = await runMigrate(run, { ...OPTIONS, allowDrift: true });

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: [], dryRun: false });
    expect(writes(io).at(-1)).toBe(
      [
        `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('migrations_digest', '${migrationsDigest([{ name: "0001_init", sql: INIT }])}');`,
        `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('schema_fingerprint', '${ACTUAL_FINGERPRINT}');`,
      ].join("\n"),
    );
    expect(out).toEqual([`re-recorded the schema fingerprint as ${ACTUAL_FINGERPRINT}`, "app-db (local) is up to date — 1 migration(s) applied"]);
  });

  it("repairs what a batch that failed part way left applied, and lets that repair explain the fingerprint it moved", async () => {
    const THIRD = composed("CREATE TABLE tags (id INTEGER PRIMARY KEY) STRICT;");
    const { run, io } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_next.sql`]: NEXT,
      [`${MIGRATIONS}/0003_third.sql`]: THIRD,
    });
    let appliedRows = applied1;
    let inventory = INVENTORY;
    let applyFails = true;
    io.rules.push(
      { match: isApplied, reply: () => appliedRows },
      { match: isRecorded, reply: jsonRows([recorded("0001_init", migrationChecksum(INIT))]) },
      { match: isMeta, reply: jsonRows([{ key: "schema_fingerprint", value: ACTUAL_FINGERPRINT }]) },
      { match: isInventory, reply: () => jsonRows(inventory) },
      { match: isWrite, reply: OK },
      {
        match: isApply,
        reply: () => {
          if (!applyFails) return OK;
          applyFails = false;
          appliedRows = applied12;
          inventory = [...INVENTORY, { type: "table", name: "notes", tbl_name: "notes", sql: NEXT }];
          return { code: 1, stdout: "", stderr: "boom on 0003" };
        },
      },
    );

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow("migrations apply against migrate (app-db) failed (exit 1)");
    expect(io.files.has(LOCK)).toBe(false);

    const second = await runMigrate(run, OPTIONS);

    expect(second).toEqual({ applied: ["0003_third"], skipped: [], repaired: ["0002_next"], dryRun: false });
  });

  it("re-records the fingerprint a repair explains when there is nothing left to apply", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, applied12);
    facts(io, { recorded: [recorded("0001_init", migrationChecksum(INIT))], meta: [{ key: "schema_fingerprint", value: "stale" }] });

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: ["0002_next"], dryRun: false });
    expect(writes(io).at(-1)).toBe(
      [
        `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('migrations_digest', '${migrationsDigest([
          { name: "0001_init", sql: INIT },
          { name: "0002_next", sql: NEXT },
        ])}');`,
        `INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('schema_fingerprint', '${ACTUAL_FINGERPRINT}');`,
      ].join("\n"),
    );
    expect(out).toEqual([
      "recorded 1 applied without a forge checksum, from the file: 0002_next",
      `re-recorded the schema fingerprint as ${ACTUAL_FINGERPRINT}`,
      "app-db (local) is up to date — 2 migration(s) applied",
    ]);
  });

  it("passes the fingerprint check when none was ever recorded", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_next.sql`]: NEXT });
    wire(io, applied1);
    facts(io, { recorded: [recorded("0001_init", migrationChecksum(INIT))] });

    expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_next"]);
  });

  it("refuses a pending generated migration stamped against another history, and names the restamp", async () => {
    const wrong = stamped(NEXT, "wrong");
    const digest = migrationsDigest([{ name: "0001_init", sql: INIT }]);
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong });
    wire(io, applied1);
    facts(io, { recorded: [recorded("0001_init", migrationChecksum(INIT))] });

    await expect(runMigrate(run, OPTIONS)).rejects.toThrow(
      `app-db (local): 1 pending generated migration(s) were composed against a different migration history than is now on disk:\n  0002_schema (stamped wrong, on disk ${digest.slice(0, 12)})\nCompose again, or once the files before it are correct, restamp with \`forge db migrate compose --restamp 0002_schema\`.`,
    );
    expect(trace(io)).not.toContain("apply");
  });

  it("applies a generated migration stamped against the history on disk, one with no baseline, and a custom one", async () => {
    const digest = migrationsDigest([{ name: "0001_init", sql: INIT }]);
    // A custom migration moves data and never carries DDL, which `custom-ddl` refuses outright.
    for (const sql of [stamped(NEXT, digest), stamped(NEXT, ""), "-- custom\n-- forge:custom {}\nINSERT INTO users (id) VALUES (1);\n"]) {
      const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: sql });
      wire(io, applied1);
      facts(io, { recorded: [recorded("0001_init", migrationChecksum(INIT))] });

      expect((await runMigrate(run, OPTIONS)).applied).toEqual(["0002_schema"]);
    }
  });

  it("warns, and does not refuse, when the mis-stamped migration is already applied", async () => {
    const wrong = stamped(NEXT, "wrong");
    const digest = migrationsDigest([{ name: "0001_init", sql: INIT }]);
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong });
    wire(
      io,
      jsonRows([
        { name: "0001_init", applied_at: "t" },
        { name: "0002_schema", applied_at: "t" },
      ]),
    );
    facts(io, { recorded: [recorded("0001_init", migrationChecksum(INIT)), recorded("0002_schema", migrationChecksum(wrong))] });

    const outcome = await runMigrate(run, OPTIONS);

    expect(outcome).toEqual({ applied: [], skipped: [], repaired: [], dryRun: false });
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

  it("records the checksums and the meta in one write after the apply", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });
    wire(io);

    await runMigrate(run, OPTIONS);

    expect(trace(io).slice(-3)).toEqual(["apply", "read-inventory", "write"]);
    const last = writes(io).at(-1) ?? "";
    expect(last.includes("INSERT OR REPLACE INTO forge_migrations")).toBe(true);
    expect(last.includes("INSERT OR REPLACE INTO forge_schema_meta")).toBe(true);
  });
});
