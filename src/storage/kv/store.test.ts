import { describe, expect, it } from "bun:test";
import { textCodec } from "./codec";
import { createKVStore } from "./store";
import type { KVListResult, KVNamespace } from "./types";

function makeKVStub(): KVNamespace & { _store: Map<string, { value: string | ArrayBuffer; metadata?: unknown }> } {
  const _store = new Map<string, { value: string | ArrayBuffer; metadata?: unknown }>();

  const ns = {
    get(key: string, opts: { type: "text" | "arrayBuffer" }): Promise<string | ArrayBuffer | null> {
      const entry = _store.get(key);
      if (!entry) return Promise.resolve(null);
      if (opts.type === "arrayBuffer") return Promise.resolve(entry.value as ArrayBuffer);
      return Promise.resolve(entry.value as string);
    },
    getWithMetadata(key: string, _opts: { type: "text" | "arrayBuffer" }): Promise<{ value: string | ArrayBuffer | null; metadata: unknown }> {
      const entry = _store.get(key);
      if (!entry) return Promise.resolve({ value: null, metadata: null });
      return Promise.resolve({ value: entry.value, metadata: entry.metadata ?? null });
    },
    put(key: string, value: string | ArrayBuffer, opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
      _store.set(key, { value, metadata: opts?.metadata });
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      _store.delete(key);
      return Promise.resolve();
    },
    list(opts?: { prefix?: string }): Promise<KVListResult> {
      const pfx = opts?.prefix ?? "";
      const keys = [..._store.keys()]
        .filter((k) => k.startsWith(pfx))
        .map((name) => ({ name, metadata: _store.get(name)?.metadata }));
      return Promise.resolve({ keys, list_complete: true });
    },
    _store,
  } as unknown as KVNamespace & { _store: typeof _store };

  return ns;
}

describe("createKVStore — basic get/set/delete", () => {
  it("returns null for a missing key", async () => {
    const store = createKVStore(makeKVStub());
    const res = await store.get("missing");
    expect(res).toEqual({ ok: true, data: null });
  });

  it("stores and retrieves a JSON value", async () => {
    const stub = makeKVStub();
    const store = createKVStore<{ name: string }>(stub);
    await store.set("u1", { name: "Alice" });
    const res = await store.get("u1");
    expect(res).toEqual({ ok: true, data: { name: "Alice" } });
  });

  it("deletes a key", async () => {
    const stub = makeKVStub();
    const store = createKVStore(stub);
    await store.set("k", "v");
    await store.delete("k");
    const res = await store.get("k");
    expect(res).toEqual({ ok: true, data: null });
  });
});

describe("createKVStore — prefix round-trip", () => {
  it("prepends prefix to stored keys", async () => {
    const stub = makeKVStub();
    const store = createKVStore(stub, { prefix: "sess" });
    await store.set("abc", "data");
    expect(stub._store.has("sess:abc")).toBe(true);
  });

  it("strips prefix from list results", async () => {
    const stub = makeKVStub();
    const store = createKVStore(stub, { prefix: "sess" });
    await store.set("a", "1");
    await store.set("b", "2");
    const res = await store.list();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const names = res.data.keys.map((k) => k.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names.every((n) => !n.startsWith("sess:"))).toBe(true);
  });
});

describe("createKVStore — getOrSet (cache-aside)", () => {
  it("calls factory only on a miss, not on a hit", async () => {
    const stub = makeKVStub();
    const store = createKVStore<number>(stub);
    let calls = 0;
    const factory = async () => { calls++; return 99; };

    const first = await store.getOrSet("counter", factory, { ttl: 60 });
    expect(first).toEqual({ ok: true, data: 99 });
    expect(calls).toBe(1);

    const second = await store.getOrSet("counter", factory, { ttl: 60 });
    expect(second).toEqual({ ok: true, data: 99 });
    expect(calls).toBe(1);
  });
});

describe("createKVStore — session use-case smoke test", () => {
  it("sets, reads, and deletes a session entry", async () => {
    const stub = makeKVStub();
    const store = createKVStore<{ userId: string }>(stub, { prefix: "session" });

    await store.set("sid-1", { userId: "u42" }, { ttl: 3600 });
    const hit = await store.get("sid-1");
    expect(hit).toEqual({ ok: true, data: { userId: "u42" } });

    await store.delete("sid-1");
    const miss = await store.get("sid-1");
    expect(miss).toEqual({ ok: true, data: null });
  });
});

describe("createKVStore — log-sink write smoke test", () => {
  it("appends a log entry as a text-codec value", async () => {
    const stub = makeKVStub();
    const store = createKVStore<string>(stub, { codec: textCodec() });
    await store.set("log:2026-01-01", "event happened");
    const res = await store.get("log:2026-01-01");
    expect(res).toEqual({ ok: true, data: "event happened" });
  });
});
