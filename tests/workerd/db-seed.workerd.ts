import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { withDbRun } from "../../src/tooling/db/context";
import { readTargetFacts } from "../../src/tooling/db/migrate/apply";
import { readSeeds } from "../../src/tooling/db/seed/apply";
import { refuseSchemaChangingSeeds } from "../../src/tooling/db/seed/effect";
import type { DbIo, DbRunContext } from "../../src/tooling/db/types";
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

const SCHEMA = `CREATE TABLE parent (id INTEGER PRIMARY KEY, code TEXT NOT NULL);
CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), code TEXT UNIQUE, note TEXT NOT NULL CHECK (note <> ''));
CREATE INDEX child_parent ON child (parent_id);
CREATE VIEW child_codes AS SELECT id, code FROM child;
CREATE TABLE t (a INTEGER);
CREATE TABLE p (x INTEGER);
`;

const roots: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-seed-"));
  roots.push(root);
  cpSync(join(FORGE, "tests", "fixtures", "db-compose", "wrangler.jsonc"), join(root, "wrangler.jsonc"));
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "db.ts"), 'export default { schemas: ["schema.sql"], seeds: ["seeds"] };\n');
  writeFileSync(join(root, "schema.sql"), SCHEMA);
  return root;
}

function writeOnlySeed(root: string, name: string, sql: string): void {
  rmSync(join(root, "seeds"), { recursive: true, force: true });
  mkdirSync(join(root, "seeds"));
  writeFileSync(join(root, "seeds", `${name}.sql`), sql);
}

function inRun<T>(root: string, body: (run: DbRunContext) => Promise<T>): Promise<T> {
  const flags = { root, target: "local", db: undefined, config: "wrangler.jsonc", env: undefined, json: true, yes: true };
  return withDbRun(flags, undefined, { host: { schemas: ["schema.sql"], seeds: ["seeds"] } }, body);
}

/** The extended code of every statement the seed check's copy refused while judging the seeds on disk. */
function refusalsOnCopy(root: string): Promise<string[]> {
  return inRun(root, async (run) => {
    const refused: string[] = [];
    const d1: DbIo["d1"] = (home, sql) =>
      run.io.d1(home, sql).catch((error: unknown) => {
        refused.push(/\(extended: (\w+)\)/.exec(String(error))?.[1] ?? String(error));
        throw error;
      });
    const facts = await readTargetFacts(run.io, run.home);
    await refuseSchemaChangingSeeds({ ...run, io: { ...run.io, d1 } }, readSeeds(run), new Map(), facts.inventory);
    return refused;
  });
}

async function targetState(root: string): Promise<{ schema: unknown[]; history: unknown[] }> {
  const db = await openD1(root);
  try {
    const schema = await db.rows("SELECT type, name, sql FROM sqlite_master ORDER BY type, name");
    const kept = schema.some((row) => (row as { name: string }).name === "_forge_seed_history");
    const history = kept ? await db.rows("SELECT source, name FROM _forge_seed_history ORDER BY name") : [];
    return { schema, history };
  } finally {
    await db.dispose();
  }
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test.describe("seed apply against real local D1", () => {
  let root = "";

  test.beforeAll(async () => {
    root = freshRoot();
    const init = await forgeDb(root, ["migrate", "compose", "init"]);
    expect(init.code, init.stderr).toBe(0);
    const migrated = await forgeDb(root, ["migrate", "--yes"]);
    expect(migrated.code, migrated.stderr).toBe(0);
    const db = await openD1(root);
    try {
      await db.exec("INSERT INTO parent (id, code) VALUES (1, 'a'), (2, 'b');\nINSERT INTO p (x) VALUES (1);");
    } finally {
      await db.dispose();
    }
  });

  const schemaChanges: [string, string, string][] = [
    ["drops a column", "ALTER TABLE child DROP COLUMN note;", "table child: differs between the schema before it and the schema after it"],
    ["creates an index", "CREATE INDEX child_note ON child (note);", "index child_note: in the schema after it, not in the schema before it"],
    ["drops a view", "DROP VIEW child_codes;", "view child_codes: in the schema before it, not in the schema after it"],
  ];
  for (const [what, sql, line] of schemaChanges) {
    test(`refuses a seed that ${what}, naming it and writing nothing to the target`, async () => {
      const before = await targetState(root);
      writeOnlySeed(root, "001_change", `INSERT INTO child (id, parent_id, note) VALUES (1, 1, 'x') ON CONFLICT (id) DO NOTHING;\n${sql}\n`);

      const refused = await forgeDb(root, ["seed", "apply"]);

      expect(refused.code, refused.stdout).toBe(1);
      expect(refused.stderr).toContain(
        `seeds:001_change changes the schema of db-compose-fixture (local), and only a composed migration may — no seed was applied:\n  ${line}`,
      );
      const after = await targetState(root);
      expect(after).toEqual(before);
      expect(after.history).toEqual([]);
    });
  }

  const dataOnly: [string, string, string, number[]][] = [
    [
      "SQLITE_CONSTRAINT_FOREIGNKEY",
      "002_foreign_key",
      "INSERT INTO child (id, parent_id, note) VALUES (10, 1, 'x') ON CONFLICT (id) DO NOTHING;",
      [10],
    ],
    [
      "SQLITE_CONSTRAINT_NOTNULL",
      "003_not_null",
      "INSERT INTO child (id, parent_id, note) VALUES (11, 1, (SELECT code FROM parent WHERE id = 1)) ON CONFLICT (id) DO NOTHING;",
      [11],
    ],
    [
      "SQLITE_CONSTRAINT_CHECK",
      "004_check",
      "INSERT INTO child (id, parent_id, note) VALUES (12, 1, coalesce((SELECT code FROM parent WHERE id = 1), '')) ON CONFLICT (id) DO NOTHING;",
      [12],
    ],
    [
      "SQLITE_CONSTRAINT_UNIQUE",
      "005_unique",
      "INSERT INTO child (id, parent_id, code, note) VALUES (13, 1, coalesce((SELECT code FROM parent WHERE id = 1), 'x'), 'n'), (14, 2, coalesce((SELECT code FROM parent WHERE id = 2), 'x'), 'n') ON CONFLICT (id) DO NOTHING;",
      [13, 14],
    ],
  ];
  for (const [code, name, sql, ids] of dataOnly) {
    test(`applies a data-only seed the copy refuses with ${code}, since the target holds its parent rows`, async () => {
      writeOnlySeed(root, name, `${sql}\n`);
      expect(await refusalsOnCopy(root)).toEqual([code]);

      const applied = await forgeDb(root, ["seed", "apply"]);

      expect(applied.code, applied.stderr).toBe(0);
      const db = await openD1(root);
      try {
        const rows = await db.rows<{ id: number }>(`SELECT id FROM child WHERE id IN (${ids.join(", ")}) ORDER BY id`);
        expect(rows.map((row) => row.id)).toEqual(ids);
        expect(await db.rows("SELECT source, name FROM _forge_seed_history WHERE name = '" + name + "'")).toEqual([{ source: "seeds", name }]);
      } finally {
        await db.dispose();
      }
    });
  }

  test("refuses a seed whose CREATE UNIQUE INDEX a row constraint stops on the copy alone, before any target write", async () => {
    const before = await targetState(root);
    const index = "CREATE UNIQUE INDEX t_a ON t (a)";
    writeOnlySeed(
      root,
      "007_unique_index",
      `INSERT OR IGNORE INTO t (a) VALUES (1),(1);\nDELETE FROM t WHERE EXISTS (SELECT 1 FROM p);\n${index};\n`,
    );

    const refused = await forgeDb(root, ["seed", "apply"]);

    expect(refused.code, refused.stdout).toBe(1);
    expect(refused.stderr).toContain(
      `seeds:007_unique_index writes the schema of db-compose-fixture (local) at \`${index}\`, which a row constraint stopped on the copy but need not stop on the target, and only a composed migration may — no seed was applied:`,
    );
    expect(refused.stderr).toContain("(extended: SQLITE_CONSTRAINT_UNIQUE)");
    expect(await targetState(root)).toEqual(before);
  });

  test("refuses a seed whose ADD COLUMN … CHECK fails on the copy's rows, which local D1 answers with no row-constraint code", async () => {
    const before = await targetState(root);
    const column = "ALTER TABLE t ADD COLUMN c INTEGER DEFAULT 0 CHECK (c > 0)";
    writeOnlySeed(root, "008_check_column", `INSERT OR IGNORE INTO t (a) VALUES (1);\n${column};\n`);

    const refused = await forgeDb(root, ["seed", "apply"]);

    expect(refused.code, refused.stdout).toBe(1);
    expect(refused.stderr).toContain(
      `seeds:008_check_column fails on a copy of db-compose-fixture (local)'s schema at \`${column}\`, so no seed was applied — fix the statement:\nD1_ERROR: CHECK constraint failed: SQLITE_ERROR`,
    );
    expect(await targetState(root)).toEqual(before);
  });

  test("refuses a seed whose statement is a syntax error on the copy, naming the statement", async () => {
    writeOnlySeed(root, "006_typo", "INSERT INTO child (id) VALUS (1) ON CONFLICT (id) DO NOTHING;\n");

    const refused = await forgeDb(root, ["seed", "apply"]);

    expect(refused.code, refused.stdout).toBe(1);
    expect(refused.stderr).toContain(
      "seeds:006_typo fails on a copy of db-compose-fixture (local)'s schema at `INSERT INTO child (id) VALUS (1) ON CONFLICT (id) DO NOTHING;`, so no seed was applied — fix the statement:",
    );
    expect(refused.stderr).toContain(`D1_ERROR: near "VALUS": syntax error`);
    expect((await targetState(root)).history.some((row) => (row as { name: string }).name === "006_typo")).toBe(false);
  });
});

test("standby reset refuses a seed that changes the schema, naming it", async () => {
  const root = freshRoot();
  const init = await forgeDb(root, ["migrate", "compose", "init"]);
  expect(init.code, init.stderr).toBe(0);
  writeOnlySeed(root, "001_index", "CREATE INDEX child_note ON child (note);\n");

  const refused = await forgeDb(root, ["standby", "reset", "--yes"]);

  expect(refused.code, refused.stdout).toBe(1);
  expect(refused.stderr).toContain("seeds:001_index changes the schema of");
  expect(refused.stderr).toContain("index child_note: in the schema after it, not in the schema before it");
});
