import { describe, expect, it } from "bun:test";
import { createKVStore } from "../storage/kv/store";
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
