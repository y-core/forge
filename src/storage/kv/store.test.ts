import { describe, expect, it } from "bun:test";
import { fakeKV } from "../../testing/fakes";
import { bytesCodec, textCodec } from "./codec";
import { createKVStore } from "./store";
import type { KVListResult, KVNamespace } from "./types";

/** Hands out a copy of a stored `ArrayBuffer` so a caller mutating what it read cannot reach back into the store. */
function copyOut(value: string | ArrayBuffer): string | ArrayBuffer {
  return typeof value === "string" ? value : value.slice(0);
}

function makeKVStub(): KVNamespace & { _store: Map<string, { value: string | ArrayBuffer; metadata?: unknown }> } {
  const _store = new Map<string, { value: string | ArrayBuffer; metadata?: unknown }>();

  const ns = {
    get(key: string, opts: { type: "text" | "arrayBuffer" }): Promise<string | ArrayBuffer | null> {
      const entry = _store.get(key);
      if (!entry) return Promise.resolve(null);
      if (opts.type === "arrayBuffer") return Promise.resolve(copyOut(entry.value) as ArrayBuffer);
      return Promise.resolve(entry.value as string);
    },
    getWithMetadata(key: string, _opts: { type: "text" | "arrayBuffer" }): Promise<{ value: string | ArrayBuffer | null; metadata: unknown }> {
      const entry = _store.get(key);
      if (!entry) return Promise.resolve({ value: null, metadata: null });
      return Promise.resolve({ value: copyOut(entry.value), metadata: entry.metadata ?? null });
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
      const keys = [..._store.keys()].filter((k) => k.startsWith(pfx)).map((name) => ({ name, metadata: _store.get(name)?.metadata }));
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
    expect(stub._store.has("sess||abc")).toBe(true);
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
    const factory = async () => {
      calls++;
      return 99;
    };

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

describe("createKVStore — bytesCodec round-trip", () => {
  it("stores only the subarray window, not its backing buffer", async () => {
    const store = createKVStore<Uint8Array>(fakeKV(), { codec: bytesCodec() });
    await store.set("blob", new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(2, 4));
    const res = await store.get("blob");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Array.from(res.data ?? [])).toEqual([3, 4]);
  });

  it("stores a whole-buffer Uint8Array unchanged", async () => {
    const store = createKVStore<Uint8Array>(fakeKV(), { codec: bytesCodec() });
    await store.set("blob", new Uint8Array([1, 2, 3, 4, 5, 6]));
    const res = await store.get("blob");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Array.from(res.data ?? [])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  for (const [label, makeNs] of [
    ["makeKVStub", makeKVStub],
    ["fakeKV", fakeKV],
  ] as const) {
    it(`${label}: mutating a retrieved value does not change what the next read returns`, async () => {
      const store = createKVStore<Uint8Array>(makeNs(), { codec: bytesCodec() });
      await store.set("blob", new Uint8Array([1, 2, 3]));

      const first = await store.get("blob");
      expect(first.ok).toBe(true);
      if (!first.ok || !first.data) return;
      first.data[0] = 99;

      const second = await store.get("blob");
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(Array.from(second.data ?? [])).toEqual([1, 2, 3]);
    });
  }
});

describe("createKVStore — || key rejection", () => {
  it("get with a valid key does not throw", async () => {
    const store = createKVStore(makeKVStub());
    const res = await store.get("valid-key");
    expect(res.ok).toBe(true);
  });

  it("get with a key containing || returns ok:false with a message referencing ||", async () => {
    const store = createKVStore(makeKVStub());
    const res = await store.get("prefix||suffix");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("||");
  });

  it("set with a key containing || returns ok:false with a message referencing ||", async () => {
    const store = createKVStore(makeKVStub());
    const res = await store.set("prefix||suffix", "value");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("||");
  });

  it("delete with a key containing || returns ok:false with a message referencing ||", async () => {
    const store = createKVStore(makeKVStub());
    const res = await store.delete("prefix||suffix");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("||");
  });
});
