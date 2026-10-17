import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../cf/types";
import { PLAIN } from "../../term/color";
import { composed, fakeDbIo, schemaModelRows } from "../db.fixture";
import { appHome } from "../home";
import { diffSchemaModels } from "../schema/diff";
import type { SchemaColumn, SchemaModel, SchemaRename, SchemaTable } from "../schema/types";
import { toSchemaObjects } from "../sql";
import type { DbConfig, DbRunContext, FakeDbIo, Migration, Place, SchemaObject } from "../types";
import {
  analyseMigrations,
  copyTargetSchema,
  formatApprovalLine,
  migrationFindings,
  readApprovalLines,
  refuseUnapprovedFindings,
} from "./analysis";
import { discoverMigrations } from "./files";
import type { MigrationChange, MigrationFinding } from "./types";

const MIGRATIONS = "/app/config/db/migrations";
const ANALYSIS = "/app/.forge/scratch/compose/analysis";
const TARGET_SQL = `${ANALYSIS}/target.sql`;

function column(name: string, over: Partial<SchemaColumn> = {}): SchemaColumn {
  return {
    name,
    type: "TEXT",
    notnull: false,
    defaultExpr: null,
    pk: 0,
    hidden: 0,
    definition: `${name.toUpperCase()} TEXT`,
    definitionSource: `${name} TEXT`,
    ...over,
  };
}

const ID = column("id", { type: "INTEGER", pk: 1, definition: "ID INTEGER PRIMARY KEY", definitionSource: "id INTEGER PRIMARY KEY" });

function table(name: string, columns: readonly SchemaColumn[], over: Partial<SchemaTable> = {}): SchemaTable {
  return { name, columns, constraints: [], strict: false, withoutRowid: false, foreignKeys: [], sql: `CREATE TABLE ${name} (…)`, ...over };
}

function model(over: Partial<SchemaModel> = {}): SchemaModel {
  return { tables: [], indexes: [], triggers: [], views: [], ...over };
}

const tableRename = (from: string, to: string): SchemaRename => ({ kind: "table", from, to });
const columnRename = (on: string, from: string, to: string): SchemaRename => ({ kind: "column", table: on, from, to });

function migrationOf(sql: string, name = "0002_x"): Migration {
  const [migration] = discoverMigrations([{ name: `${name}.sql`, path: `${MIGRATIONS}/${name}.sql`, sql }]);
  if (migration === undefined) throw new Error(`no migration discovered from ${name}`);
  return migration;
}

describe("migrationFindings()", () => {
  it("reports a dropped table as destructive", () => {
    const before = model({ tables: [table("legacy", [ID]), table("posts", [ID])] });
    const after = model({ tables: [table("posts", [ID])] });
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "table", name: "legacy" } } },
    ]);
  });

  it("reports an ordinary column dropped in place as destructive, naming its table", () => {
    const before = model({ tables: [table("posts", [ID, column("body"), column("extra")])] });
    const after = model({ tables: [table("posts", [ID, column("body")])] });
    expect(diffSchemaModels(before, after).tables[0]?.kind).toBe("alter");
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "column", table: "posts", name: "extra" } } },
    ]);
  });

  it("reports an indexed column a rebuild removes as destructive", () => {
    const index = {
      name: "posts_summary",
      table: "posts",
      unique: false,
      partial: false,
      columns: ["summary"],
      sql: "CREATE INDEX posts_summary ON posts (summary)",
      normalized: "CREATE INDEX POSTS_SUMMARY ON POSTS (SUMMARY)",
    };
    const before = model({ tables: [table("posts", [ID, column("title"), column("summary")])], indexes: [index] });
    const after = model({ tables: [table("posts", [ID, column("title")])] });
    expect(diffSchemaModels(before, after).tables[0]?.kind).toBe("rebuild");
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "column", table: "posts", name: "summary" } } },
    ]);
  });

  it("reports a STORED generated column dropped as destructive", () => {
    const stored = column("slug", { hidden: 3, definition: "SLUG TEXT AS (LOWER(TITLE)) STORED" });
    const before = model({ tables: [table("posts", [ID, column("title"), stored])] });
    const after = model({ tables: [table("posts", [ID, column("title")])] });
    expect(migrationFindings(before, after, [], "0002_x").map((finding) => finding.severity)).toEqual(["destructive"]);
  });

  it("reports a VIRTUAL generated column dropped as incompatible and nothing destructive", () => {
    const virtual = column("slug", { hidden: 2, definition: "SLUG TEXT AS (LOWER(TITLE)) VIRTUAL" });
    const before = model({ tables: [table("posts", [ID, column("title"), virtual])] });
    const after = model({ tables: [table("posts", [ID, column("title")])] });
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "incompatible", change: { action: "drops", object: { type: "column", table: "posts", name: "slug" } } },
    ]);
  });

  it("reports a dropped view as incompatible and nothing else", () => {
    const view = { name: "post_titles", sql: "CREATE VIEW post_titles AS SELECT 1", normalized: "CREATE VIEW POST_TITLES AS SELECT 1" };
    const before = model({ tables: [table("posts", [ID])], views: [view] });
    const after = model({ tables: [table("posts", [ID])] });
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "incompatible", change: { action: "drops", object: { type: "view", name: "post_titles" } } },
    ]);
  });

  it("reports nothing for a view whose SQL changed", () => {
    const view = { name: "v", sql: "CREATE VIEW v AS SELECT 1", normalized: "CREATE VIEW V AS SELECT 1" };
    const before = model({ views: [view] });
    const after = model({ views: [{ ...view, sql: "CREATE VIEW v AS SELECT 2", normalized: "CREATE VIEW V AS SELECT 2" }] });
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([]);
  });

  it("reports nothing for a dropped index or a dropped trigger", () => {
    const index = {
      name: "posts_title",
      table: "posts",
      unique: false,
      partial: false,
      columns: ["title"],
      sql: "CREATE INDEX posts_title ON posts (title)",
      normalized: "CREATE INDEX POSTS_TITLE ON POSTS (TITLE)",
    };
    const trigger = { name: "posts_kept", table: "posts", sql: "CREATE TRIGGER posts_kept …", normalized: "CREATE TRIGGER POSTS_KEPT …" };
    const posts = table("posts", [ID, column("title")]);
    expect(migrationFindings(model({ tables: [posts], indexes: [index], triggers: [trigger] }), model({ tables: [posts] }), [], "0002_x")).toEqual(
      [],
    );
  });

  it("reports a table its line renames as one incompatible rename and no drop", () => {
    const rename = tableRename("users", "accounts");
    const before = model({ tables: [table("users", [ID, column("email")])] });
    const after = model({ tables: [table("accounts", [ID, column("email")])] });
    expect(migrationFindings(before, after, [rename], "0002_x")).toEqual([
      { migration: "0002_x", severity: "incompatible", change: { action: "renames", rename } },
    ]);
  });

  it("reports the same move with no line as a destructive drop of the old table", () => {
    const before = model({ tables: [table("users", [ID, column("email")])] });
    const after = model({ tables: [table("accounts", [ID, column("email")])] });
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "table", name: "users" } } },
    ]);
  });

  it("reports one rename and no drop when the file renames a table and declares a new one under the old name", () => {
    const rename = tableRename("users", "accounts");
    const before = model({ tables: [table("users", [ID, column("email")])] });
    const after = model({ tables: [table("accounts", [ID, column("email")]), table("users", [ID, column("name")])] });
    expect(migrationFindings(before, after, [rename], "0002_x")).toEqual([
      { migration: "0002_x", severity: "incompatible", change: { action: "renames", rename } },
    ]);
  });

  it("reports one rename and no drop when the file renames a column and adds a new one under the old name", () => {
    const rename = columnRename("posts", "body", "content");
    const before = model({ tables: [table("posts", [ID, column("body")])] });
    const after = model({ tables: [table("posts", [ID, column("content"), column("body")])] });
    expect(migrationFindings(before, after, [rename], "0002_x")).toEqual([
      { migration: "0002_x", severity: "incompatible", change: { action: "renames", rename } },
    ]);
  });

  it("reports a column renamed with no line as a destructive drop of the old column", () => {
    const before = model({ tables: [table("posts", [ID, column("body")])] });
    const after = model({ tables: [table("posts", [ID, column("content")])] });
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "column", table: "posts", name: "body" } } },
    ]);
  });

  it("reports a column dropped from a renamed table under the table's name before the file, ahead of the rename", () => {
    const rename = tableRename("users", "accounts");
    const before = model({ tables: [table("users", [ID, column("email"), column("legacy")])] });
    const after = model({ tables: [table("accounts", [ID, column("email")])] });
    expect(migrationFindings(before, after, [rename], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "column", table: "users", name: "legacy" } } },
      { migration: "0002_x", severity: "incompatible", change: { action: "renames", rename } },
    ]);
  });

  it("reports a column renamed inside a renamed table as two renames and no drop", () => {
    const renames = [columnRename("users", "email", "mail"), tableRename("users", "accounts")];
    const before = model({ tables: [table("users", [ID, column("email")])] });
    const after = model({ tables: [table("accounts", [ID, column("mail")])] });
    expect(migrationFindings(before, after, renames, "0002_x")).toEqual(
      renames.map((rename) => ({ migration: "0002_x", severity: "incompatible", change: { action: "renames", rename } })),
    );
  });

  it("reads a column line after a table line against the table's new name, as the lines run in order", () => {
    const renames = [tableRename("users", "accounts"), columnRename("accounts", "email", "mail")];
    const before = model({ tables: [table("users", [ID, column("email")])] });
    const after = model({ tables: [table("accounts", [ID, column("mail")])] });
    expect(migrationFindings(before, after, renames, "0002_x").map((finding) => finding.change.action)).toEqual(["renames", "renames"]);
  });

  it("matches a line's names without regard to ASCII case", () => {
    const rename = tableRename("USERS", "accounts");
    const before = model({ tables: [table("users", [ID])] });
    const after = model({ tables: [table("accounts", [ID])] });
    expect(migrationFindings(before, after, [rename], "0002_x")).toEqual([
      { migration: "0002_x", severity: "incompatible", change: { action: "renames", rename } },
    ]);
  });

  it("refuses a line naming a table or a column the schema before it does not hold, naming the migration", () => {
    const before = model({ tables: [table("posts", [ID, column("body")])] });
    expect(() => migrationFindings(before, before, [tableRename("users", "accounts")], "0002_x")).toThrow(
      '0002_x: its forge:renames line names table "users", which is not in the schema before it',
    );
    expect(() => migrationFindings(before, before, [columnRename("posts", "title", "heading")], "0002_x")).toThrow(
      '0002_x: its forge:renames line names column "posts"."title", which is not in the schema before it',
    );
  });

  it("refuses a line whose new name the schema before it already holds", () => {
    const before = model({ tables: [table("users", [ID, column("email"), column("mail")]), table("accounts", [ID])] });
    expect(() => migrationFindings(before, before, [tableRename("users", "accounts")], "0002_x")).toThrow(
      '0002_x: its forge:renames line names table "users", whose new name "accounts" the schema before it already holds',
    );
    expect(() => migrationFindings(before, before, [columnRename("users", "email", "MAIL")], "0002_x")).toThrow(
      '0002_x: its forge:renames line names column "users"."email", whose new name "MAIL" the schema before it already holds',
    );
  });

  it("ignores a diff's refusals and its drop dependents, reporting only the drop", () => {
    const fk = { table: "parent", from: ["parent_id"], to: ["id"], onUpdate: "NO ACTION", onDelete: "NO ACTION" };
    const child = table("child", [ID, column("parent_id", { type: "INTEGER", definition: "PARENT_ID INTEGER REFERENCES PARENT (ID)" })], {
      foreignKeys: [fk],
    });
    const before = model({ tables: [table("parent", [ID]), child, table("posts", [ID])] });
    const after = model({ tables: [child, table("posts", [ID, column("title", { notnull: true, definition: "TITLE TEXT NOT NULL" })])] });
    const diff = diffSchemaModels(before, after);
    expect(diff.refusals.length).toBeGreaterThan(0);
    expect(diff.dropDependents).toEqual(["child"]);
    expect(migrationFindings(before, after, [], "0002_x")).toEqual([
      { migration: "0002_x", severity: "destructive", change: { action: "drops", object: { type: "table", name: "parent" } } },
    ]);
  });
});

const dropsTable = (name: string): MigrationChange => ({ action: "drops", object: { type: "table", name } });
const dropsColumn = (on: string, name: string): MigrationChange => ({ action: "drops", object: { type: "column", table: on, name } });
const dropsView = (name: string): MigrationChange => ({ action: "drops", object: { type: "view", name } });
const renames = (rename: SchemaRename): MigrationChange => ({ action: "renames", rename });

describe("readApprovalLines()", () => {
  it("reads every shape of line under the header, in file order", () => {
    const migration = migrationOf(
      composed(
        [
          '-- forge:drops table "legacy_events"',
          '-- forge:drops column "posts"."summary"',
          '-- forge:drops view "post_counts"',
          '-- forge:renames table "users" "accounts"',
          '-- forge:renames column "posts"."body" "content"',
          "CREATE TABLE t (id INTEGER);",
        ].join("\n"),
      ),
    );
    expect(readApprovalLines(migration)).toEqual([
      dropsTable("legacy_events"),
      dropsColumn("posts", "summary"),
      dropsView("post_counts"),
      renames(tableRename("users", "accounts")),
      renames(columnRename("posts", "body", "content")),
    ]);
  });

  it("unquotes a doubled quote inside a name", () => {
    expect(
      readApprovalLines(migrationOf(composed('-- forge:renames table "we""ird" "plain"\n-- forge:drops column "a""b"."c"\nSELECT 1;'))),
    ).toEqual([renames(tableRename('we"ird', "plain")), dropsColumn('a"b', "c")]);
  });

  it("reads both kinds of line and skips the generated notice", () => {
    const migration = migrationOf(composed('-- forge:drops table "legacy"\n-- forge:renames table "a" "b"\nSELECT 1;'));
    expect(readApprovalLines(migration)).toEqual([dropsTable("legacy"), renames(tableRename("a", "b"))]);
  });

  it("does not read a line after the first statement", () => {
    expect(readApprovalLines(migrationOf(composed('SELECT 1;\n-- forge:renames table "a" "b"\n-- forge:drops table "c"\n')))).toEqual([]);
  });

  const malformed = [
    '-- forge:renames table "users"',
    "-- forge:renames table 'users' 'accounts'",
    '-- forge:renames table users "accounts"',
    '-- forge:renames index "a" "b"',
    '-- forge:renames column "posts" "body" "content"',
    "-- forge:renames",
    "-- forge:drops table legacy",
    "-- forge:drops table 'legacy'",
    '-- forge:drops index "posts_title"',
    '-- forge:drops column "t" "c"',
    "-- forge:drops table",
    '-- forge:drops table "a" "b"',
    "-- forge:drops",
  ];
  for (const line of malformed) {
    it(`refuses ${line}, naming the migration`, () => {
      expect(() => readApprovalLines(migrationOf(composed(`${line}\nSELECT 1;`)))).toThrow(
        `0002_x: \`${line}\` is not a forge:${line.startsWith("-- forge:drops") ? "drops" : "renames"} line compose writes — compose the migration again`,
      );
    });
  }

  it("returns nothing for a migration with no lines", () => {
    expect(readApprovalLines(migrationOf(composed("CREATE TABLE t (id INTEGER);")))).toEqual([]);
  });
});

describe("formatApprovalLine()", () => {
  const changes = [
    dropsTable("legacy_events"),
    dropsColumn("posts", "summary"),
    dropsView("post_counts"),
    renames(tableRename("users", "accounts")),
    renames(columnRename("posts", "body", "content")),
    dropsColumn('we"ird', 'col"umn'),
    renames(tableRename('a"b', 'c"d')),
  ];

  it("writes §9b's spelling of each kind of line", () => {
    expect(changes.slice(0, 5).map(formatApprovalLine)).toEqual([
      '-- forge:drops table "legacy_events"',
      '-- forge:drops column "posts"."summary"',
      '-- forge:drops view "post_counts"',
      '-- forge:renames table "users" "accounts"',
      '-- forge:renames column "posts"."body" "content"',
    ]);
  });

  for (const change of changes) {
    it(`reads back ${formatApprovalLine(change)} as the change it was written from`, () => {
      expect(readApprovalLines(migrationOf(composed(`${formatApprovalLine(change)}\nSELECT 1;`)))).toEqual([change]);
    });
  }
});

function dbConfig(place: Place, entry: Record<string, unknown> = {}): DbConfig {
  const config = {
    name: "app",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "app-db", database_id: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", ...entry }],
  } as WranglerConfig;
  return {
    root: "/app",
    configPath: "/app/wrangler.jsonc",
    config,
    env: null,
    entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
    target: { place, database: null },
  };
}

function context(place: Place = "local", entry: Record<string, unknown> = {}): { run: DbRunContext; io: FakeDbIo } {
  const io = fakeDbIo();
  const config = dbConfig(place, entry);
  const run: DbRunContext = { config, home: appHome(config), io, host: {}, json: false, yes: true, style: PLAIN, print: () => {} };
  return { run, io };
}

const row = (type: string, name: string, sql: string | null, tblName = name) => ({ type, name, tbl_name: tblName, sql });

const inventoryOf = (rows: Record<string, unknown>[]): SchemaObject[] => toSchemaObjects(rows);

const loadsIntoCopy = (io: FakeDbIo) => io.d1Calls.filter((call) => call.source === TARGET_SQL);

describe("refuseUnapprovedFindings()", () => {
  const destructive = (change: MigrationChange): MigrationFinding => ({ migration: "0002_x", severity: "destructive", change });
  const refusal = (lines: readonly string[]) =>
    `0002_x does not match the lines compose wrote for it on app-db (local), so nothing was applied:\n  ${lines.join("\n  ")}\nThe target's schema is not the one the file was composed against: restore it to the schema its migrations describe, or compose again and approve the change with --allow-destructive.`;

  it("passes findings and lines that pair one to one, without regard to ASCII case", () => {
    const { run } = context();
    const findings = [destructive(dropsColumn("posts", "summary")), destructive(dropsTable("legacy"))];
    expect(() => refuseUnapprovedFindings(run, "0002_x", findings, [dropsTable("LEGACY"), dropsColumn("Posts", "Summary")])).not.toThrow();
    expect(() => refuseUnapprovedFindings(run, "0002_x", [], [])).not.toThrow();
  });

  it("refuses a second drop no line approves, naming it and only it", () => {
    const { run } = context();
    const findings = [destructive(dropsTable("legacy")), destructive(dropsColumn("posts", "summary"))];
    expect(() => refuseUnapprovedFindings(run, "0002_x", findings, [dropsTable("legacy")])).toThrow(
      refusal(['drops column "posts"."summary" — no `-- forge:drops column "posts"."summary"` line approves it']),
    );
  });

  it("refuses a line no finding matches, naming the line", () => {
    const { run } = context();
    expect(() => refuseUnapprovedFindings(run, "0002_x", [], [dropsView("post_counts")])).toThrow(
      refusal(['`-- forge:drops view "post_counts"` — the file makes no such change here']),
    );
  });

  it("refuses the extra one of two identical lines against one finding", () => {
    const { run } = context();
    expect(() =>
      refuseUnapprovedFindings(run, "0002_x", [destructive(dropsTable("legacy"))], [dropsTable("legacy"), dropsTable("legacy")]),
    ).toThrow(refusal(['`-- forge:drops table "legacy"` — the file makes no such change here']));
  });

  it("names the target's database and place", () => {
    const { run } = context("remote");
    expect(() => refuseUnapprovedFindings(run, "0002_x", [destructive(dropsTable("legacy"))], [])).toThrow(
      "0002_x does not match the lines compose wrote for it on app-db (remote), so nothing was applied:",
    );
  });
});

describe("copyTargetSchema()", () => {
  it("loads tables, then indexes, then views, then triggers, each in inventory order", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([
      row("index", "posts_title", "CREATE INDEX posts_title ON posts (title)", "posts"),
      row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)"),
      row("trigger", "posts_kept", "CREATE TRIGGER posts_kept AFTER INSERT ON posts BEGIN SELECT 1; END", "posts"),
      row("table", "tags", "CREATE TABLE tags (id INTEGER PRIMARY KEY);"),
      row("view", "post_titles", "CREATE VIEW post_titles AS SELECT title FROM posts", "post_titles"),
    ]);
    const home = await copyTargetSchema(run, inventory, "analysis");
    expect(home.dir).toBe(ANALYSIS);
    expect(home.place).toBe("local");
    expect(io.files.get(TARGET_SQL)).toBe(
      [
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);",
        "CREATE TABLE tags (id INTEGER PRIMARY KEY);",
        "CREATE INDEX posts_title ON posts (title);",
        "CREATE VIEW post_titles AS SELECT title FROM posts;",
        "CREATE TRIGGER posts_kept AFTER INSERT ON posts BEGIN SELECT 1; END;",
      ].join("\n\n"),
    );
    const loads = loadsIntoCopy(io);
    expect(loads).toHaveLength(1);
    expect(loads[0]?.persistTo.startsWith(`${ANALYSIS}/`)).toBe(true);
  });

  it("skips autoindexes, forge's, SQLite's and the platform's objects, and wrangler's default history table", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([
      row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY, slug TEXT UNIQUE)"),
      row("index", "sqlite_autoindex_posts_1", null, "posts"),
      row("index", "posts_slug_auto", null, "posts"),
      row("table", "_forge_migrations", "CREATE TABLE _forge_migrations (name TEXT)"),
      row("table", "_cf_KV", "CREATE TABLE _cf_KV (key TEXT)"),
      row("table", "sqlite_sequence", "CREATE TABLE sqlite_sequence(name,seq)"),
      row("table", "d1_migrations", "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)"),
    ]);
    await copyTargetSchema(run, inventory, "analysis");
    expect(io.files.get(TARGET_SQL)).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY, slug TEXT UNIQUE);");
  });

  it("skips the history table the entry's migrations_table names, and an index on it, keeping d1_migrations", async () => {
    const { run, io } = context("local", { migrations_table: "wrangler_history" });
    const inventory = inventoryOf([
      row("table", "d1_migrations", "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY)"),
      row("table", "Wrangler_History", "CREATE TABLE Wrangler_History (id INTEGER PRIMARY KEY, name TEXT)"),
      row("index", "history_name", "CREATE INDEX history_name ON Wrangler_History (name)", "Wrangler_History"),
    ]);
    await copyTargetSchema(run, inventory, "analysis");
    expect(io.files.get(TARGET_SQL)).toBe("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY);");
  });

  it("refuses a target holding a virtual table, naming it and loading nothing", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([
      row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY)"),
      row("table", "search", "CREATE VIRTUAL TABLE search USING fts5(body)"),
    ]);
    await expect(copyTargetSchema(run, inventory, "analysis")).rejects.toThrow(
      "search in app-db (local) is a virtual table, which no schema model describes",
    );
    expect(loadsIntoCopy(io)).toEqual([]);
    expect(io.files.has(TARGET_SQL)).toBe(false);
  });

  it("returns an empty copy for an empty target, loading nothing", async () => {
    const { run, io } = context();
    const home = await copyTargetSchema(run, [], "analysis");
    expect(home.dir).toBe(ANALYSIS);
    expect(io.files.has(TARGET_SQL)).toBe(false);
    expect(loadsIntoCopy(io)).toEqual([]);
  });

  it("copies a remote target's inventory to a local scratch, reading nothing itself", async () => {
    const { run, io } = context("remote");
    const home = await copyTargetSchema(run, inventoryOf([row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY)")]), "analysis");
    expect(home.place).toBe("local");
    expect(home.dir).toBe(ANALYSIS);
    expect(io.files.get(TARGET_SQL)).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY);");
    expect(loadsIntoCopy(io)).toHaveLength(1);
    expect(io.calls).toEqual([]);
  });

  it("refuses a schema that does not rebuild on the scratch database", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY)")]);
    const d1 = io.d1.bind(io);
    io.d1 = (home, sql) => (home.label === "local" ? d1(home, sql) : Promise.reject(new Error('near "posts": syntax error')));
    await expect(copyTargetSchema(run, inventory, "analysis")).rejects.toThrow(
      "the schema of app-db (local) does not rebuild on a scratch database",
    );
  });

  it("builds the seed check's copy in a directory of its own, apart from the analysis's", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY)")]);
    const seed = "/app/.forge/scratch/compose/seed";
    const home = await copyTargetSchema(run, inventory, "seed");
    expect(home.dir).toBe(seed);
    expect(io.files.get(`${seed}/target.sql`)).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY);");
    expect(io.files.has(TARGET_SQL)).toBe(false);
    const loads = io.d1Calls.filter((call) => call.source === `${seed}/target.sql`);
    expect(loads.map((load) => load.persistTo.startsWith(`${seed}/`))).toEqual([true]);
  });

  it("never touches compose's cached baseline", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([row("table", "posts", "CREATE TABLE posts (id INTEGER PRIMARY KEY)")]);
    await copyTargetSchema(run, inventory, "analysis");
    const baseline = "/app/.forge/scratch/compose/baseline";
    expect(io.closed.some((path) => path.startsWith(baseline))).toBe(false);
    expect([...io.files.keys()].some((path) => path.startsWith(baseline))).toBe(false);
  });
});

describe("analyseMigrations()", () => {
  it("refuses a migration that does not apply to the copy, naming it and loading nothing after it", async () => {
    const { run, io } = context();
    const failing = migrationOf(composed("ALTER TABLE nope ADD COLUMN x TEXT;"));
    const later = migrationOf(composed("CREATE TABLE later (id INTEGER PRIMARY KEY);"), "0003_y");
    const d1 = io.d1.bind(io);
    io.d1 = (home, sql) => (sql[0] === failing.sql ? Promise.reject(new Error("no such table: nope")) : d1(home, sql));
    await expect(analyseMigrations(run, [failing, later], [])).rejects.toThrow(
      "0002_x does not apply to a copy of app-db (local)'s schema, so it would fail there too — nothing was applied to app-db:\n",
    );
    expect(io.d1Calls.some((call) => call.source === `${ANALYSIS}/0003_y.sql`)).toBe(false);
  });

  it("stages each pending migration in the copy's own directory", async () => {
    const { run, io } = context();
    const pending = [migrationOf(composed("CREATE TABLE a (id INTEGER);")), migrationOf(composed("CREATE TABLE b (id INTEGER);"), "0003_y")];
    expect(await analyseMigrations(run, pending, [])).toEqual([]);
    expect(io.d1Calls.map((call) => call.source).filter((source) => source?.startsWith(`${ANALYSIS}/000`))).toEqual([
      `${ANALYSIS}/0002_x.sql`,
      `${ANALYSIS}/0003_y.sql`,
    ]);
  });

  const POSTS_WITH_SUMMARY = "CREATE TABLE posts (id INTEGER PRIMARY KEY, summary TEXT)";
  const POSTS = "CREATE TABLE posts (id INTEGER PRIMARY KEY)";
  const postsRows = (sql: string, columns: readonly string[]) => ({
    inventory: [{ type: "table", name: "posts", tbl_name: "posts", sql }],
    columns: columns.map((name, cid) => ({
      tbl: "posts",
      cid,
      name,
      type: name === "id" ? "INTEGER" : "TEXT",
      notnull: 0,
      dflt_value: null,
      pk: name === "id" ? 1 : 0,
      hidden: 0,
    })),
  });

  function dropsSummary(io: FakeDbIo): void {
    const applied = () => io.d1Calls.some((call) => call.source === `${ANALYSIS}/0002_x.sql`);
    io.d1Rules.push({
      match: (_statement, home) => home.label === "scratch:compose-analysis",
      reply: (statement) => schemaModelRows(statement, applied() ? postsRows(POSTS, ["id"]) : postsRows(POSTS_WITH_SUMMARY, ["id", "summary"])),
    });
  }

  it("returns a drop its line approves", async () => {
    const { run, io } = context();
    dropsSummary(io);
    const migration = migrationOf(composed('-- forge:drops column "posts"."summary"\nALTER TABLE posts DROP COLUMN summary;'));
    expect(await analyseMigrations(run, [migration], [])).toEqual([
      { migration: "0002_x", severity: "destructive", change: dropsColumn("posts", "summary") },
    ]);
  });

  it("refuses the same drop with no line, before the next migration is staged", async () => {
    const { run, io } = context();
    dropsSummary(io);
    const pending = [
      migrationOf(composed("ALTER TABLE posts DROP COLUMN summary;")),
      migrationOf(composed("CREATE TABLE later (id INTEGER PRIMARY KEY);"), "0003_y"),
    ];
    await expect(analyseMigrations(run, pending, [])).rejects.toThrow(
      '0002_x does not match the lines compose wrote for it on app-db (local), so nothing was applied:\n  drops column "posts"."summary" — no `-- forge:drops column "posts"."summary"` line approves it',
    );
    expect(io.d1Calls.some((call) => call.source === `${ANALYSIS}/0003_y.sql`)).toBe(false);
  });

  it("refuses a line for a drop the migration does not make", async () => {
    const { run } = context();
    const migration = migrationOf(composed('-- forge:drops table "legacy"\nCREATE TABLE a (id INTEGER);'));
    await expect(analyseMigrations(run, [migration], [])).rejects.toThrow(
      '0002_x does not match the lines compose wrote for it on app-db (local), so nothing was applied:\n  `-- forge:drops table "legacy"` — the file makes no such change here',
    );
  });

  it("builds no copy when nothing is pending", async () => {
    const { run, io } = context();
    const inventory = inventoryOf([row("table", "search", "CREATE VIRTUAL TABLE search USING fts5(body)")]);
    expect(await analyseMigrations(run, [], inventory)).toEqual([]);
    expect(io.d1Calls).toEqual([]);
    expect(io.closed).toEqual([]);
  });
});
