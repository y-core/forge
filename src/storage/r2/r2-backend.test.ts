import { describe, expect, it } from "bun:test";
import { r2Backend } from "./r2-backend";
import type { R2Bucket, R2Object, R2ObjectBody } from "./types";

function makeR2Object(key: string, overrides: Partial<R2Object> = {}): R2Object {
  return {
    key,
    version: "v1",
    size: 100,
    etag: "abc123",
    httpEtag: '"abc123"',
    uploaded: new Date("2026-01-01"),
    httpMetadata: { contentType: "text/plain" },
    ...overrides,
  };
}

function makeR2Body(key: string): R2ObjectBody {
  const obj = makeR2Object(key);
  const text = "hello";
  return {
    ...obj,
    body: new ReadableStream(),
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer as ArrayBuffer),
    text: () => Promise.resolve(text),
    blob: () => Promise.resolve(new Blob([text])),
  };
}

function makeBucket(): R2Bucket & { _store: Map<string, R2Object> } {
  const _store = new Map<string, R2Object>();
  return {
    _store,
    async put(key, _value, opts) {
      const obj = makeR2Object(key, {
        ...(opts?.httpMetadata !== undefined ? { httpMetadata: opts.httpMetadata } : {}),
        ...(opts?.customMetadata !== undefined ? { customMetadata: opts.customMetadata } : {}),
      });
      _store.set(key, obj);
      return obj;
    },
    async get(key) {
      const obj = _store.get(key);
      return obj ? makeR2Body(key) : null;
    },
    async head(key) {
      return _store.get(key) ?? null;
    },
    async delete(keys) {
      if (Array.isArray(keys)) for (const k of keys) _store.delete(k);
      else _store.delete(keys);
    },
    async list(opts) {
      const pfx = opts?.prefix ?? "";
      const objects = [..._store.values()].filter((o) => o.key.startsWith(pfx));
      return { objects, truncated: false };
    },
  };
}

describe("r2Backend", () => {
  it("put translates httpMetadata.contentType to StoredObject.contentType", async () => {
    const bucket = makeBucket();
    const backend = r2Backend(bucket);
    const obj = await backend.put("file.txt", "hello", { contentType: "text/plain" });
    expect(obj.contentType).toBe("text/plain");
    expect(obj.key).toBe("file.txt");
  });

  it("get returns null for missing key", async () => {
    const backend = r2Backend(makeBucket());
    expect(await backend.get("missing")).toBeNull();
  });

  it("head returns StoredObject for existing key", async () => {
    const bucket = makeBucket();
    const backend = r2Backend(bucket);
    await backend.put("doc.pdf", "data");
    const obj = await backend.head("doc.pdf");
    expect(obj).not.toBeNull();
    expect(obj?.key).toBe("doc.pdf");
  });

  it("delete removes a key", async () => {
    const bucket = makeBucket();
    const backend = r2Backend(bucket);
    await backend.put("temp", "x");
    await backend.delete("temp");
    expect(await backend.head("temp")).toBeNull();
  });

  it("list returns translated objects", async () => {
    const bucket = makeBucket();
    const backend = r2Backend(bucket);
    await backend.put("a.txt", "1");
    await backend.put("b.txt", "2");
    const res = await backend.list();
    expect(res.objects.map((o) => o.key).sort()).toEqual(["a.txt", "b.txt"]);
    expect(res.truncated).toBe(false);
  });

  it("name is 'r2'", () => {
    expect(r2Backend(makeBucket()).name).toBe("r2");
  });
});
