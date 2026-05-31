import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { resolveD1Client, validateD1Binding } from "./bindings";
import type { D1Database, D1PreparedStatement, D1Result } from "./types";

const stubDb: D1Database = {
  prepare(): D1PreparedStatement {
    return {
      bind() { return this; },
      all<T>(): Promise<D1Result<T>> { return Promise.resolve({ results: [], success: true, meta: {} }); },
      first<T>(): Promise<T | null> { return Promise.resolve(null); },
      run(): Promise<D1Result<unknown>> { return Promise.resolve({ results: [], success: true, meta: {} }); },
    };
  },
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
};

describe("resolveD1Client", () => {
  it("returns a D1Client when the binding is present", async () => {
    const app = new Hono<{ Bindings: { DB: D1Database } }>();
    app.get("/", (c) => {
      const client = resolveD1Client(c, { binding: (ctx) => (ctx.env as { DB?: D1Database }).DB });
      return c.json({ hasClient: client !== null });
    });
    const res = await app.request("/", {}, { DB: stubDb });
    expect(await res.json()).toEqual({ hasClient: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      resolveD1Client(c, { binding: () => undefined });
      return c.text("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Hono();
    app.get("/", (c) => {
      const client = resolveD1Client(c, { binding: () => undefined, required: false });
      return c.json({ hasClient: client !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasClient: false });
  });
});

describe("validateD1Binding", () => {
  it("passes when the binding exists", async () => {
    const app = new Hono<{ Bindings: { DB: D1Database } }>();
    app.use("*", validateD1Binding("DB"));
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", {}, { DB: stubDb });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Hono();
    app.use("*", validateD1Binding("DB"));
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });
});
