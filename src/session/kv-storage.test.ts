import { describe, expect, it } from "bun:test";
import { createSession } from "@remix-run/session";
import type { SessionKVBinding } from "./kv-storage";
import { createKVSessionStorage } from "./kv-storage";

/** Local 3-method fake typed to the structural contract (compile-breaks on drift). */
function fakeSessionKV(seed?: Record<string, string>) {
  const data = new Map<string, { value: string; ttl?: number }>(Object.entries(seed ?? {}).map(([k, v]) => [k, { value: v }]));
  const kv: SessionKVBinding = {
    get: async (key, _options) => data.get(key)?.value ?? null,
    put: async (key, value, options) => {
      data.set(key, { value, ...(options?.expirationTtl !== undefined ? { ttl: options.expirationTtl } : {}) });
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
  return { kv, data };
}

describe("createKVSessionStorage — read", () => {
  it("returns a fresh session for a null or empty cookie", async () => {
    const { kv } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const fresh = await storage.read(null);
    expect(typeof fresh.id).toBe("string");
    expect((await storage.read("")).id).not.toBe(fresh.id);
  });

  it("returns a fresh session for an unknown id", async () => {
    const { kv } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = await storage.read("no-such-id");
    expect(session.id).not.toBe("no-such-id");
  });

  it("fails soft on a corrupt stored record", async () => {
    const { kv } = fakeSessionKV({ "session:bad": "not json {" });
    const storage = createKVSessionStorage(kv);
    const session = await storage.read("bad");
    expect(session.id).not.toBe("bad");
    expect(session.get("anything")).toBeUndefined();
  });
});

describe("createKVSessionStorage — save/read round-trip", () => {
  it("persists dirty sessions under the prefixed id and reads them back", async () => {
    const { kv, data } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);

    const session = createSession();
    session.set("theme", "dark");
    const cookieValue = await storage.save(session);
    expect(cookieValue).toBe(session.id);
    expect(data.has(`session:${session.id}`)).toBe(true);

    const restored = await storage.read(session.id);
    expect(restored.id).toBe(session.id);
    expect(restored.get("theme")).toBe("dark");
  });

  it("returns null (no Set-Cookie) for an unchanged session", async () => {
    const { kv } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    expect(await storage.save(createSession())).toBeNull();
  });

  it("deletes the record and clears the cookie when destroyed", async () => {
    const { kv, data } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = createSession();
    session.set("k", "v");
    await storage.save(session);
    expect(data.size).toBe(1);

    session.destroy();
    const cookieValue = await storage.save(session);
    expect(cookieValue).toBe(""); // empty value → cookie cleared
    expect(data.size).toBe(0);
  });

  it("applies the configured prefix and sliding TTL on every save", async () => {
    const { kv, data } = fakeSessionKV();
    const storage = createKVSessionStorage(kv, { prefix: "sess", ttlSeconds: 3600 });
    const session = createSession();
    session.set("a", 1);
    await storage.save(session);
    const entry = data.get(`sess:${session.id}`);
    expect(entry?.ttl).toBe(3600);
  });
});
