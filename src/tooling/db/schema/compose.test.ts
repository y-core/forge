import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { PLAIN } from "../../term/color";
import { argvHas, fakeDbIo, schemaModelRows } from "../db.fixture";
import { sha256 } from "../digest";
import { appHome } from "../home";
import { refuseUncomposed } from "../migrate/apply";
import { discoverMigrations, migrationChecksum, migrationsDigest } from "../migrate/files";
import { lintMigration } from "../migrate/lint";
import type { DbConfig, DbHostConfig, DbRunContext, FakeDbIo } from "../types";
import { composeMigration, refuseWideTables } from "./compose";
import { destructivePlanDigest } from "./diff";
import { formatComposeHeader, parseMigrationHeader } from "./header";
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

const NICKNAME_LINE = '-- forge:drops column "users"."nickname"';
const NICKNAME_DIGEST = destructivePlanDigest(DROPS_NICKNAME, [], [NICKNAME_LINE]);

const ROOT = "/app";
const MIGRATIONS = `${ROOT}/config/db/migrations`;
const SCHEMA = `${ROOT}/schema.sql`;
const SNAPSHOT = `${ROOT}/config/db/schema.snapshot.json`;
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

const OPTIONS: ComposeOptions = { dryRun: false, renames: [], cache: true };

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
    renamed?: readonly Shape[];
    seedRefusal?: Error;
    lost?: Lost;
  },
): void {
  io.rules.push({ match: (a) => argvHas(a, "--version"), reply: { code: 0, stdout: "4.0.0\n", stderr: "" } });
  const ran = (file: string) => io.d1Calls.some((call) => call.source?.endsWith(file) === true);
  const seeding = () => io.d1Calls.at(-1)?.source?.endsWith("seed.sql") === true;
  io.d1Rules.push({
    match: (statement, home) => home.persistTo === BASELINE_STATE && seeding() && statement.startsWith("INSERT"),
    reply: () => {
      if (sides.seedRefusal !== undefined) throw sides.seedRefusal;
      return [];
    },
  });
  io.d1Rules.push({
    match: (statement, home) =>
      home.persistTo === BASELINE_STATE && (statement.startsWith("SELECT quote(") || statement.startsWith('SELECT NULL AS "row"')),
    reply: (statement) => survivalReply(statement, ran("proof.sql") ? (sides.lost ?? {}) : {}),
  });
  io.d1Rules.push({
    match: (_statement, home) => home.persistTo === BASELINE_STATE,
    reply: (statement) => {
      if (ran("proof.sql")) return introspect(sides.after ?? sides.desired)(statement);
      if (sides.renamed !== undefined && ran("renames.sql")) return introspect(sides.renamed)(statement);
      return introspect(sides.baseline, { inventory: sides.baselineExtra, columns: sides.baselineColumns, foreignKeys: sides.baselineForeignKeys })(
        statement,
      );
    },
  });
  io.d1Rules.push({ match: (_statement, home) => home.persistTo === DESIRED_STATE, reply: introspect(sides.desired) });
}

/** Each seeded value the migration lost, as `quote()` reads it after the proof, by table and column; every other value reads `'forge-seed'` before and after. */
type Lost = Readonly<Record<string, Readonly<Record<string, string>>>>;

function survivalReply(statement: string, lost: Lost): Record<string, unknown>[] {
  const table = (/FROM "((?:[^"]|"")+)"$/.exec(statement)?.[1] ?? "").replaceAll('""', '"');
  return [
    Object.fromEntries(
      [...statement.matchAll(/ AS "((?:[^"]|"")+)"/g)].map(([, quoted = ""]) => {
        const column = quoted.replaceAll('""', '"');
        return [column, lost[table]?.[column] ?? "'forge-seed'"];
      }),
    ),
  ];
}

const seedStatements = (io: FakeDbIo) =>
  io.d1Calls.filter((call) => call.source?.endsWith("/seed.sql") === true).flatMap((call) => call.statements);

const pragmaReads = (io: FakeDbIo) => io.d1Calls.flatMap((call) => call.statements).filter((statement) => statement.includes("pragma_")).length;

describe("composeMigration()", () => {
  it("refuses to compose when a declared schema's file is missing, naming it", async () => {
    const { run } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      new CliError("invalid-args", "schema.sql is declared in config/db.ts and no file is there to read"),
    );
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
      '  export default { schemas: [forgeSchema("auth"), "config/db/schema.sql"] } satisfies DbHostConfig;\n' +
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
    expect(lintMigration(path, written)).toEqual([]);
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

  it("refuses a column added to a 100-column table, which D1 would refuse at apply, and writes nothing", async () => {
    const wide = (n: number): Shape => ({
      name: "wide",
      columns: [["id", "INTEGER PRIMARY KEY"], ...Array.from({ length: n - 1 }, (_, i): [string, string] => [`c${i}`, "TEXT"])],
    });
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, wide(101)]) });
    wire(io, { baseline: [USERS, wide(100)], desired: [USERS, wide(101)] });
    const written = () => [...io.files.keys()].filter((path) => path.startsWith(`${MIGRATIONS}/0002`));

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      "wide declares 101 columns — D1 refuses a table of more than 100, so nothing was composed; split it into tables joined on its key",
    );
    expect(written()).toEqual([]);
  });

  it("composes a table of exactly 100 columns", () => {
    expect(() =>
      refuseWideTables({ tables: [{ name: "t", columns: Array.from({ length: 100 }) }], indexes: [], triggers: [], views: [] } as never),
    ).not.toThrow();
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

  it("refuses a diff that discards data, printing the digest of the plan and the line it would write", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const refused = context(files);
    wire(refused.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS] });

    await expect(composeMigration(refused.run, OPTIONS)).rejects.toThrow(
      `the change discards data:\n  users: drops column nickname\nthe migration carries one approval line per drop and rename:\n  ${NICKNAME_LINE}\nRead the plan above, then pass --allow-destructive ${NICKNAME_DIGEST} to compose exactly this plan.`,
    );
    expect(refused.out).toEqual(["  drop column users.nickname"]);
    expect(refused.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("composes the drop once --allow-destructive carries that plan's digest, writing its line directly under the stamp", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const allowed = context(files);
    wire(allowed.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS], after: [USERS] });

    const outcome = await composeMigration(allowed.run, { ...OPTIONS, allowDestructive: NICKNAME_DIGEST });

    const path = `${MIGRATIONS}/0002_schema.sql`;
    const written = allowed.io.files.get(path) ?? "";
    expect(outcome.path).toBe(path);
    expect(parseMigrationHeader(written).body.startsWith(`${NICKNAME_LINE}\nPRAGMA defer_foreign_keys = true;\n`)).toBe(true);
    expect(lintMigration(path, written).filter((finding) => finding.rule === "generated-edited")).toEqual([]);
  });

  it("writes one approval line per dropped object when the plan drops a table and a column together", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const refused = context(files);
    wire(refused.io, { baseline: [USERS_WITH_NICKNAME, NOTES], desired: [USERS] });
    const refusal = await composeMigration(refused.run, OPTIONS).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : ""),
    );
    const digest = /--allow-destructive ([0-9a-f]{12})/.exec(refusal)?.[1];
    const allowed = context(files);
    wire(allowed.io, { baseline: [USERS_WITH_NICKNAME, NOTES], desired: [USERS], after: [USERS] });

    await composeMigration(allowed.run, { ...OPTIONS, allowDestructive: digest ?? "" });

    const path = `${MIGRATIONS}/0002_schema.sql`;
    const written = allowed.io.files.get(path) ?? "";
    const { body } = parseMigrationHeader(written);
    const lines = body.split("\n");
    const head = lines.slice(
      0,
      lines.findIndex((line) => !line.startsWith("-- forge:")),
    );
    expect(head.toSorted()).toEqual(['-- forge:drops column "users"."nickname"', '-- forge:drops table "notes"']);
    expect(lintMigration(path, written).filter((finding) => finding.rule === "generated-edited")).toEqual([]);
  });

  it("refuses a stale digest, naming the plan as it now stands", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const stale = context(files);
    wire(stale.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS] });

    await expect(composeMigration(stale.run, { ...OPTIONS, allowDestructive: "000000000000" })).rejects.toThrow(
      `--allow-destructive 000000000000 is not the plan you approved — the plan is now (${NICKNAME_DIGEST}):\nthe change discards data:\n  users: drops column nickname\nthe migration carries one approval line per drop and rename:\n  ${NICKNAME_LINE}\nRead it again, then pass --allow-destructive ${NICKNAME_DIGEST}.`,
    );
    expect(stale.out).toEqual(["  drop column users.nickname"]);
    expect(stale.io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("refuses a hand-added approval line under the stamp: lint reports generated-edited and apply refuses the file", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const allowed = context(files);
    wire(allowed.io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS], after: [USERS] });
    await composeMigration(allowed.run, { ...OPTIONS, allowDestructive: NICKNAME_DIGEST });
    const path = `${MIGRATIONS}/0002_schema.sql`;
    const written = allowed.io.files.get(path) ?? "";
    const { body } = parseMigrationHeader(written);
    const edited = `${written.slice(0, written.length - body.length)}-- forge:drops table "x"\n${body}`;

    expect(lintMigration(path, edited).map((finding) => finding.rule)).toContain("generated-edited");
    const [migration] = discoverMigrations([{ name: "0002_schema.sql", path, sql: edited }]);
    expect(() => refuseUncomposed(allowed.run, migration === undefined ? [] : [migration])).toThrow(
      "pending migration(s) compose did not write, or that were edited after it wrote them, so nothing was applied",
    );
  });

  describe("a rename, which needs the digest as a drop does", () => {
    const POSTS_BODY: Shape = {
      name: "posts",
      columns: [
        ["id", "INTEGER PRIMARY KEY"],
        ["body", "TEXT"],
      ],
    };
    const POSTS_CONTENT: Shape = {
      name: "posts",
      columns: [
        ["id", "INTEGER PRIMARY KEY"],
        ["content", "TEXT"],
      ],
    };
    const RENAME_LINE = '-- forge:renames column "posts"."body" "content"';
    const RENAMES = { ...OPTIONS, renames: ["posts.body:content"] };
    const NO_CHANGE: SchemaDiff = { ...DROPS_NICKNAME, tables: [] };
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([POSTS_CONTENT]) };

    it("refuses a --rename-only plan without the digest, printing the line", async () => {
      const { run, io } = context(files);
      wire(io, { baseline: [POSTS_BODY], renamed: [POSTS_CONTENT], desired: [POSTS_CONTENT] });
      const digest = destructivePlanDigest(NO_CHANGE, [], [RENAME_LINE]);

      await expect(composeMigration(run, RENAMES)).rejects.toThrow(
        `the migration carries one approval line per drop and rename:\n  ${RENAME_LINE}\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
      );
      expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    });

    it("writes the forge:renames line and the rename under the digest", async () => {
      const { run, io } = context(files);
      wire(io, { baseline: [POSTS_BODY], renamed: [POSTS_CONTENT], desired: [POSTS_CONTENT] });

      await composeMigration(run, { ...RENAMES, allowDestructive: destructivePlanDigest(NO_CHANGE, [], [RENAME_LINE]) });

      const { body } = parseMigrationHeader(io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "");
      expect(body.startsWith(`${RENAME_LINE}\n`)).toBe(true);
      expect(body).toContain('RENAME COLUMN "body" TO "content"');
    });

    it("seeds the baseline under its old name and proves the value under the new one", async () => {
      const { run, io } = context(files);
      wire(io, { baseline: [POSTS_BODY], renamed: [POSTS_CONTENT], desired: [POSTS_CONTENT], lost: { posts: { content: "NULL" } } });

      await expect(composeMigration(run, { ...RENAMES, allowDestructive: destructivePlanDigest(NO_CHANGE, [], [RENAME_LINE]) })).rejects.toThrow(
        "the composed migration does not keep the rows it was proven over — this is a forge bug, and the file was not written:\n  posts.content was seeded 'forge-seed' and reads NULL",
      );
      expect(seedStatements(io)).toEqual(["PRAGMA defer_foreign_keys = true", `INSERT INTO "posts" ("id","body") VALUES (1,'forge-seed')`]);
    });
  });

  describe("a dropped view, which needs the digest though it discards no rows", () => {
    const VIEW = { type: "view", name: "user_emails", tbl_name: "user_emails", sql: "CREATE VIEW user_emails AS SELECT email FROM users" };
    const VIEW_LINE = '-- forge:drops view "user_emails"';
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS]) };
    const DROPS_VIEW: SchemaDiff = { ...DROPS_NICKNAME, tables: [], views: { created: [], dropped: ["user_emails"], changed: [] } };

    it("refuses without the digest, naming no discarded data", async () => {
      const { run, io } = context(files);
      wire(io, { baseline: [USERS], baselineExtra: [VIEW], desired: [USERS] });
      const digest = destructivePlanDigest(DROPS_VIEW, [], [VIEW_LINE]);

      await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
        new CliError(
          "invalid-args",
          `the migration carries one approval line per drop and rename:\n  ${VIEW_LINE}\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
        ),
      );
    });

    it("writes the forge:drops view line under the digest", async () => {
      const { run, io } = context(files);
      wire(io, { baseline: [USERS], baselineExtra: [VIEW], desired: [USERS], after: [USERS] });

      await composeMigration(run, { ...OPTIONS, allowDestructive: destructivePlanDigest(DROPS_VIEW, [], [VIEW_LINE]) });

      const { body } = parseMigrationHeader(io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "");
      expect(body.startsWith(`${VIEW_LINE}\n`)).toBe(true);
    });
  });

  it("asks for no digest and writes no approval line for a plan that drops and renames nothing", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    await composeMigration(run, OPTIONS);

    expect(parseMigrationHeader(io.files.get(`${MIGRATIONS}/0002_schema.sql`) ?? "").body).not.toContain("-- forge:");
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

  it("adds the proof's fallback warning to the outcome and prints it after the plan's, writing the file", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS_NICK_REQUIRED]) };
    const { run, io, out } = context(files);
    const seedRefusal = new Error("D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)");
    wire(io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED], after: [USERS_NICK_REQUIRED], seedRefusal });
    const fallback = "warning: the proof ran without rows — seeding users failed: UNIQUE users.email";

    const outcome = await composeMigration(run, OPTIONS);

    expect(outcome.warnings).toEqual([NICK_WARNING, fallback]);
    expect(out).toEqual([`wrote ${MIGRATIONS}/0002_schema.sql`, "  rebuild table users (column-changed)", NICK_WARNING, fallback]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(true);
  });

  it("commits one seeded row per baseline table before the proof, none of it a pragma_ read", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES]) });
    wire(io, { baseline: [USERS], desired: [USERS, NOTES] });

    await composeMigration(run, OPTIONS);

    expect(seedStatements(io)).toEqual(["PRAGMA defer_foreign_keys = true", `INSERT INTO "users" ("id","email") VALUES (1,'forge-seed')`]);
    expect(seedStatements(io).filter((statement) => statement.includes("pragma_"))).toEqual([]);
  });

  it("writes no file when a seeded value does not survive the proof", async () => {
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS_NICK_REQUIRED]) };
    const { run, io } = context(files);
    wire(io, { baseline: [USERS_WITH_NICKNAME], desired: [USERS_NICK_REQUIRED], after: [USERS_NICK_REQUIRED], lost: { users: { email: "NULL" } } });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      "the composed migration does not keep the rows it was proven over — this is a forge bug, and the file was not written:\n  users.email was seeded 'forge-seed' and reads NULL",
    );
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
    expect(io.files.has(SNAPSHOT)).toBe(false);
  });

  it("throws the diff's refusals, which no migration can express", async () => {
    const { run, io } = context({ [`${MIGRATIONS}/0001_init.sql`]: INIT, [SCHEMA]: schemaText([USERS, NOTES_WITH_AUTHOR]) });
    wire(io, { baseline: [USERS, NOTES], desired: [USERS, NOTES_WITH_AUTHOR] });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      "notes.author is NOT NULL with no DEFAULT on a table that already exists — add it nullable or with a constant DEFAULT, fill it with a seed, then make it NOT NULL in a later compose",
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
    const { run, io } = context({ ...libFiles(schemaText([USERS])), [SCHEMA]: schemaText([]) }, HOST);
    wire(io, { baseline: [], desired: [USERS] });

    const outcome = await composeMigration(run, OPTIONS);

    expect(outcome.path).toBe(`${MIGRATIONS}/0001_schema.sql`);
    expect(outcome.plan).toEqual(["create table users"]);
  });

  it("reads nothing a dependency ships that config/db.ts does not name", async () => {
    const { run, io } = context(libFiles(schemaText([USERS])), { schemas: ["schema.sql"] });
    wire(io, { baseline: [], desired: [] });

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      new CliError("invalid-args", "schema.sql is declared in config/db.ts and no file is there to read"),
    );
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
  const POSTS_LINE = '-- forge:drops table "posts"';

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
    const digest = destructivePlanDigest(DROPS_POSTS, [CAUSE], [POSTS_LINE]);

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(
      `the change discards data:\n  posts: drops the table\nthe migration carries one approval line per drop and rename:\n  ${POSTS_LINE}\nRead the plan above, then pass --allow-destructive ${digest} to compose exactly this plan.`,
    );
    expect(out).toEqual(["  drop table posts", CAUSE]);
    expect(io.files.has(`${MIGRATIONS}/0002_schema.sql`)).toBe(false);
  });

  it("digests the same drop differently when the file that declared it is still declared", async () => {
    const { run, io, out } = context(files(DELETED));
    wire(io, { baseline: [USERS, POSTS], desired: [USERS] });
    const digest = destructivePlanDigest(DROPS_POSTS, [], [POSTS_LINE]);

    await expect(composeMigration(run, OPTIONS)).rejects.toThrow(`pass --allow-destructive ${digest} to compose exactly this plan.`);
    expect(digest).not.toBe(destructivePlanDigest(DROPS_POSTS, [CAUSE], [POSTS_LINE]));
    expect(out).toEqual(["  drop table posts"]);
  });

  it("composes the drop under that plan's digest, printing the reason, and remembers only the surviving file's names", async () => {
    const { run, io, out } = context(files(DEPARTED));
    wire(io, { baseline: [USERS, POSTS], desired: [USERS], after: [USERS] });

    const outcome = await composeMigration(run, { ...OPTIONS, allowDestructive: destructivePlanDigest(DROPS_POSTS, [CAUSE], [POSTS_LINE]) });

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

  it("refuses an unstamped migration, an edited body, and an unknown name", async () => {
    const edited = `${generated(NEXT_BODY, "wrong")}-- edited\n`;
    const files = { [`${MIGRATIONS}/0001_init.sql`]: INIT, [`${MIGRATIONS}/0002_edited.sql`]: edited, [SCHEMA]: desiredText };
    const { run, io } = context(files);

    await expect(composeMigration(run, restamp("0001_init"))).rejects.toThrow(
      "0001_init has no compose stamp — only a composed migration can be restamped; compose again instead",
    );
    await expect(composeMigration(run, restamp("0002_edited"))).rejects.toThrow(
      "0002_edited was edited since it was composed — restamp would certify an unproven file; compose again instead",
    );
    await expect(composeMigration(run, restamp("0004_nope"))).rejects.toThrow(
      "--restamp 0004_nope names no migration — on disk: 0001_init, 0002_edited",
    );
    expect(io.files.get(`${MIGRATIONS}/0002_edited.sql`)).toBe(edited);
    expect(io.calls).toEqual([]);
  });
});
