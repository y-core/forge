import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { resolveObjectStore, validateR2Binding } from "./bindings";
import type { R2Bucket, R2Object } from "./types";

function makeR2Stub(): R2Bucket {
  const obj: R2Object = {
    key: "test",
    version: "v1",
    size: 0,
    etag: "abc",
    httpEtag: '"abc"',
    uploaded: new Date(),
  };
  return {
    put: async () => obj,
    get: async () => null,
    head: async () => null,
    delete: async () => {},
    list: async () => ({ objects: [], truncated: false }),
  };
}

describe("resolveObjectStore", () => {
  it("returns an ObjectStore when the binding is present", async () => {
    const app = new Hono<{ Bindings: { BUCKET: R2Bucket } }>();
    app.get("/", (c) => {
      const store = resolveObjectStore(c, { binding: (ctx) => (ctx.env as { BUCKET?: R2Bucket }).BUCKET });
      return c.json({ hasStore: store !== null });
    });
    const res = await app.request("/", {}, { BUCKET: makeR2Stub() });
    expect(await res.json()).toEqual({ hasStore: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));
    app.get("/", (c) => {
      resolveObjectStore(c, { binding: () => undefined });
      return c.text("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      const store = resolveObjectStore(c, { binding: () => undefined, required: false });
      return c.json({ hasStore: store !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasStore: false });
  });
});

describe("validateR2Binding", () => {
  it("passes when the binding exists", async () => {
    const app = new Hono<{ Bindings: { MY_BUCKET: R2Bucket } }>();
    app.use("*", validateR2Binding("MY_BUCKET"));
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", {}, { MY_BUCKET: makeR2Stub() });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Hono();
    app.onError((err, c) => c.text(err.message, 500));
    app.use("*", validateR2Binding("MY_BUCKET"));
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });
});
