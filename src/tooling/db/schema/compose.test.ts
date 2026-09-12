import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { sha256 } from "../digest";
import { appHome } from "../home";
import { migrationChecksum, migrationsDigest } from "../migrate/files";
import { argvHas, fakeDbIo, OK, schemaModelReply } from "../test-support";
import type { DbConfig, DbHostConfig, DbRunContext, FakeDbIo, Spawned } from "../types";
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
    entry: {
      binding: "DB",
      databaseName: "app-db",
      databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      previewDatabaseId: null,
      migrationsDir: MIGRATIONS,
      migrationsTable: "d1_migrations",
    },
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

function introspect(shapes: readonly Shape[], extra: Unowned = {}): (args: readonly string[]) => Spawned {
  return () => {
    const rows = shapeRows(shapes);
    return schemaModelReply({
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
  let proved = false;
  io.rules.push(
    { match: (a) => argvHas(a, "--version"), reply: { code: 0, stdout: "4.0.0\n", stderr: "" } },
    { match: (a) => argvHas(a, "migrations", "apply"), reply: OK },
    {
      match: (a) => argvHas(a, "execute", "--file"),
      reply: (a) => {
        if ((a.at(-1) ?? "").endsWith("proof.sql")) proved = true;
        return OK;
      },
    },
    {
      match: (a) => argvHas(a, "--persist-to", BASELINE_STATE, "--json", "--command"),
      reply: (a) =>
        proved
          ? introspect(sides.after ?? sides.desired)(a)
          : introspect(sides.baseline, { inventory: sides.baselineExtra, columns: sides.baselineColumns, foreignKeys: sides.baselineForeignKeys })(
              a,
            ),
    },
    { match: (a) => argvHas(a, "--persist-to", DESIRED_STATE, "--json", "--command"), reply: introspect(sides.desired) },
  );
}

const pragmaReads = (io: FakeDbIo) => io.calls.filter((call) => (call.at(-1) ?? "").includes("pragma_")).length;

describe("composeMigration()", () => {
  it("refuses to compose when config/db.ts names no schema on disk, pointing at the pull that bootstraps one", () => {
    const { run } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    expect(() => composeMigration(run, OPTIONS)).toThrow("config/db.ts names no `schemas`");
  });

  it("writes a named custom migration with the custom header and nothing else", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    const outcome = composeMigration(run, { ...OPTIONS, custom: true, name: "backfill emails" });

    expect(outcome.path).toBe(`${MIGRATIONS}/0002_backfill_emails.sql`);
    expect(outcome.plan).toEqual(["custom migration 0002_backfill_emails.sql"]);
    expect(io.files.get(`${MIGRATIONS}/0002_backfill_emails.sql`)).toBe(`${formatCustomHeader()}\n`);
    expect(io.calls).toEqual([]);
  });

  it("refuses a custom migration with no name", () => {
    const { run } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    expect(() => composeMigration(run, { ...OPTIONS, custom: true })).toThrow(
      "a custom migration needs a name — `forge db migrate compose --custom <name>`",
    );
  });

  it("writes the snapshot and no migration when the migrations already produce the desired state", () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    const outcome = composeMigration(run, OPTIONS);

    expect(outcome.path).toBe(null);
    expect(outcome.snapshotPath).toBe(SNAPSHOT);
    expect(outcome.plan).toEqual([]);
    expect(out).toEqual([`no changes — ${MIGRATIONS} already produces every declared schema`]);
    const snapshot = JSON.parse(io.files.get(SNAPSHOT) ?? "{}");
    expect(snapshot.desired).toEqual({ "schema.sql": sha256(schemaText([USERS])) });
    expect(snapshot.migrationsDigest).toBe(migrationsDigest([{ name: "0001_init", sql: INIT }]));
  });

  it("refuses a declared object in a reserved space, naming the file, the object and the prefixes", () => {
    const reserved: Shape = { name: "forge_audit", columns: [["id", "INTEGER PRIMARY KEY"]] };
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, reserved]) });

    expect(() => composeMigration(run, OPTIONS)).toThrow(
      "schema.sql declares table `forge_audit`\n`forge_`, `sqlite_`, `_cf_` are reserved for forge, SQLite and the platform, and `d1_migrations` is the migrations table — rename it, or drop it from the schema.",
    );
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.calls).toEqual([]);
  });

  it("refuses a declared object named as the migrations table itself", () => {
    const clash: Shape = { name: "d1_migrations", columns: [["id", "INTEGER PRIMARY KEY"]] };
    const { run } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([clash]) });

    expect(() => composeMigration(run, OPTIONS)).toThrow("schema.sql declares table `d1_migrations`");
  });

  it("writes the numbered migration, its compose header and the snapshot for a created table", () => {
    const desiredText = schemaText([USERS, NOTES]);
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: desiredText });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    const outcome = composeMigration(run, OPTIONS);

    const path = `${MIGRATIONS}/0002_schema.sql`;
    expect(outcome.path).toBe(path);
    expect(outcome.plan).toEqual(["create table notes"]);
    expect(out).toEqual([`wrote ${path}`, "  create table notes"]);

    const written = io.files.get(path) ?? "";
    const header = parseMigrationHeader(written);
    expect(header.origin).toBe("generated");
    expect(header.stamp).toEqual({
      desired: { "schema.sql": sha256(desiredText) },
      baseline: migrationsDigest([{ name: "0001_init", sql: INIT }]),
      body: sha256(header.covered),
      forge: "unknown",
    });
    expect(header.body).toBe(`PRAGMA defer_foreign_keys = true;\n\n${ddl(NOTES)};\n`);

    const snapshot = JSON.parse(io.files.get(SNAPSHOT) ?? "{}");
    expect(snapshot.migrationsDigest).toBe(
      migrationsDigest([
        { name: "0001_init", sql: INIT },
        { name: "0002_schema", sql: written },
      ]),
    );
  });

  it("writes nothing under --dry-run and hands back the SQL it would have written", () => {
    const { run, io, out } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    const outcome = composeMigration(run, { ...OPTIONS, dryRun: true });

    expect(outcome.path).toBe(null);
    expect(outcome.snapshotPath).toBe(null);
    expect(outcome.dryRun).toBe(true);
    expect(parseMigrationHeader(outcome.sql).body).toBe(`PRAGMA defer_foreign_keys = true;\n\n${ddl(NOTES)};\n`);
    expect(out).toEqual([`would write ${MIGRATIONS}/0002_schema.sql:`, "  create table notes"]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.files.has(SNAPSHOT)).toBe(false);
  });

  it("refuses a diff that discards data, printing the digest of the drop set", () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const refused = context(files);
    wire(refused.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_NICKNAME);

    expect(() => composeMigration(refused.run, OPTIONS)).toThrow(
      `the change discards data:\n  users: drops column nickname\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
    );
    expect(refused.out).toEqual(["  drop column users.nickname"]);
    expect(refused.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("composes the drop once --allow-destructive carries that plan's digest", () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const allowed = context(files);
    wire(allowed.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS], after: [USERS] });

    const outcome = composeMigration(allowed.run, { ...OPTIONS, allowDestructive: destructivePlanDigest(DROPS_NICKNAME) });

    expect(outcome.path).toBe(`${MIGRATIONS}/0002_schema.sql`);
    expect(allowed.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(true);
  });

  it("refuses a stale digest, naming the drop set as it now stands", () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const stale = context(files);
    wire(stale.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_NICKNAME);

    expect(() => composeMigration(stale.run, { ...OPTIONS, allowDestructive: "000000000000" })).toThrow(
      `--allow-destructive 000000000000 is not the plan you approved — the destructive set is now (${digest}):\n  users: drops column nickname\nRead it again, then pass --allow-destructive ${digest}.`,
    );
    expect(stale.out).toEqual(["  drop column users.nickname"]);
    expect(stale.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("warns, with the plan, when a rebuild depends on the rows already there", () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS_NICK_REQUIRED]) };
    const { run, io, out } = context(files);
    wire(io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED], after: [USERS_NICK_REQUIRED] });

    const outcome = composeMigration(run, OPTIONS);

    expect(outcome.warnings).toEqual([NICK_WARNING]);
    expect(out).toEqual([`wrote ${MIGRATIONS}/0002_schema.sql`, "  rebuild table users (column-changed)", NICK_WARNING]);
    expect(io.logs).toEqual([]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(true);
  });

  it("sends the rebuild warning to the log under --json, and prints it last under --dry-run", () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS_NICK_REQUIRED]) };
    const json = context(files);
    wire(json.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED], after: [USERS_NICK_REQUIRED] });

    expect(composeMigration({ ...json.run, json: true }, OPTIONS).warnings).toEqual([NICK_WARNING]);
    expect(json.out).toEqual([]);
    expect(json.io.logs).toEqual([NICK_WARNING]);

    const dry = context(files);
    wire(dry.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED] });

    expect(composeMigration(dry.run, { ...OPTIONS, dryRun: true }).warnings).toEqual([NICK_WARNING]);
    expect(dry.out).toEqual([`would write ${MIGRATIONS}/0002_schema.sql:`, "  rebuild table users (column-changed)", NICK_WARNING]);
  });

  it("throws the diff's refusals, which no migration can express", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES_WITH_AUTHOR]) });
    wire(io, { baseline: [USERS, NOTES], desired: [USERS, NOTES_WITH_AUTHOR] });

    expect(() => composeMigration(run, OPTIONS)).toThrow(
      "notes.author is NOT NULL with no DEFAULT on a table that already exists — give it a DEFAULT, or add it in a `--custom` migration that fills it",
    );
  });

  it("numbers the next file above every one already in the migrations directory", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0002_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    expect(composeMigration(run, OPTIONS).path).toBe(`${MIGRATIONS}/0003_schema.sql`);
  });

  it("writes no file when the proof's post-apply schema is not the desired one", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES], after: [USERS] });

    expect(() => composeMigration(run, OPTIONS)).toThrow(
      "the composed migration does not produce the declared schema — this is a forge bug, and the file was not written:\n  table notes: in the declared schema, not in after the migration",
    );
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.files.has(SNAPSHOT)).toBe(false);
  });

  it("refuses a --rename whose from is not in the baseline", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    expect(() => composeMigration(run, { ...OPTIONS, renames: ["ghost:phantom"] })).toThrow(
      "--rename ghost:phantom names no table `ghost` in the baseline — already renamed, so drop the flag",
    );
  });

  it("reads neither scratch database again when nothing about the inputs changed", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    composeMigration(run, OPTIONS);
    const first = pragmaReads(io);
    composeMigration(run, OPTIONS);

    expect(first).toBeGreaterThan(0);
    expect(pragmaReads(io)).toBe(first);
  });

  it("replays into the scratch database again when --no-cache says so", () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) });
    wire(io, { baseline: [USERS], desired: [USERS] });

    composeMigration(run, { ...OPTIONS, cache: false });
    const first = pragmaReads(io);
    composeMigration(run, { ...OPTIONS, cache: false });

    expect(pragmaReads(io)).toBe(first * 2);
  });
});

describe("composeMigration() — the union of every declared schema", () => {
  const LIB = "node_modules/acme-lib/schema.sql";
  const HOST = { schemas: [LIB, "schema.sql"] };
  const libFiles = (libSchema: string): Record<string, string> => ({ [`${ROOT}/${LIB}`]: libSchema });

  it("composes a library's table into the app's own directory, because the app owns every file that runs", () => {
    const { run, io } = context(libFiles(schemaText([USERS])), HOST);
    wire(io, { baseline: [], desired: [USERS] });

    const outcome = composeMigration(run, OPTIONS);

    expect(outcome.path).toBe(`${MIGRATIONS}/0001_schema.sql`);
    expect(outcome.plan).toEqual(["create table users"]);
  });

  it("reads nothing a dependency ships that config/db.ts does not name", () => {
    const { run, io } = context(libFiles(schemaText([USERS])), { schemas: ["schema.sql"] });
    wire(io, { baseline: [], desired: [] });

    expect(() => composeMigration(run, OPTIONS)).toThrow("config/db.ts names no `schemas`");
  });

  it("records every declared schema's digest in the snapshot and the stamp, keyed by the path config names", () => {
    const libText = schemaText([USERS]);
    const { run, io } = context({ ...libFiles(libText), [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([NOTES]) }, HOST);
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    composeMigration(run, OPTIONS);

    const digests = { [LIB]: sha256(libText), "schema.sql": sha256(schemaText([NOTES])) };
    expect(JSON.parse(io.files.get(SNAPSHOT) ?? "{}").desired).toEqual(digests);
    expect(parseMigrationHeader(io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "").stamp?.desired).toEqual(digests);
  });
});

describe("composeMigration() --restamp", () => {
  const NEXT_BODY = `PRAGMA defer_foreign_keys = true;\n\n${ddl(NOTES)};\n`;
  const THIRD_BODY = `PRAGMA defer_foreign_keys = true;\n\nCREATE TABLE tags (id INTEGER PRIMARY KEY) STRICT;\n`;
  const desiredText = schemaText([USERS, NOTES]);
  const generated = (body: string, baseline: string) =>
    `${formatComposeHeader({ desired: { "schema.sql": "old" }, baseline, forge: "0.0.1" }, body)}${body}`;
  const snapshotText = (migrationsDigestValue: string) =>
    formatSchemaSnapshot(buildSchemaSnapshot({ desired: { "schema.sql": "old" }, migrationsDigest: migrationsDigestValue }));
  const restamp = (name: string, dryRun = false): ComposeOptions => ({ ...OPTIONS, restamp: name, dryRun });

  it("rewrites only the stamp line of the named migration, to the history now on disk, with no wrangler call", () => {
    const wrong = generated(NEXT_BODY, "wrong");
    const { run, io, out } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_schema.sql`]: wrong,
      [SCHEMA]: desiredText,
      [SNAPSHOT]: snapshotText("stale"),
    });

    const outcome = composeMigration(run, restamp("0002_schema"));

    const written = io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "";
    const header = parseMigrationHeader(written);
    expect(header.body).toBe(NEXT_BODY);
    expect(header.stamp).toEqual({
      desired: { "schema.sql": sha256(desiredText) },
      baseline: migrationsDigest([{ name: "0001_init", sql: INIT }]),
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
      sql: written,
      dryRun: false,
    });
    expect(out).toEqual(["restamped 0002_schema"]);
  });

  it("moves no checksum: the rewritten file has the sha256 and migrations digest it had before", () => {
    const wrong = generated(NEXT_BODY, "wrong");
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_schema.sql`]: wrong, [SCHEMA]: desiredText });
    const before = migrationsDigest([
      { name: "0001_init", sql: INIT },
      { name: "0002_schema", sql: wrong },
    ]);

    composeMigration(run, restamp("0002_schema"));

    const written = io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "";
    expect(written).not.toBe(wrong);
    expect(migrationChecksum(written)).toBe(migrationChecksum(wrong));
    expect(
      migrationsDigest([
        { name: "0001_init", sql: INIT },
        { name: "0002_schema", sql: written },
      ]),
    ).toBe(before);
  });

  it("leaves the snapshot and every later migration byte-identical, since no digest they carry has moved", () => {
    const third = generated(THIRD_BODY, "also-wrong");
    const snapshot = snapshotText("stale");
    const { run, io } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_schema.sql`]: generated(NEXT_BODY, "wrong"),
      [`${MIGRATIONS}/0003_schema.sql`]: third,
      [SCHEMA]: desiredText,
      [SNAPSHOT]: snapshot,
    });

    const outcome = composeMigration(run, restamp("0002_schema"));

    expect(outcome.plan).toEqual(["restamped 0002_schema"]);
    expect(outcome.snapshotPath).toBe(null);
    expect(io.files.get(`${MIGRATIONS}/0003_schema.sql`)).toBe(third);
    expect(io.files.get(SNAPSHOT)).toBe(snapshot);
  });

  it("writes nothing under --dry-run and hands back the stamp it would write", () => {
    const wrong = generated(NEXT_BODY, "wrong");
    const { run, io, out } = context({
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_schema.sql`]: wrong,
      [SCHEMA]: desiredText,
      [SNAPSHOT]: snapshotText("stale"),
    });

    const outcome = composeMigration(run, restamp("0002_schema", true));

    expect(io.files.get(`${MIGRATIONS}/0002_schema.sql`)).toBe(wrong);
    expect(io.files.get(SNAPSHOT)).toBe(snapshotText("stale"));
    expect(outcome.path).toBe(null);
    expect(outcome.dryRun).toBe(true);
    expect(parseMigrationHeader(outcome.sql).stamp?.baseline).toBe(migrationsDigest([{ name: "0001_init", sql: INIT }]));
    expect(out).toEqual(["would have restamped 0002_schema"]);
  });

  it("refuses an unstamped migration, a custom one, an edited body, and an unknown name", () => {
    const edited = `${generated(NEXT_BODY, "wrong")}-- edited\n`;
    const files = {
      [`${MIGRATIONS}/0001_init.sql`]: INIT,
      [`${MIGRATIONS}/0002_custom.sql`]: `${formatCustomHeader()}INSERT INTO users (email) VALUES ('x');\n`,
      [`${MIGRATIONS}/0003_edited.sql`]: edited,
      [SCHEMA]: desiredText,
    };
    const { run, io } = context(files);

    expect(() => composeMigration(run, restamp("0001_init"))).toThrow(
      "0001_init is a custom migration with no compose stamp — only a generated migration can be restamped",
    );
    expect(() => composeMigration(run, restamp("0002_custom"))).toThrow(
      "0002_custom is a custom migration with no compose stamp — only a generated migration can be restamped",
    );
    expect(() => composeMigration(run, restamp("0003_edited"))).toThrow(
      "0003_edited was edited since it was composed — restamp would certify an unproven file; compose again instead",
    );
    expect(() => composeMigration(run, restamp("0004_nope"))).toThrow(
      "--restamp 0004_nope names no migration — on disk: 0001_init, 0002_custom, 0003_edited",
    );
    expect(io.files.get(`${MIGRATIONS}/0003_edited.sql`)).toBe(edited);
    expect(io.calls).toEqual([]);
  });
});
