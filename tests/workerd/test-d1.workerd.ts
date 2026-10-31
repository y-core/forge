// `openTestD1` as a consumer meets it: real migrations on wrangler's local D1, with nothing faked.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { createD1Client } from "../../src/storage/db/client";
import { classifyD1Error } from "../../src/storage/db/failure";
import { incomingBookmark } from "../../src/storage/db/session";
import { sql } from "../../src/storage/db/sql";
import { uuidFromBytes, uuidToBytes, uuidv7 } from "../../src/storage/db/uuid";
import { explainPlan, openTestD1, scansTable, type TestD1, usesIndex } from "../../src/testing/d1";

let root: string;
let db: TestD1;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "forge-test-d1-"));
  mkdirSync(join(root, "config", "db", "migrations"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(root, "config", "db.config.ts"), 'export default { migrations: "config/db/migrations" };\n');
  const write = (name: string, sql: string) => writeFileSync(join(root, "config", "db", "migrations", name), sql);
  // By name, `10_` sorts before `1_` and `2_`, and would index a table that does not exist yet.
  write("1_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);");
  write("2_posts.sql", "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE);");
  write("3_keyed.sql", "CREATE TABLE keyed (id BLOB PRIMARY KEY NOT NULL);");
  write("10_posts_user.sql", "CREATE INDEX posts_user ON posts (user_id);\nCREATE VIEW post_count AS SELECT count(*) AS n FROM posts;");
  db = await openTestD1({ root });
});

test.afterAll(async () => {
  await db?.dispose();
  rmSync(root, { recursive: true, force: true });
});

test("applies the migrations in wrangler's number order, read from the host config", async () => {
  expect(await db.rows("SELECT name FROM sqlite_master WHERE name = 'posts_user'")).toEqual([{ name: "posts_user" }]);
});

test("refuses a foreign-key violation, with no PRAGMA set", async () => {
  const thrown = await db.binding
    .prepare("INSERT INTO posts (id, user_id) VALUES (1, 99)")
    .run()
    .catch((error: unknown) => error);
  expect(String(thrown)).toContain("FOREIGN KEY constraint failed");
});

test("rolls a batch back whole when a later statement fails", async () => {
  const insert = (id: number, email: string) => db.binding.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(id, email);
  await expect(db.binding.batch([insert(1, "a@example.com"), insert(2, "a@example.com")])).rejects.toThrow("UNIQUE constraint failed");
  expect(await db.rows("SELECT id FROM users")).toEqual([]);
});

test("classifies a real D1 error through classifyD1Error", async () => {
  await db.binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')").run();
  const thrown = await db.binding
    .prepare("INSERT INTO users (id, email) VALUES (2, 'a@example.com')")
    .run()
    .catch((error: unknown) => error);
  const failure = classifyD1Error(thrown);
  expect([failure.kind, failure.constraint]).toEqual(["constraint", { rule: "unique", name: "users.email" }]);
});

test("reset() empties every table and re-applies the migrations, on the same handle", async () => {
  await db.binding.prepare("INSERT INTO posts (id, user_id) VALUES (1, 1)").run();
  await db.reset();
  expect(await db.rows("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM posts) AS posts")).toEqual([{ users: 0, posts: 0 }]);
  expect(await db.rows("SELECT type, name FROM sqlite_master WHERE name IN ('posts_user', 'post_count') ORDER BY name")).toEqual([
    { type: "view", name: "post_count" },
    { type: "index", name: "posts_user" },
  ]);
});

test("gives two handles over the same migrations two databases", async () => {
  const other = await openTestD1({ root });
  try {
    await other.binding.prepare("INSERT INTO users (id, email) VALUES (7, 'other@example.com')").run();
    await db.binding.prepare("INSERT INTO users (id, email) VALUES (8, 'mine@example.com')").run();
    expect([await other.rows("SELECT id FROM users"), await db.rows("SELECT id FROM users")]).toEqual([[{ id: 7 }], [{ id: 8 }]]);
  } finally {
    await other.dispose();
  }
});

test("explains a query's plan, telling an indexed read from a full scan", async () => {
  const indexed = await explainPlan(db, sql`SELECT id FROM posts WHERE user_id = ${1}`);
  const scanned = await explainPlan(db, sql`SELECT id FROM users WHERE email LIKE ${"%@example.com"}`);
  expect([usesIndex(indexed, "posts_user"), scansTable(indexed, "posts")]).toEqual([true, false]);
  expect([usesIndex(scanned, "posts_user"), scansTable(scanned, "users")]).toEqual([false, true]);
});

test("reports a full scan of an aliased table by the alias, which is the name D1's plan gives it", async () => {
  const plan = await explainPlan(db, sql`SELECT u.id FROM users AS u WHERE u.email LIKE ${"%@example.com"}`);
  expect([plan.map((step) => step.detail), scansTable(plan, "u")]).toEqual([["SCAN u"], true]);
});

test("reads 150 integer ids through one json_each parameter, by the primary key", async () => {
  await db.reset();
  const insert = (id: number) => db.binding.prepare("INSERT INTO users (id, email) VALUES (?, ?)").bind(id, `u${id}@example.com`);
  await db.binding.batch(Array.from({ length: 160 }, (_, i) => insert(i + 1)));
  const wanted = Array.from({ length: 150 }, (_, i) => i + 5);
  const fragment = sql`SELECT id FROM users WHERE id IN (SELECT value FROM json_each(${JSON.stringify(wanted)})) ORDER BY id`;

  const read = await createD1Client(db.binding).query<{ id: number }>(fragment);
  expect([fragment.params.length, read.ok ? read.data.map((row) => row.id) : read.error.message]).toEqual([1, wanted]);
  expect(scansTable(await explainPlan(db, fragment), "users")).toBe(false);
});

test("reads BLOB uuid keys from their strings through unhex(value, '-'), by the key's index", async () => {
  await db.reset();
  const keys = Array.from({ length: 160 }, () => uuidv7());
  await db.binding.batch(keys.map((key) => db.binding.prepare("INSERT INTO keyed (id) VALUES (?)").bind(uuidToBytes(key))));
  const wanted = keys.slice(5, 155);
  const fragment = sql`SELECT id FROM keyed WHERE id IN (SELECT unhex(value, '-') FROM json_each(${JSON.stringify(wanted)})) ORDER BY id`;

  const read = await createD1Client(db.binding).query<{ id: number[] }>(fragment);
  const plan = await explainPlan(db, fragment);
  expect(read.ok ? read.data.map((row) => uuidFromBytes(new Uint8Array(row.id))) : read.error.message).toEqual([...wanted].sort());
  expect([usesIndex(plan, "sqlite_autoindex_keyed_1"), scansTable(plan, "keyed")]).toEqual([true, false]);
});

test("matches no row for an empty json_each list, without a syntax error", async () => {
  await db.reset();
  await db.binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')").run();
  const read = await createD1Client(db.binding).query(sql`SELECT id FROM users WHERE id IN (SELECT value FROM json_each(${"[]"}))`);
  expect(read.ok ? read.data : read.error.message).toEqual([]);
});

test("resumes a session from the bookmark the engine returned, read back through d1Sessions' parsing", async () => {
  await db.reset();
  const first = db.binding.withSession?.("first-primary");
  if (first === undefined) throw new Error("local D1 has no withSession");
  await first.prepare("INSERT INTO users (id, email) VALUES (41, 'session@example.com')").run();
  const sent = new Request("http://app/", { headers: { "x-d1-bookmark": first.getBookmark() ?? "" } });
  const bookmark = incomingBookmark(sent, { header: "x-d1-bookmark" });
  // Local D1 has no replica, so this proves the engine takes its own bookmark back, not that a replica waits for it.
  const resumed = db.binding.withSession?.(bookmark ?? "unparsed");
  expect([bookmark, (await resumed?.prepare("SELECT id FROM users WHERE id = 41").all())?.results]).toEqual([first.getBookmark(), [{ id: 41 }]]);
});
