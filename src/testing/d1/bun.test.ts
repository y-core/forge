import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createConsumerInstall, entrySource, TYPECHECK_TIMEOUT } from "../../tooling/assets/consumer.fixture";
import { openBunD1 } from "./bun";
import type { TestD1 } from "./types";

const USERS = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, avatar BLOB);";
const POSTS =
  "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users (id));\nCREATE INDEX posts_user ON posts (user_id);";

let root: string;
let db: TestD1;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "forge-d1-bun-test-"));
  mkdirSync(join(root, "migrations"));
  // Lexical order applies `10_` before `9_`, and `posts` cannot reference a `users` that does not exist yet.
  writeFileSync(join(root, "migrations", "9_users.sql"), USERS);
  writeFileSync(join(root, "migrations", "10_posts.sql"), POSTS);
  db = await openBunD1({ root, migrations: "migrations" });
});

afterAll(async () => {
  await db.dispose();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => db.reset());

describe("openBunD1()", () => {
  it("applies the migrations by number, not by name", async () => {
    expect(await db.rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).toEqual([{ name: "posts" }, { name: "users" }]);
  });

  it("reads the migrations directory its default host config names", async () => {
    const app = mkdtempSync(join(tmpdir(), "forge-d1-bun-host-"));
    mkdirSync(join(app, "config"));
    mkdirSync(join(app, "sql"));
    writeFileSync(join(app, "config", "db.config.ts"), 'export default { migrations: "sql" };');
    writeFileSync(join(app, "sql", "0001_notes.sql"), "CREATE TABLE notes (id INTEGER PRIMARY KEY);");
    const hosted = await openBunD1({ root: app });
    try {
      expect(await hosted.rows("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([{ name: "notes" }]);
    } finally {
      await hosted.dispose();
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("is the function the testing/d1/bun subpath hands a bun test", async () => {
    const published = (await import("@y-core/forge/testing/d1/bun")) as { openBunD1: unknown };
    expect(published.openBunD1).toBe(openBunD1);
  });

  it("refuses a missing migrations directory by its path", async () => {
    await expect(openBunD1({ root, migrations: "nowhere" })).rejects.toThrow(`openBunD1: no migrations directory at ${join(root, "nowhere")}`);
  });

  it("names the migration that failed to apply", async () => {
    const broken = mkdtempSync(join(tmpdir(), "forge-d1-bun-broken-"));
    writeFileSync(join(broken, "0001_broken.sql"), "CREATE TABLE;");
    try {
      await expect(openBunD1({ migrations: broken })).rejects.toThrow("openBunD1: 0001_broken.sql failed to apply");
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it("enforces foreign keys", async () => {
    await expect(db.binding.prepare("INSERT INTO posts (id, user_id) VALUES (1, 99)").run()).rejects.toThrow("FOREIGN KEY constraint failed");
  });

  it("rolls the whole batch back when one statement fails", async () => {
    const insert = db.binding.prepare("INSERT INTO users (id, email) VALUES (?, ?)");

    await expect(db.binding.batch([insert.bind(1, "a@example.com"), insert.bind(2, "a@example.com")])).rejects.toThrow("UNIQUE constraint failed");
    expect(await db.rows("SELECT id FROM users")).toEqual([]);
  });

  it("answers each statement of a batch with its rows and its changes", async () => {
    const { binding } = db;
    const results = await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare("SELECT id, email FROM users"),
    ]);

    expect(results.map(({ results: rows, meta }) => ({ rows, changes: meta.changes }))).toEqual([
      { rows: [], changes: 1 },
      { rows: [{ id: 1, email: "a@example.com" }], changes: 0 },
    ]);
  });

  it("reads one column with first(column), and refuses a column the row does not carry as D1 does", async () => {
    await db.binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')").run();
    const select = db.binding.prepare("SELECT email FROM users WHERE id = ?");

    expect(await select.bind(1).first("email")).toBe("a@example.com");
    expect(await select.bind(2).first("email")).toBeNull();
    await expect(select.bind(1).first("id")).rejects.toThrow("D1_ERROR: no such column: id");
  });

  it("answers a BLOB as the array of byte values D1 answers", async () => {
    await db.binding
      .prepare("INSERT INTO users (id, email, avatar) VALUES (1, 'a@example.com', ?)")
      .bind(new Uint8Array([1, 2, 255]))
      .run();

    expect(await db.binding.prepare("SELECT avatar FROM users").first("avatar")).toEqual([1, 2, 255]);
  });

  it("refuses a statement another binding prepared", async () => {
    const foreign = {
      bind: () => foreign,
      first: async () => null,
      run: async () => ({ results: [], success: true, meta: {} }),
      all: async () => ({ results: [], success: true, meta: {} }),
    };

    await expect(db.binding.batch([foreign])).rejects.toThrow("a batch takes only statements this binding prepared");
  });

  it("resets to the migrated schema, dropping rows and every object the app added", async () => {
    await db.binding.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com');\nCREATE TABLE extra (id INTEGER);");
    await db.binding.prepare("INSERT INTO posts (id, user_id) VALUES (1, 1)").run();

    await db.reset();

    expect({
      users: await db.rows("SELECT id FROM users"),
      tables: await db.rows("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name"),
    }).toEqual({ users: [], tables: [{ name: "posts" }, { name: "posts_user" }, { name: "users" }] });
  });
});

describe("the testing/d1/bun entry, type-checked by a consumer without wrangler", () => {
  const consumer = createConsumerInstall("forge-d1-bun-consumer");

  afterAll(() => {
    consumer.dispose();
  });

  it(
    "cannot resolve testing/d1, whose openTestD1 imports wrangler, so a clean check is not one wrangler made",
    () => {
      const { status, output } = consumer.typecheck(entrySource("testing/d1"));
      expect(status).not.toBe(0);
      expect(output).toContain("Cannot find module 'wrangler'");
    },
    TYPECHECK_TIMEOUT,
  );

  it.each([
    { name: "the whole entry", source: entrySource("testing/d1/bun") },
    {
      name: "openBunD1 with TestD1 named beside it",
      source: [
        'import { openBunD1, type TestD1 } from "@y-core/forge/testing/d1/bun";',
        "",
        "export const open: (options?: { root?: string }) => Promise<TestD1> = openBunD1;",
        "",
      ].join("\n"),
    },
    {
      name: "TestD1 and OpenTestD1Options imported as types alone",
      source: [
        'import type { OpenTestD1Options, TestD1 } from "@y-core/forge/testing/d1/bun";',
        "",
        'export type Opened = [OpenTestD1Options["migrations"], TestD1["binding"]];',
        "",
      ].join("\n"),
    },
  ])(
    "type-checks $name clean",
    ({ source }) => {
      const { status, output } = consumer.typecheck(source);
      expect(output).not.toContain("error TS");
      expect(status).toBe(0);
    },
    TYPECHECK_TIMEOUT,
  );

  it(
    "refuses a consumer that misuses the TestD1 it imported, so a clean check is one the types were read for",
    () => {
      const { status, output } = consumer.typecheck(
        ['import type { TestD1 } from "@y-core/forge/testing/d1/bun";', "", 'export const reset: TestD1["reset"] = () => 1;', ""].join("\n"),
      );
      expect(status).not.toBe(0);
      expect(output).toContain("error TS2322");
    },
    TYPECHECK_TIMEOUT,
  );
});
