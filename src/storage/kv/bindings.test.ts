import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { resolveKVStore, validateKVBinding } from "./bindings";
import type { KVNamespace } from "./types";

const stubNs = {
  get: () => Promise.resolve(null),
  getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ keys: [], list_complete: true }),
} as unknown as KVNamespace;

describe("resolveKVStore", () => {
  it("returns a KVStore when the binding is present", async () => {
    const app = new Hono<{ Bindings: { KV: KVNamespace } }>();
    app.get("/", (c) => {
      const store = resolveKVStore(c, { binding: (ctx) => (ctx.env as { KV?: KVNamespace }).KV });
      return c.json({ hasStore: store !== null });
    });
    const res = await app.request("/", {}, { KV: stubNs });
    expect(await res.json()).toEqual({ hasStore: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));
    app.get("/", (c) => {
      resolveKVStore(c, { binding: () => undefined });
      return c.text("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      const store = resolveKVStore(c, { binding: () => undefined, required: false });
      return c.json({ hasStore: store !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasStore: false });
  });
});

describe("validateKVBinding", () => {
  it("passes when the binding exists", async () => {
    const app = new Hono<{ Bindings: { MY_KV: KVNamespace } }>();
    app.use("*", validateKVBinding("MY_KV"));
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", {}, { MY_KV: stubNs });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));
    app.use("*", validateKVBinding("MY_KV"));
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });
});
