import { describe, expect, it } from "bun:test";
import { createD1Client } from "../storage/db/client";
import { sql } from "../storage/db/sql";
import { createKVStore } from "../storage/kv/store";
import { nullLogger } from "./context";
import { fakeAssetsFetcher, fakeD1, fakeKV, fakeR2 } from "./fakes";

describe("fakeKV", () => {
  it("round-trips put/get in text mode", async () => {
    const kv = fakeKV();
    await kv.put("k1", "hello");
    expect(await kv.get("k1", { type: "text" })).toBe("hello");
  });

  it("returns null for a missing key", async () => {
    const kv = fakeKV();
    expect(await kv.get("missing", { type: "text" })).toBeNull();
  });

  it("supports arrayBuffer mode", async () => {
    const kv = fakeKV();
    await kv.put("k1", "bytes");
    const buf = await kv.get("k1", { type: "arrayBuffer" });
    expect(buf).not.toBeNull();
    expect(new TextDecoder().decode(buf as ArrayBuffer)).toBe("bytes");
  });

  it("stores and returns metadata via getWithMetadata", async () => {
    const kv = fakeKV();
    await kv.put("k1", "v", { metadata: { tag: "t" } });
    const { value, metadata } = await kv.getWithMetadata("k1", { type: "text" });
    expect(value).toBe("v");
    expect(metadata).toEqual({ tag: "t" });
  });

  it("deletes keys", async () => {
    const kv = fakeKV({ gone: "soon" });
    await kv.delete("gone");
    expect(await kv.get("gone", { type: "text" })).toBeNull();
  });

  it("lists keys sorted, with prefix filtering and limit", async () => {
    const kv = fakeKV({ "b||2": "x", "a||1": "x", "c||3": "x" });
    const all = await kv.list();
    expect(all.keys.map((k) => k.name)).toEqual(["a||1", "b||2", "c||3"]);
    expect(all.list_complete).toBe(true);

    const prefixed = await kv.list({ prefix: "a||" });
    expect(prefixed.keys.map((k) => k.name)).toEqual(["a||1"]);

    const limited = await kv.list({ limit: 2 });
    expect(limited.keys).toHaveLength(2);
  });

  it("paginates via an offset-encoded cursor", async () => {
    const kv = fakeKV({ a: "1", b: "2", c: "3", d: "4", e: "5" });
    const first = await kv.list({ limit: 2 });
    expect(first.list_complete).toBe(false);
    expect(first.cursor).toBe("2");
    expect(first.keys.map((k) => k.name)).toEqual(["a", "b"]);

    const second = await kv.list({ limit: 2, cursor: first.cursor as string });
    expect(second.list_complete).toBe(false);
    expect(second.cursor).toBe("4");
    expect(second.keys.map((k) => k.name)).toEqual(["c", "d"]);

    const third = await kv.list({ limit: 2, cursor: second.cursor as string });
    expect(third.list_complete).toBe(true);
    expect(third.cursor).toBeUndefined();
    expect(third.keys.map((k) => k.name)).toEqual(["e"]);
  });

  it("surfaces expiration on listed keys when set", async () => {
    const kv = fakeKV();
    await kv.put("k1", "v", { expiration: 1234 });
    const listed = await kv.list();
    expect(listed.keys[0]).toEqual({ name: "k1", metadata: undefined, expiration: 1234 });
  });

  it("round-trips a non-UTF-8 byte sequence byte-identically", async () => {
    const kv = fakeKV();
    const original = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
    await kv.put("bin", original.buffer as ArrayBuffer);
    const raw = await kv.get("bin", { type: "arrayBuffer" });
    expect(raw).not.toBeNull();
    expect([...new Uint8Array(raw as ArrayBuffer)]).toEqual([0xff, 0xfe, 0x00, 0x80]);
  });

  it("returns a detached copy so mutating a read result cannot reach the store", async () => {
    const kv = fakeKV();
    await kv.put("bin", new Uint8Array([1, 2, 3]).buffer as ArrayBuffer);
    const first = new Uint8Array((await kv.get("bin", { type: "arrayBuffer" })) as ArrayBuffer);
    first[0] = 9;
    const second = await kv.get("bin", { type: "arrayBuffer" });
    expect([...new Uint8Array(second as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("records expirationTtl as an absolute expiration surfaced on list", async () => {
    const kv = fakeKV();
    const before = Math.floor(Date.now() / 1000);
    await kv.put("k1", "v", { expirationTtl: 60 });
    const after = Math.floor(Date.now() / 1000);
    const entry = (await kv.list()).keys[0];
    expect(entry?.name).toBe("k1");
    expect(entry?.expiration).toBeGreaterThanOrEqual(before + 60);
    expect(entry?.expiration).toBeLessThanOrEqual(after + 60);
  });

  it("prefers an explicit expiration over expirationTtl", async () => {
    const kv = fakeKV();
    await kv.put("k1", "v", { expiration: 1234, expirationTtl: 60 });
    const listed = await kv.list();
    expect(listed.keys[0]).toEqual({ name: "k1", metadata: undefined, expiration: 1234 });
  });
});

describe("fakeR2", () => {
  it("round-trips put/get with body accessors", async () => {
    const bucket = fakeR2();
    const put = await bucket.put("logo.svg", "<svg/>");
    expect(put.key).toBe("logo.svg");
    expect(put.size).toBe(6);

    const obj = await bucket.get("logo.svg");
    expect(obj).not.toBeNull();
    if (!obj) return;
    expect(await obj.text()).toBe("<svg/>");
    expect(new TextDecoder().decode(await obj.arrayBuffer())).toBe("<svg/>");
    expect(obj.bodyUsed).toBe(true);
  });

  it("returns null from get and head for a missing key", async () => {
    const bucket = fakeR2();
    expect(await bucket.get("missing")).toBeNull();
    expect(await bucket.head("missing")).toBeNull();
  });

  it("stores and reflects http/custom metadata on put and head", async () => {
    const bucket = fakeR2();
    await bucket.put("f", "body", { httpMetadata: { contentType: "text/plain" }, customMetadata: { owner: "u1" } });
    const head = await bucket.head("f");
    expect(head?.httpMetadata).toEqual({ contentType: "text/plain" });
    expect(head?.customMetadata).toEqual({ owner: "u1" });
  });

  it("deletes single and multiple keys", async () => {
    const bucket = fakeR2({ a: "1", b: "2", c: "3" });
    await bucket.delete("a");
    await bucket.delete(["b", "c"]);
    expect(await bucket.head("a")).toBeNull();
    expect(await bucket.head("b")).toBeNull();
    expect(await bucket.head("c")).toBeNull();
  });

  it("lists with prefix, limit and cursor pagination", async () => {
    const bucket = fakeR2({ "img/a": "1", "img/b": "2", "doc/c": "3" });
    const prefixed = await bucket.list({ prefix: "img/" });
    expect(prefixed.objects.map((o) => o.key)).toEqual(["img/a", "img/b"]);
    expect(prefixed.truncated).toBe(false);

    const first = await bucket.list({ limit: 1 });
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBe("1");
    const second = await bucket.list({ limit: 1, cursor: first.cursor });
    expect(second.objects[0]?.key).toBe("img/a");
  });

  it("seeds from a record", async () => {
    const bucket = fakeR2({ seeded: "hi" });
    const obj = await bucket.get("seeded");
    expect(await obj?.text()).toBe("hi");
  });

  it("returns exactly the requested slice for an offset+length range", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    const obj = await bucket.get("file", { range: { offset: 2, length: 3 } });
    expect(await obj?.text()).toBe("cde");
    expect([...new Uint8Array((await obj?.arrayBuffer()) as ArrayBuffer)]).toEqual([0x63, 0x64, 0x65]);
  });

  it("runs an offset-only range to the end of the object", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    const obj = await bucket.get("file", { range: { offset: 7 } });
    expect(await obj?.text()).toBe("hij");
  });

  it("counts a suffix range back from the end of the object", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    const obj = await bucket.get("file", { range: { suffix: 4 } });
    expect(await obj?.text()).toBe("ghij");
  });

  it("clamps a range that overruns the object and never throws", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    expect(await (await bucket.get("file", { range: { offset: 8, length: 100 } }))?.text()).toBe("ij");
    expect(await (await bucket.get("file", { range: { suffix: 100 } }))?.text()).toBe("abcdefghij");
    expect(await (await bucket.get("file", { range: { offset: 50 } }))?.text()).toBe("");
  });

  it("reports the full object size on a ranged read", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    const obj = await bucket.get("file", { range: { offset: 2, length: 3 } });
    expect(obj?.size).toBe(10);
  });

  it("streams only the ranged bytes through body", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    const obj = await bucket.get("file", { range: { offset: 1, length: 2 } });
    expect(obj).not.toBeNull();
    if (!obj) return;
    expect(await new Response(obj.body).text()).toBe("bc");
  });

  it("returns the whole object when no range is given", async () => {
    const bucket = fakeR2({ file: "abcdefghij" });
    const obj = await bucket.get("file");
    expect(await obj?.text()).toBe("abcdefghij");
  });
});

describe("fakeD1", () => {
  it("returns configured rows for all()", async () => {
    const db = fakeD1((sql) => (sql.includes("users") ? [{ id: 1 }, { id: 2 }] : []));
    const res = await db.prepare("SELECT * FROM users").bind().all<{ id: number }>();
    expect(res.success).toBe(true);
    expect(res.results).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("returns the first row (or a column) for first()", async () => {
    const db = fakeD1(() => [{ id: 7, name: "x" }]);
    expect(await db.prepare("SELECT 1").bind().first()).toEqual({ id: 7, name: "x" });
    expect(await db.prepare("SELECT 1").bind().first<number>("id")).toBe(7);
  });

  it("returns null from first() when there are no rows", async () => {
    const db = fakeD1(() => []);
    expect(await db.prepare("SELECT 1").bind().first()).toBeNull();
  });

  it("returns default meta from run()", async () => {
    const db = fakeD1();
    const res = await db.prepare("INSERT INTO t VALUES (?)").bind(1).run();
    expect(res).toEqual({ results: [], success: true, meta: { rows_written: 0, changes: 0, last_row_id: 0, duration: 0 } });
  });

  it("records bound calls with sql and params", async () => {
    const db = fakeD1();
    await db.prepare("SELECT * FROM t WHERE id = ?").bind(42).all();
    expect(db.calls).toEqual([{ sql: "SELECT * FROM t WHERE id = ?", params: [42] }]);
  });

  it("returns per-statement results from batch()", async () => {
    const db = fakeD1(() => [{ ok: true }]);
    const statements = [db.prepare("A").bind(), db.prepare("B").bind()];
    const results = await db.batch<{ ok: boolean }>(statements);
    expect(results.map((r) => r.results)).toEqual([[{ ok: true }], [{ ok: true }]]);
  });

  it("never fails when no failure injector is configured", async () => {
    const db = fakeD1(() => [{ id: 1 }]);
    const client = createD1Client(db, { logger: nullLogger });
    expect(await client.query(sql`SELECT 1`)).toEqual({ ok: true, data: [{ id: 1 }] });
    expect(await client.execute(sql`INSERT INTO t VALUES (${1})`)).toEqual({ ok: true, data: { rowsWritten: 0, lastRowId: 0 } });
  });

  it("drives a client's error branch through failOn", async () => {
    const failure = new Error("D1_ERROR: no such table: users");
    const db = fakeD1(() => [], { failOn: (sqlText) => (sqlText.includes("users") ? failure : null) });
    const client = createD1Client(db, { logger: nullLogger });

    const failed = await client.query(sql`SELECT * FROM users`);
    expect(failed).toEqual({ ok: false, error: failure });

    const passed = await client.query(sql`SELECT * FROM sessions`);
    expect(passed).toEqual({ ok: true, data: [] });
  });

  it("injects failures into execute, queryOne, batch and exec", async () => {
    const failure = new Error("D1_ERROR: database is locked");
    const db = fakeD1(() => [{ id: 1 }], { failOn: () => failure });
    const client = createD1Client(db, { logger: nullLogger });

    expect(await client.execute(sql`INSERT INTO t VALUES (${1})`)).toEqual({ ok: false, error: failure });
    expect(await client.queryOne(sql`SELECT 1`)).toEqual({ ok: false, error: failure });
    expect(await client.batch([sql`SELECT 1`])).toEqual({ ok: false, error: failure });
    const thrownByExec = await db.exec("VACUUM").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrownByExec).toBe(failure);
  });

  it("passes the executed sql and bound params to failOn", async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    const db = fakeD1(() => [], {
      failOn: (sqlText, params) => {
        seen.push({ sql: sqlText, params });
        return null;
      },
    });
    await createD1Client(db, { logger: nullLogger }).query(sql`SELECT * FROM t WHERE id = ${42}`);
    expect(seen).toEqual([{ sql: "SELECT * FROM t WHERE id = ?", params: [42] }]);
  });

  it("works as the binding behind a real createKVStore", async () => {
    const store = createKVStore<{ theme: string }>(fakeKV(), { prefix: "settings" });
    const set = await store.set("user-1", { theme: "dark" });
    expect(set.ok).toBe(true);
    const got = await store.get("user-1");
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data).toEqual({ theme: "dark" });
  });
});

describe("fakeAssetsFetcher", () => {
  it("serves a known path with 200 and the exact body", async () => {
    const assets = fakeAssetsFetcher({ "/assets/css/main.css": "body{color:red}" });
    const res = await assets.fetch(new Request("http://test/assets/css/main.css"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body{color:red}");
  });

  it("returns 404 with a Not Found body for unknown paths", async () => {
    const assets = fakeAssetsFetcher({});
    const res = await assets.fetch(new Request("http://test/missing.js"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});
