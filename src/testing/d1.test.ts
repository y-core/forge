import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dropStatements, openTestD1, scansTable, testD1Config, usesIndex } from "./d1";
import type { PlanStep } from "./d1";

describe("testD1Config()", () => {
  it("declares one DB binding and no Worker entry", () => {
    const config = JSON.parse(testD1Config()) as { main?: string; d1_databases: { binding: string }[] };
    expect([config.main, config.d1_databases.map((entry) => entry.binding)]).toEqual([undefined, ["DB"]]);
  });
});

describe("dropStatements()", () => {
  const objects = [
    { type: "table", name: "users" },
    { type: "table", name: "posts" },
    { type: "table", name: "comments" },
    { type: "index", name: "posts_user" },
    { type: "view", name: "v" },
    { type: "trigger", name: "t" },
  ];

  it("drops triggers, views and indexes, then each table before the tables it references", () => {
    const parents = new Map([
      ["posts", ["users"]],
      ["comments", ["posts", "users"]],
    ]);
    expect(dropStatements(objects, parents)).toEqual([
      'DROP TRIGGER IF EXISTS "t"',
      'DROP VIEW IF EXISTS "v"',
      'DROP INDEX IF EXISTS "posts_user"',
      'DROP TABLE IF EXISTS "comments"',
      'DROP TABLE IF EXISTS "posts"',
      'DROP TABLE IF EXISTS "users"',
    ]);
  });

  it("ignores a table's reference to itself, and falls back to name order on a cycle", () => {
    const tables = [
      { type: "table", name: "b" },
      { type: "table", name: "a" },
      { type: "table", name: "tree" },
    ];
    const parents = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["tree", ["tree"]],
    ]);
    expect(dropStatements(tables, parents)).toEqual(['DROP TABLE IF EXISTS "tree"', 'DROP TABLE IF EXISTS "a"', 'DROP TABLE IF EXISTS "b"']);
  });

  it("quotes a name carrying a double quote", () => {
    expect(dropStatements([{ type: "table", name: 'a"b' }], new Map())).toEqual(['DROP TABLE IF EXISTS "a""b"']);
  });
});

// Each case is refused before a workerd process starts; what a started one does is `tests/workerd/test-d1.workerd.ts`'s.
describe("openTestD1() refusals", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "forge-d1-test-"));
    mkdirSync(join(root, "migrations"));
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config/numeric.ts"), "export default { migrations: 42 };");
    writeFileSync(join(root, "config/named.ts"), 'export const migrations = "migrations";');
    writeFileSync(join(root, "config/scoped.ts"), 'export default { migrations: "@nope/pkg/migrations" };');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a missing migrations directory by its path", async () => {
    await expect(openTestD1({ root, migrations: "nowhere" })).rejects.toThrow(`no migrations directory at ${join(root, "nowhere")}`);
  });

  it("refuses a host config path that does not exist", async () => {
    await expect(openTestD1({ root, hostConfig: "config/missing.ts" })).rejects.toThrow(
      "No db host config at `config/missing.ts` — `hostConfig` names a module that does not exist.",
    );
  });

  it("refuses a host config whose migrations is not a string, by field", async () => {
    await expect(openTestD1({ root, hostConfig: "config/numeric.ts" })).rejects.toThrow("config/numeric.ts: migrations: Invalid type");
  });

  it("refuses a host config with no default export rather than reading the default directory", async () => {
    await expect(openTestD1({ root, hostConfig: "config/named.ts" })).rejects.toThrow(
      "`config/named.ts` has no default export — a db host config module must `export default` the value it holds.",
    );
  });

  it("resolves a scoped migrations specifier through installed packages, refusing one none exports", async () => {
    await expect(openTestD1({ root, hostConfig: "config/scoped.ts" })).rejects.toThrow(
      `@nope/pkg/migrations names a module which no package installed under ${root} exports`,
    );
  });
});

// Detail strings as local D1 answered them (spike-261016-48).
const step = (detail: string): PlanStep => ({ id: 2, parent: 0, detail });

describe("usesIndex()", () => {
  it("matches a search and a scan through the named index, covering or not", () => {
    expect(usesIndex([step("SEARCH c USING COVERING INDEX c_p (p=?)")], "c_p")).toBe(true);
    expect(usesIndex([step("SEARCH users USING INDEX users_email (email=?)")], "users_email")).toBe(true);
    expect(usesIndex([step("SCAN posts USING INDEX posts_created")], "posts_created")).toBe(true);
  });

  it("does not match another index whose name the first one prefixes", () => {
    expect(usesIndex([step("SEARCH c USING INDEX c_p_2 (p=?)")], "c_p")).toBe(false);
  });

  it("does not match a full scan or the primary key", () => {
    expect(usesIndex([step("SCAN p"), step("SEARCH p USING INTEGER PRIMARY KEY (rowid=?)")], "c_p")).toBe(false);
  });
});

describe("scansTable()", () => {
  it("matches a step that reads every row of the table, by the name the query gives it", () => {
    expect(scansTable([step("SCAN p")], "p")).toBe(true);
    // `SELECT * FROM users u` plans as `SCAN u`: the alias is all D1 names.
    expect([scansTable([step("SCAN u")], "u"), scansTable([step("SCAN u")], "users")]).toEqual([true, false]);
  });

  it("does not match a scan through an index, a search, or another table", () => {
    expect(scansTable([step("SCAN p USING INDEX p_name"), step("SEARCH p USING INTEGER PRIMARY KEY (rowid=?)"), step("SCAN posts")], "p")).toBe(
      false,
    );
  });
});
