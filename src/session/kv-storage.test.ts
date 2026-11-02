import { describe, expect, it } from "bun:test";

import { createSession } from "@remix-run/session";

import { createKVSessionStorage } from "./kv-storage";
import { trackSessionId } from "./tracked";
import type { SessionKVBinding } from "./types";

function fakeSessionKV(seed?: Record<string, string>) {
  const data = new Map<string, { value: string; ttl?: number }>(Object.entries(seed ?? {}).map(([k, v]) => [k, { value: v }]));
  const gets: string[] = [];
  const puts: string[] = [];
  const deletes: string[] = [];
  const kv: SessionKVBinding = {
    get: async (key, _options) => {
      gets.push(key);
      return data.get(key)?.value ?? null;
    },
    put: async (key, value, options) => {
      puts.push(key);
      data.set(key, { value, ...(options?.expirationTtl !== undefined ? { ttl: options.expirationTtl } : {}) });
    },
    delete: async (key) => {
      deletes.push(key);
      data.delete(key);
    },
  };
  return { kv, data, gets, puts, deletes };
}

describe("createKVSessionStorage — read", () => {
  it("returns a fresh session for a null or empty cookie", async () => {
    const { kv } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const fresh = await storage.read(null);
    expect(typeof fresh.id).toBe("string");
    expect((await storage.read("")).id).not.toBe(fresh.id);
  });

  it("restores an unknown id under the same id, holding no data", async () => {
    const { kv } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = await storage.read("no-such-id");
    expect(session.id).toBe("no-such-id");
    expect(session.get("anything")).toBeUndefined();
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

  it("refuses an empty prefix, which would key every session under a bare `:id`", () => {
    expect(() => createKVSessionStorage(fakeSessionKV().kv, { prefix: "" })).toThrow(
      "createKVSessionStorage: `prefix` must not be an empty string",
    );
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

describe("createKVSessionStorage — a session holding no data", () => {
  it("skips the put for a dirty session holding no data, and still returns its id", async () => {
    const { kv, data, puts } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = createSession();
    session.set("k", "v");
    session.unset("k");

    expect(session.dirty).toBe(true);
    expect(await storage.save(session)).toBe(session.id);
    expect(puts).toEqual([]);
    expect(data.size).toBe(0);
  });

  it("writes no record and deletes nothing for a first-visit session dirtied only by reading its id", async () => {
    const { kv, data, puts, deletes } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = trackSessionId(createSession(), null);
    const id = session.id;

    expect(session.dirty).toBe(true);
    expect(await storage.save(session)).toBe(id);
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(data.size).toBe(0);
  });

  it("restores the unwritten first-visit id on the next request, empty and not dirty", async () => {
    const { kv, puts } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const first = trackSessionId(createSession(), null);
    const id = first.id;
    const cookie = await storage.save(first);
    if (cookie === null) throw new Error("the first visit issued no cookie");

    const restored = trackSessionId(await storage.read(cookie), cookie);
    expect(restored.id).toBe(id);
    expect(restored.get("anything")).toBeUndefined();
    expect(restored.dirty).toBe(false);
    expect(await storage.save(restored)).toBeNull();
    expect(puts).toEqual([]);
  });

  it("deletes the stored record when a persisted session is emptied", async () => {
    const { kv, data, puts, deletes } = fakeSessionKV({ "session:abc": JSON.stringify([{ k: "v" }, {}]) });
    const storage = createKVSessionStorage(kv);
    const session = await storage.read("abc");
    expect(session.get("k")).toBe("v");
    session.unset("k");

    expect(await storage.save(session)).toBe("abc");
    expect(data.has("session:abc")).toBe(false);
    expect(deletes).toEqual(["session:abc"]);
    expect(puts).toEqual([]);
  });

  it("deletes nothing when an emptied session never had a stored record", async () => {
    const { kv, gets, puts, deletes } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = await storage.read("ghost");
    session.set("k", "v");
    session.unset("k");

    expect(await storage.save(session)).toBe("ghost");
    expect(gets).toEqual(["session:ghost", "session:ghost"]);
    expect(deletes).toEqual([]);
    expect(puts).toEqual([]);
  });

  it("still writes a session holding only outgoing flash", async () => {
    const { kv, puts } = fakeSessionKV();
    const storage = createKVSessionStorage(kv);
    const session = createSession();
    session.flash("notice", "saved");

    expect(await storage.save(session)).toBe(session.id);
    expect(puts).toEqual([`session:${session.id}`]);
    expect((await storage.read(session.id)).get("notice")).toBe("saved");
  });
});
