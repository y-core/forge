import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { argvHas, fakeDbIo, schemaModelRows } from "../db.fixture";
import { sha256 } from "../digest";
import { appHome } from "../home";
import { migrationChecksum, migrationsDigest } from "../migrate/files";
import type { DbConfig, DbHostConfig, DbRunContext, FakeDbIo } from "../types";
import { composeMigration } from "./compose";
import { destructivePlanDigest } from "./diff";
import { formatComposeHeader, formatCustomHeader, parseMigrationHeader } from "./header";
import { buildSchemaSnapshot, formatSchemaSnapshot } from "./snapshot";
import type { ComposeOptions, SchemaDiff } from "./types";

const NO_NAMED = { created: [], dropped: [], changed: [] };
const DROPS_NICKNAME: SchemaDiff = {
  tables: [{ kind: "alter", name: "users", added: [], dropped: ["nickname"] }],
  indexes: NO_NAMED,
  triggers: NO_NAMED,
  views: NO_NAMED,
  destructive: [],
  refusals: [],
  dataDependent: [],
  dropDependents: [],
};

const ROOT = "/app";
const MIGRATIONS = `${ROOT}/migrations`;
const SCHEMA = `${ROOT}/schema.sql`;
const SNAPSHOT = `${ROOT}/schema.snapshot.json`;
const BASELINE_STATE = `${ROOT}/.forge/scratch/compose/baseline/.wrangler/state`;
const DESIRED_STATE = `${ROOT}/.forge/scratch/compose/desired/.wrangler/state`;

const INIT = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL) STRICT;\n";

interface Shape {
  readonly name: string;
  readonly columns: readonly (readonly [string, string])[];
}

const USERS: Shape = {
  name: "users",
  columns: [
    ["id", "INTEGER PRIMARY KEY"],
    ["email", "TEXT NOT NULL"],
  ],
};
const USERS_WITH_NICKNAME: Shape = { name: "users", columns: [...USERS.columns, ["nickname", "TEXT"]] };
const USERS_NICK_REQUIRED: Shape = { name: "users", columns: [...USERS.columns, ["nickname", "TEXT NOT NULL DEFAULT ''"]] };
const NICK_WARNING =
  "warning: users.nickname becomes NOT NULL — the rebuild copies existing rows as they are, so one holding NULL fails it (the DEFAULT does not fill it in); rehearse it on `standby` first";
const NOTES: Shape = {
  name: "notes",
  columns: [
    ["id", "INTEGER PRIMARY KEY"],
    ["body", "TEXT"],
  ],
};
const NOTES_WITH_AUTHOR: Shape = { name: "notes", columns: [...NOTES.columns, ["author", "TEXT NOT NULL"]] };

function ddl(shape: Shape): string {
  return `CREATE TABLE ${shape.name} (${shape.columns.map(([name, rest]) => `${name} ${rest}`).join(", ")}) STRICT`;
}

function schemaText(shapes: readonly Shape[]): string {
  return `${shapes.map((shape) => `${ddl(shape)};`).join("\n\n")}\n`;
}

function shapeRows(shapes: readonly Shape[]) {
  return {
    inventory: shapes.map((shape) => ({ type: "table", name: shape.name, tbl_name: shape.name, sql: ddl(shape) })),
    columns: shapes.flatMap((shape) =>
      shape.columns.map(([name, rest], cid) => ({
        tbl: shape.name,
        cid,
        name,
        type: rest.split(" ")[0],
        notnull: /\bNOT NULL\b/.test(rest) ? 1 : 0,
        dflt_value: /\bDEFAULT\s+(\S+)/.exec(rest)?.[1] ?? null,
        pk: /\bPRIMARY KEY\b/.test(rest) ? 1 : 0,
        hidden: 0,
      })),
    ),
  };
}

function wranglerConfig(): WranglerConfig {
  return {
    name: "app",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a" }],
  } as WranglerConfig;
}

function dbConfig(): DbConfig {
  return {
    root: ROOT,
    configPath: `${ROOT}/wrangler.jsonc`,
    config: wranglerConfig(),
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place: "local", database: null },
  };
}

function context(
  files: Record<string, string>,
  host: DbHostConfig = { schemas: ["schema.sql"] },
): { run: DbRunContext; io: FakeDbIo; out: string[] } {
  const io = fakeDbIo(files, { now: new Date("2026-09-11T10:00:00Z") });
  const config = dbConfig();
  const out: string[] = [];
  const run: DbRunContext = { config, home: appHome(config), io, host, json: false, yes: true, style: PLAIN, print: (line) => out.push(line) };
  return { run, io, out };
}

const OPTIONS: ComposeOptions = { custom: false, dryRun: false, renames: [], cache: true };

function introspect(shapes: readonly Shape[], extra: Unowned = {}): (statement: string) => Record<string, unknown>[] {
  return (statement) => {
    const rows = shapeRows(shapes);
    return schemaModelRows(statement, {
      inventory: [...rows.inventory, ...(extra.inventory ?? [])],
      columns: [...rows.columns, ...(extra.columns ?? [])],
      foreignKeys: [...(extra.foreignKeys ?? [])],
    });
  };
}

interface Unowned {
  readonly inventory?: readonly Record<string, unknown>[] | undefined;
  readonly columns?: readonly Record<string, unknown>[] | undefined;
  readonly foreignKeys?: readonly Record<string, unknown>[] | undefined;
}

function wire(
  io: FakeDbIo,
  sides: {
    baseline: readonly Shape[];
    desired: readonly Shape[];
    after?: readonly Shape[];
    baselineExtra?: readonly Record<string, unknown>[];
    baselineColumns?: readonly Record<string, unknown>[];
    baselineForeignKeys?: readonly Record<string, unknown>[];
  },
): void {
  io.rules.push({ match: (a) => argvHas(a, "--version"), reply: { code: 0, stdout: "4.0.0\n", stderr: "" } });
  const proved = () => io.d1Calls.some((call) => call.source?.endsWith("proof.sql") === true);
  io.d1Rules.push({
    match: (_statement, home) => home.persistTo === BASELINE_STATE,
    reply: (statement) =>
      proved()
        ? introspect(sides.after ?? sides.desired)(statement)
        : introspect(sides.baseline, { inventory: sides.baselineExtra, columns: sides.baselineColumns, foreignKeys: sides.baselineForeignKeys })(
            statement,
          ),
  });
  io.d1Rules.push({ match: (_statement, home) => home.persistTo === DESIRED_STATE, reply: introspect(sides.desired) });
}

const pragmaReads = (io: FakeDbIo) => io.d1Calls.flatMap((call) => call.statements).filter((statement) => statement.includes("pragma_")).length;

describe("composeMigration()", () => {
  it("refuses to compose when config/db.ts names no schema on disk, pointing at the pull that bootstraps one", async () => {
    const { run } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow("config/db.ts names no `schemas`");
  });

  it("composes nothing and writes nothing when config/db.ts names no schemas and there is no history, as `schema check` passes it", async () => {
    const { run, io, out } = context({}, {});

    const outcome = await composeMigration(run, OPTIONS);

    expect(outcome).toEqual({ path: null, snapshotPath: null, plan: [], warnings: [], causes: [], sql: "", dryRun: false });
    expect(out).toEqual(["config/db.ts names no `schemas`, and there is no snapshot and no migration — nothing to compose"]);
    expect([...io.files.keys()]).toEqual([]);
    expect(io.calls).toEqual([]);
  });

  describe("refuses an empty `schemas` over history, which composing nothing would drop", () => {
    const guidance =
      "config/db.ts names no `schemas` — every desired-state file is declared there, including a library's, so that nothing contributes DDL to this database without being asked for:\n" +
      '  export default { schemas: ["node_modules/@y-core/forge/src/auth/schema.sql", "config/schema.sql"] } satisfies DbHostConfig;\n' +
      "Each entry is a file of plain `CREATE TABLE` text stating that schema once — write it, then compose.";
    const snapshot = formatSchemaSnapshot(buildSchemaSnapshot({ desired: { "schema.sql": "old" }, declared: {}, migrationsDigest: "old" }));
    const refusal = async (files: Record<string, string>) => {
      const { run, io } = context(files, {});
      const error = await composeMigration(run, OPTIONS).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      return { message: error instanceof Error ? error.message : null, files: [...io.files.keys()].sort(), calls: io.calls };
    };

    it("names the migrations on disk", async () => {
      expect(await refusal({ [`${MIGRATIONS}/0001_init.sql`]: INIT })).toEqual({
        message: `the migrations reach 0001_init — there is history to hold in step, so composing from no schema is refused:\n${guidance}`,
        files: [`${MIGRATIONS}/0001_init.sql`],
        calls: [],
      });
    });

    it("names the snapshot on disk", async () => {
      expect(await refusal({ [SNAPSHOT]: snapshot })).toEqual({
        message: `${SNAPSHOT} exists — there is history to hold in step, so composing from no schema is refused:\n${guidance}`,
        files: [SNAPSHOT],
        calls: [],
      });
    });

    it("names both when both are on disk", async () => {
      expect((await refusal({ [SNAPSHOT]: snapshot, [`${MIGRATIONS}/0001_init.sql`]: INIT })).message).toBe(
        `${SNAPSHOT} exists and the migrations reach 0001_init — there is history to hold in step, so composing from no schema is refused:\n${guidance}`,
      );
    });
  });

  it("writes a named custom migration with the custom header and nothing else", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    const outcome = await composeMigration(run, { ...OPTIONS, custom: true, name: "backfill emails" });

    expect(outcome.path).toBe(`${MIGRATIONS}/0002_backfill_emails.sql`);
    expect(outcome.plan).toEqual(["custom migration 0002_backfill_emails.sql"]);
    expect(io.files.get(`${MIGRATIONS}/0002_backfill_emails.sql`)).toBe(`${formatCustomHeader()}\n`);
    expect(io.calls).toEqual([]);
  });

  it("refuses a custom migration with no name", async () => {
    const { run } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    await expect(composeMigration(run, { ...OPTIONS, custom: true })).rejects.toThrow(
      "a custom migration needs a name — `forge db migrate compose --custom <name>`",
    );
  });

  it("writes the snapshot and no migration when the migrations already produce the desired state", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    const outcome = await composeMigration(run, OPTIONS);

    expect(outcome.path).toBe(null);
    expect(outcome.snapshotPath).toBe(SNAPSHOT);
    expect(outcome.plan).toEqual([]);
    expect(out).toEqual([`no changes — ${MIGRATIONS} already produces every declared schema`]);
    const snapshot = JSON.parse(io.files.get(SNAPSHOT) ?? "{}");
    expect(snapshot.desired).toEqual({ "schema.sql": sha256(schemaText([USERS])) });
    expect(snapshot.migrationsDigest).toBe(migrationsDigest([{ name: "0001_init", sha256: migrationChecksum(INIT) }]));
  });

  it("refuses a declared object in a reserved space, naming the file, the object and the prefixes", async () => {
    const reserved: Shape = { name: "_forge_audit", columns: [["id", "INTEGER PRIMARY KEY"]] };
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, reserved]) });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      "schema.sql declares table `_forge_audit`\n`_forge_`, `sqlite_`, `_cf_` are reserved for forge, SQLite and the platform — rename it, or drop it from the schema.",
    );
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.calls).toEqual([]);
  });

  it("writes the numbered migration, its compose header and the snapshot for a created table", async () => {
    const desiredText = schemaText([USERS, NOTES]);
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: desiredText });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    const outcome = await composeMigration(run, OPTIONS);

    const path = `${MIGRATIONS}/0002_schema.sql`;
    expect(outcome.path).toBe(path);
    expect(outcome.plan).toEqual(["create table notes"]);
    expect(out).toEqual([`wrote ${path}`, "  create table notes"]);

    const written = io.files.get(path) ?? "";
    const header = parseMigrationHeader(written);
    expect(header.origin).toBe("generated");
    expect(header.stamp).toEqual({
      desired: { "schema.sql": sha256(desiredText) },
      baseline: migrationsDigest([{ name: "0001_init", sha256: migrationChecksum(INIT) }]),
      body: sha256(header.covered),
      forge: "unknown",
    });
    expect(header.body).toBe(`PRAGMA defer_foreign_keys = true;\n\n${ddl(NOTES)};\n`);

    const snapshot = JSON.parse(io.files.get(SNAPSHOT) ?? "{}");
    expect(snapshot.migrationsDigest).toBe(
      migrationsDigest([
        { name: "0001_init", sha256: migrationChecksum(INIT) },
        { name: "0002_schema", sha256: migrationChecksum(written) },
      ]),
    );
  });

  it("writes nothing under --dry-run and hands back the SQL it would have written", async () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    const outcome = await composeMigration(run, { ...OPTIONS, dryRun: true });

    expect(outcome.path).toBe(null);
    expect(outcome.snapshotPath).toBe(null);
    expect(outcome.dryRun).toBe(true);
    expect(parseMigrationHeader(outcome.sql).body).toBe(`PRAGMA defer_foreign_keys = true;\n\n${ddl(NOTES)};\n`);
    expect(out).toEqual([`would write ${MIGRATIONS}/0002_schema.sql:`, "  create table notes"]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.files.has(SNAPSHOT)).toBe(false);
  });

  it("refuses a diff that discards data, printing the digest of the drop set", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const refused = context(files);
    wire(refused.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_NICKNAME);

    await expect(composeMigration(refused.run, OPTIONS)).rejects.toThrow(
      `the change discards data:\n  users: drops column nickname\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
    );
    expect(refused.out).toEqual(["  drop column users.nickname"]);
    expect(refused.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("composes the drop once --allow-destructive carries that plan's digest", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const allowed = context(files);
    wire(allowed.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS], after: [USERS] });

    const outcome = await composeMigration(allowed.run, { ...OPTIONS, allowDestructive: destructivePlanDigest(DROPS_NICKNAME) });

    expect(outcome.path).toBe(`${MIGRATIONS}/0002_schema.sql`);
    expect(allowed.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(true);
  });

  it("refuses a stale digest, naming the drop set as it now stands", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const stale = context(files);
    wire(stale.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_NICKNAME);

    await expect(composeMigration(stale.run, { ...OPTIONS, allowDestructive: "000000000000" })).rejects.toThrow(
      `--allow-destructive 000000000000 is not the plan you approved — the destructive set is now (${digest}):\n  users: drops column nickname\nRead it again, then pass --allow-destructive ${digest}.`,
    );
    expect(stale.out).toEqual(["  drop column users.nickname"]);
    expect(stale.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("warns, with the plan, when a rebuild depends on the rows already there", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS_NICK_REQUIRED]) };
    const { run, io, out } = context(files);
    wire(io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED], after: [USERS_NICK_REQUIRED] });

    const outcome = await composeMigration(run, OPTIONS);

    expect(outcome.warnings).toEqual([NICK_WARNING]);
    expect(out).toEqual([`wrote ${MIGRATIONS}/0002_schema.sql`, "  rebuild table users (column-changed)", NICK_WARNING]);
    expect(io.logs).toEqual([]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(true);
  });

  it("sends the rebuild warning to the log under --json, and prints it last under --dry-run", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS_NICK_REQUIRED]) };
    const json = context(files);
    wire(json.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED], after: [USERS_NICK_REQUIRED] });

    expect((await composeMigration({ ...json.run, json: true }, OPTIONS)).warnings).toEqual([NICK_WARNING]);
    expect(json.out).toEqual([]);
    expect(json.io.logs).toEqual([NICK_WARNING]);

    const dry = context(files);
    wire(dry.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED] });

    expect((await composeMigration(dry.run, { ...OPTIONS, dryRun: true })).warnings).toEqual([NICK_WARNING]);
    expect(dry.out).toEqual([`would write ${MIGRATIONS}/0002_schema.sql:`, "  rebuild table users (column-changed)", NICK_WARNING]);
  });

  it("throws the diff's refusals, which no migration can express", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES_WITH_AUTHOR]) });
    wire(io, { baseline: [USERS, NOTES], desired: [USERS, NOTES_WITH_AUTHOR] });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      "notes.author is NOT NULL with no DEFAULT on a table that already exists — give it a DEFAULT, or add it in a `--custom` migration that fills it",
    );
  });

  it("numbers the next file above every one already in the migrations directory", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0002_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    expect((await composeMigration(run, OPTIONS)).path).toBe(`${MIGRATIONS}/0003_schema.sql`);
  });

  it("writes no file when the proof's post-apply schema is not the desired one", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES], after: [USERS] });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      "the composed migration does not produce the declared schema — this is a forge bug, and the file was not written:\n  table notes: in the declared schema, not in after the migration",
    );
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.files.has(SNAPSHOT)).toBe(false);
  });

  it("refuses a --rename whose from is not in the baseline", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    await expect(composeMigration(run, { ...OPTIONS, renames: ["ghost:phantom"] })).rejects.toThrow(
      "--rename ghost:phantom names no table `ghost` in the baseline — already renamed, so drop the flag",
    );
  });

  it("reads neither scratch database again when nothing about the inputs changed", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    await composeMigration(run, OPTIONS);
    const first = pragmaReads(io);
    await composeMigration(run, OPTIONS);

    expect(first).toBeGreaterThan(0);
    expect(pragmaReads(io)).toBe(first);
  });

  it("replays into the scratch database again when --no-cache says so", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    await composeMigration(run, { ...OPTIONS, cache: false });
    const first = pragmaReads(io);
    await composeMigration(run, { ...OPTIONS, cache: false });

    expect(pragmaReads(io)).toBe(first * 2);
  });
});

describe("await composeMigration() — the union of every declared schema", () => {
  const LIB = "node_modules/acme-lib/schema.sql";
  const HOST = { schemas: [LIB, "schema.sql"] };
  const libFiles = (libSchema: string): Record<string, string> => ({ [`${ROOT}/${LIB}`]: libSchema });

  it("composes a library's table into the app's own directory, because the app owns every file that runs", async () => {
    const { run, io } = context(libFiles(schemaText([USERS])), HOST);
    wire(io, { baseline: [], desired: [USERS] });

    const outcome = await composeMigration(run, OPTIONS);

    expect(outcome.path).toBe(`${MIGRATIONS}/0001_schema.sql`);
    expect(outcome.plan).toEqual(["create table users"]);
  });

  it("reads nothing a dependency ships that config/db.ts does not name", async () => {
    const { run, io } = context(libFiles(schemaText([USERS])), { schemas: ["schema.sql"] });
    wire(io, { baseline: [], desired: [] });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow("config/db.ts names no `schemas`");
  });

  it("records every declared schema's digest in the snapshot and the stamp, keyed by the path config names", async () => {
    const libText = schemaText([USERS]);
    const { run, io } = context({ ...libFiles(libText), [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([NOTES]) }, HOST);
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    await composeMigration(run, OPTIONS);

    const digests = { [LIB]: sha256(libText), "schema.sql": sha256(schemaText([NOTES])) };
    expect(JSON.parse(io.files.get(SNAPSHOT) ?? "{}").desired).toEqual(digests);
    expect(parseMigrationHeader(io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "").stamp?.desired).toEqual(digests);
  });
});

describe("await composeMigration() — a drop whose declaring file config/db.ts no longer names", () => {
  const LIB = "node_modules/acme-lib/schema.sql";
  const POSTS: Shape = {
    name: "posts",
    columns: [
      ["id", "INTEGER PRIMARY KEY"],
      ["title", "TEXT"],
    ],
  };
  const DROPS_POSTS: SchemaDiff = {
    tables: [{ kind: "drop", name: "posts" }],
    indexes: NO_NAMED,
    triggers: NO_NAMED,
    views: NO_NAMED,
    destructive: [],
    refusals: [],
    dataDependent: [],
    dropDependents: [],
  };
  const CAUSE = `posts was declared by ${LIB}, which config/db.ts no longer declares or whose file is absent — nothing declares it now`;

  const files = (declared: Record<string, string[]>): Record<string, string> => ({
    [`${MIGRATIONS}/0001_init.sql`]: INIT,
    [SCHEMA]: schemaText([USERS]),
    [SNAPSHOT]: formatSchemaSnapshot(
      buildSchemaSnapshot({
        desired: { "schema.sql": sha256(schemaText([USERS])) },
        declared,
        migrationsDigest: migrationsDigest([{ name: "0001_init", sha256: migrationChecksum(INIT) }]),
      }),
    ),
  });
  const DEPARTED = { [LIB]: ["posts"], "schema.sql": ["users"] };
  const DELETED = { "schema.sql": ["users", "posts"] };

  it("refuses the drop naming the file that declared it, and digests the plan with that reason", async () => {
    const { run, io, out } = context(files(DEPARTED));
    wire(io, { baseline: [USERS, POSTS], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_POSTS, [CAUSE]);

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      `the change discards data:\n  posts: drops the table\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
    );
    expect(out).toEqual(["  drop table posts", CAUSE]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("digests the same drop differently when the file that declared it is still declared", async () => {
    const { run, io, out } = context(files(DELETED));
    wire(io, { baseline: [USERS, POSTS], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_POSTS);

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(`pass --allow-destructive ${digest} to compose exactly this plan.`);
    expect(digest).not.toBe(destructivePlanDigest(DROPS_POSTS, [CAUSE]));
    expect(out).toEqual(["  drop table posts"]);
  });

  it("composes the drop under that plan's digest, printing the reason, and remembers only the surviving file's names", async () => {
    const { run, io, out } = context(files(DEPARTED));
    wire(io, { baseline: [USERS, POSTS], desired: [USERS], after: [USERS] });

    const outcome = await composeMigration(run, { ...OPTIONS, allowDestructive: destructivePlanDigest(DROPS_POSTS, [CAUSE]) });

    expect(outcome.path).toBe(`${MIGRATIONS}/0002_schema.sql`);
    expect(outcome.causes).toEqual([CAUSE]);
    expect(out).toEqual([`wrote ${MIGRATIONS}/0002_schema.sql`, "  drop table posts", CAUSE]);
    expect(JSON.parse(io.files.get(SNAPSHOT) ?? "{}").declared).toEqual({ "schema.sql": ["users"] });
  });

  it("says so once when the departed file declared nothing this compose drops", async () => {
    const { run, io, out } = context(files({ [LIB]: ["archived"], "schema.sql": ["users"] }));
    wire(io, { baseline: [USERS], desired: [USERS] });

    const outcome = await composeMigration(run, OPTIONS);

    const warning = `warning: ${LIB} is in ${SNAPSHOT} and config/db.ts no longer declares it`;
    expect(outcome.causes).toEqual([]);
    expect(outcome.warnings).toEqual([warning]);
    expect(out).toEqual([`no changes — ${MIGRATIONS} already produces every declared schema`, warning]);
    expect(JSON.parse(io.files.get(SNAPSHOT) ?? "{}").declared).toEqual({ "schema.sql": ["users"] });
  });
});

describe("await composeMigration() --restamp", () => {
  const NEXT_BODY = `PRAGMA defer_foreign_keys = true;\n\n${ddl(NOTES)};\n`;
  const THIRD_BODY = `PRAGMA defer_foreign_keys = true;\n\nCREATE TABLE tags (id INTEGER PRIMARY KEY) STRICT;\n`;
  const desiredText = schemaText([USERS, NOTES]);
  const generated = (body: string, baseline: string) =>
    `${formatComposeHeader({ desired: { "schema.sql": "old" }, baseline, forge: "0.0.1" }, body)}${body}`;
  const snapshotText = (migrationsDigestValue: string) =>
    formatSchemaSnapshot(buildSchemaSnapshot({ desired: { "schema.sql": "old" }, declared: {}, migrationsDigest: migrationsDigestValue }));
  const restamp = (name: string, dryRun = false): ComposeOptions => ({ ...OPTIONS, restamp: name, dryRun });

  it("rewrites only the stamp line of the named migration, to the history now on disk, with no wrangler call", async () => {
    const wrong = generated(NEXT_BODY, "wrong");
    const { run, io, out } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_schema.sql`]: wrong,
      [SCHEMA]: desiredText,
      [SNAPSHOT]: snapshotText("stale"),
    });

    const outcome = await composeMigration(run, restamp("0002_schema"));

    const written = io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "";
    const header = parseMigrationHeader(written);
    expect(header.body).toBe(NEXT_BODY);
    expect(header.stamp).toEqual({
      desired: { "schema.sql": sha256(desiredText) },
      baseline: migrationsDigest([{ name: "0001_init", sha256: migrationChecksum(INIT) }]),
      body: sha256(header.covered),
      forge: "unknown",
    });
    expect(written.split("\n").slice(2).join("\n")).toBe(wrong.split("\n").slice(2).join("\n"));
    expect(io.calls).toEqual([]);
    expect(outcome).toEqual({
      path: `${MIGRATIONS}/0002_schema.sql`,
      snapshotPath: null,
      plan: ["restamped 0002_schema"],
      warnings: [],
      causes: [],
      sql: written,
      dryRun: false,
    });
    expect(out).toEqual(["restamped 0002_schema"]);
  });

  it("moves no checksum: the rewritten file has the sha256 and migrations digest it had before", async () => {
    const wrong = generated(NEXT_BODY, "wrong");
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong, [SCHEMA]: desiredText });
    const before = migrationsDigest([
      { name: "0001_init", sha256: migrationChecksum(INIT) },
      { name: "0002_schema", sha256: migrationChecksum(wrong) },
    ]);

    await composeMigration(run, restamp("0002_schema"));

    const written = io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "";
    expect(written).not.toBe(wrong);
    expect(migrationChecksum(written)).toBe(migrationChecksum(wrong));
    expect(
      migrationsDigest([
        { name: "0001_init", sha256: migrationChecksum(INIT) },
        { name: "0002_schema", sha256: migrationChecksum(written) },
      ]),
    ).toBe(before);
  });

  it("leaves the snapshot and every later migration byte-identical, since no digest they carry has moved", async () => {
    const third = generated(THIRD_BODY, "also-wrong");
    const snapshot = snapshotText("stale");
    const { run, io } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_schema.sql`]: generated(NEXT_BODY, "wrong"),
      [`${MIGRATIONS}/0003_schema.sql`]: third,
      [SCHEMA]: desiredText,
      [SNAPSHOT]: snapshot,
    });

    const outcome = await composeMigration(run, restamp("0002_schema"));

    expect(outcome.plan).toEqual(["restamped 0002_schema"]);
    expect(outcome.snapshotPath).toBe(null);
    expect(io.files.get(`${MIGRATIONS}/0003_schema.sql`)).toBe(third);
    expect(io.files.get(SNAPSHOT)).toBe(snapshot);
  });

  it("writes nothing under --dry-run and hands back the stamp it would write", async () => {
    const wrong = generated(NEXT_BODY, "wrong");
    const { run, io, out } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_schema.sql`]: wrong,
      [SCHEMA]: desiredText,
      [SNAPSHOT]: snapshotText("stale"),
    });

    const outcome = await composeMigration(run, restamp("0002_schema", true));

    expect(io.files.get(`${MIGRATIONS}/0002_schema.sql`)).toBe(wrong);
    expect(io.files.get(SNAPSHOT)).toBe(snapshotText("stale"));
    expect(outcome.path).toBe(null);
    expect(outcome.dryRun).toBe(true);
    expect(parseMigrationHeader(outcome.sql).stamp?.baseline).toBe(migrationsDigest([{ name: "0001_init", sha256: migrationChecksum(INIT) }]));
    expect(out).toEqual(["would have restamped 0002_schema"]);
  });

  it("refuses an unstamped migration, a custom one, an edited body, and an unknown name", async () => {
    const edited = `${generated(NEXT_BODY, "wrong")}-- edited\n`;
    const files = {
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_custom.sql`]: `${formatCustomHeader()}INSERT INTO users (email) VALUES ('x');\n`,
      [`${MIGRATIONS}/0003_edited.sql`]: edited,
      [SCHEMA]: desiredText,
    };
    const { run, io } = context(files);

    await expect(composeMigration(run, restamp("0001_init"))).rejects.toThrow(
      "0001_init is a custom migration with no compose stamp — only a generated migration can be restamped",
    );
    await expect(composeMigration(run, restamp("0002_custom"))).rejects.toThrow(
      "0002_custom is a custom migration with no compose stamp — only a generated migration can be restamped",
    );
    await expect(composeMigration(run, restamp("0003_edited"))).rejects.toThrow(
      "0003_edited was edited since it was composed — restamp would certify an unproven file; compose again instead",
    );
    await expect(composeMigration(run, restamp("0004_nope"))).rejects.toThrow(
      "--restamp 0004_nope names no migration — on disk: 0001_init, 0002_custom, 0003_edited",
    );
    expect(io.files.get(`${MIGRATIONS}/0003_edited.sql`)).toBe(edited);
    expect(io.calls).toEqual([]);
  });
});
