import { describe, expect, it } from "bun:test";
import { createKVStore } from "../storage/kv/store";
import { fakeAssetsFetcher, fakeKV } from "./fakes";

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
