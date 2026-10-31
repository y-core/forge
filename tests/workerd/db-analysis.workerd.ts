import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { withDbRun } from "../../src/tooling/db/context";
import { composed } from "../../src/tooling/db/db.fixture";
import { analyseMigrations } from "../../src/tooling/db/migrate/analysis";
import { readTargetFacts } from "../../src/tooling/db/migrate/apply";
import { discoverMigrations, readMigrations } from "../../src/tooling/db/migrate/files";
import type { MigrationFinding } from "../../src/tooling/db/migrate/types";
import type { DbRunContext, Migration } from "../../src/tooling/db/types";
import { openD1 } from "./d1";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");

interface Step {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forgeDb(root: string, args: string[]): Promise<Step> {
  const child = spawn("bun", ["run", BIN, "db", ...args, "--root", root], { cwd: FORGE });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr })));
}

const roots: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-analysis-"));
  roots.push(root);
  cpSync(join(FORGE, "tests", "fixtures", "db-compose", "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "db.config.ts"), 'export default { schemas: ["schema.sql"] };\n');
  return root;
}

function inRun<T>(root: string, body: (run: DbRunContext) => Promise<T>): Promise<T> {
  const flags = { root, target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, json: true, yes: true };
  return withDbRun(flags, undefined, { host: { schemas: ["schema.sql"] } }, body);
}

function analysePending(root: string): Promise<MigrationFinding[]> {
  return inRun(root, async (run) => {
    const facts = await readTargetFacts(run.io, run.home);
    const recorded = new Set(facts.recorded.map((row) => row.appliedName));
    return analyseMigrations(
      run,
      readMigrations(run).filter((migration) => !recorded.has(migration.name)),
      facts.inventory,
    );
  });
}

function analyseOne(root: string, migration: Migration): Promise<MigrationFinding[]> {
  return inRun(root, async (run) => analyseMigrations(run, [migration], (await readTargetFacts(run.io, run.home)).inventory));
}

function stampedMigration(name: string, body: string): Migration {
  const [migration] = discoverMigrations([{ name: `${name}.sql`, path: `/unused/${name}.sql`, sql: composed(body) }]);
  if (migration === undefined) throw new Error(`no migration discovered from ${name}`);
  return migration;
}

const BEFORE = `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT);
CREATE INDEX posts_summary ON posts (summary);
CREATE VIEW post_titles AS SELECT id, title FROM posts;
CREATE TRIGGER posts_title_kept BEFORE UPDATE OF title ON posts BEGIN SELECT RAISE(ABORT, 'title is required') WHERE NEW.title = ''; END;
`;

const REBUILT = `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
CREATE VIEW post_titles AS SELECT id, title FROM posts;
CREATE TRIGGER posts_title_kept BEFORE UPDATE OF title ON posts BEGIN SELECT RAISE(ABORT, 'title is required') WHERE NEW.title = ''; END;
`;

const MORE = `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT);
CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT);
CREATE VIEW post_titles AS SELECT id, title FROM posts;
CREATE TRIGGER posts_title_kept BEFORE UPDATE OF title ON posts BEGIN SELECT RAISE(ABORT, 'title is required') WHERE NEW.title = ''; END;
`;

const DIGEST = /--allow-destructive ([0-9a-f]{12})/;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test.describe("the migration analysis against a local target", () => {
  let root = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    root = freshRoot();
    writeFileSync(join(root, "schema.sql"), BEFORE);
    const init = await forgeDb(root, ["migrate", "compose", "init"]);
    expect(init.code, init.stderr).toBe(0);
    const migrated = await forgeDb(root, ["migrate", "--yes"]);
    expect(migrated.code, migrated.stderr).toBe(0);
  });

  test("a rebuild removing an indexed column is one destructive finding, and the view and trigger around it none", async () => {
    writeFileSync(join(root, "schema.sql"), REBUILT);
    const refused = await forgeDb(root, ["migrate", "compose", "change"]);
    const digest = DIGEST.exec(refused.stderr)?.[1];
    expect(digest, refused.stderr).toBeDefined();
    const change = await forgeDb(root, ["migrate", "compose", "change", "--allow-destructive", digest ?? ""]);
    expect(change.code, change.stderr).toBe(0);
    const written = readFileSync(join(root, "config", "db", "migrations", "0002_change.sql"), "utf-8");
    expect(written).toContain("_forge_new_posts");
    expect(written).toContain('-- forge:drops column "posts"."summary"');

    expect(await analysePending(root)).toEqual([
      {
        migration: "0002_change",
        severity: "destructive",
        change: { action: "drops", object: { type: "column", table: "posts", name: "summary" } },
      },
    ]);
  });

  test("leaves the target as it was", async () => {
    const db = await openD1(root);
    try {
      expect(await db.rows<{ name: string }>("SELECT name FROM _forge_migrations ORDER BY name")).toEqual([{ name: "0001_init" }]);
      expect((await db.rows<{ name: string }>("SELECT name FROM pragma_table_info('posts')")).map((row) => row.name)).toContain("summary");
    } finally {
      await db.dispose();
    }
  });

  test("a drop no line approves refuses", async () => {
    const migration = stampedMigration("0002_unapproved", "DROP INDEX IF EXISTS posts_summary;\nALTER TABLE posts DROP COLUMN summary;\n");
    await expect(analyseOne(root, migration)).rejects.toThrow(
      '0002_unapproved does not match the lines compose wrote for it on db-compose-fixture (local), so nothing was applied:\n  drops column "posts"."summary" — no `-- forge:drops column "posts"."summary"` line approves it',
    );
  });

  test("an additive migration yields nothing", async () => {
    const migrated = await forgeDb(root, ["migrate", "--yes"]);
    expect(migrated.code, migrated.stderr).toBe(0);
    writeFileSync(join(root, "schema.sql"), MORE);
    const more = await forgeDb(root, ["migrate", "compose", "more"]);
    expect(more.code, more.stderr).toBe(0);
    expect(await analysePending(root)).toEqual([]);
  });

  test("a table renamed with a new table under its old name is one rename finding and no drop", async () => {
    const migration = stampedMigration(
      "0004_rename_table",
      '-- forge:renames table "posts" "articles"\nALTER TABLE "posts" RENAME TO "articles";\nCREATE TABLE posts (id INTEGER PRIMARY KEY, name TEXT);\n',
    );
    expect(await analyseOne(root, migration)).toEqual([
      {
        migration: "0004_rename_table",
        severity: "incompatible",
        change: { action: "renames", rename: { kind: "table", from: "posts", to: "articles" } },
      },
    ]);
  });

  test("a column renamed with a new column under its old name is one rename finding and no drop", async () => {
    const migration = stampedMigration(
      "0004_rename_column",
      '-- forge:renames column "posts"."title" "heading"\nALTER TABLE "posts" RENAME COLUMN "title" TO "heading";\nALTER TABLE posts ADD COLUMN title TEXT;\n',
    );
    expect(await analyseOne(root, migration)).toEqual([
      {
        migration: "0004_rename_column",
        severity: "incompatible",
        change: { action: "renames", rename: { kind: "column", table: "posts", from: "title", to: "heading" } },
      },
    ]);
  });
});

test("lint refuses a target whose state cannot be opened, writing nothing", async () => {
  const root = freshRoot();
  writeFileSync(join(root, "schema.sql"), BEFORE);
  mkdirSync(join(root, "config", "db", "migrations"), { recursive: true });
  writeFileSync(join(root, "config", "db", "migrations", "0001_init.sql"), composed(BEFORE));
  mkdirSync(join(root, ".wrangler"));
  writeFileSync(join(root, ".wrangler", "state"), "not a directory\n");

  const lint = await forgeDb(root, ["lint"]);

  expect(lint.code, lint.stdout).toBe(1);
  expect(existsSync(join(root, ".forge", "scratch", "compose", "analysis"))).toBe(false);
  expect(readFileSync(join(root, ".wrangler", "state"), "utf-8")).toBe("not a directory\n");
});

test.describe("every verb that applies or judges migrations, on real local D1", () => {
  const INIT = composed("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);\n");
  const DROP = "DROP TABLE IF EXISTS notes;\n";

  function droppingRoot(approved: boolean): string {
    const root = freshRoot();
    const dir = join(root, "config", "db", "migrations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "0001_init.sql"), INIT);
    writeFileSync(join(dir, "0002_drop.sql"), composed(approved ? `-- forge:drops table "notes"\n${DROP}` : DROP));
    return root;
  }

  const verbs: [string, string[]][] = [
    ["migrate", ["migrate", "--yes"]],
    ["lint", ["lint"]],
    ["standby reset", ["standby", "reset", "--yes", "--no-seed"]],
  ];

  for (const [name, args] of verbs) {
    test(`${name} refuses a drop no line approves, and proceeds once its line does`, async () => {
      const refused = await forgeDb(droppingRoot(false), args);
      expect(refused.code, refused.stdout).toBe(1);
      expect(refused.stderr).toContain("0002_drop does not match the lines compose wrote for it on");
      expect(refused.stderr).toContain('drops table "notes" — no `-- forge:drops table "notes"` line approves it');

      const approved = await forgeDb(droppingRoot(true), args);
      expect(approved.code, approved.stderr).toBe(0);
    });
  }
});
