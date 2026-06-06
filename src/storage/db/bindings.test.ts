import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import type { AppContext } from "../../context/types";
import { resolveD1Client, validateD1Binding } from "./bindings";
import type { D1Database, D1PreparedStatement, D1Result } from "./types";

const stubDb: D1Database = {
  prepare(): D1PreparedStatement {
    return {
      bind() {
        return this;
      },
      all<T>(): Promise<D1Result<T>> {
        return Promise.resolve({ results: [], success: true, meta: {} });
      },
      first<T>(): Promise<T | null> {
        return Promise.resolve(null);
      },
      run(): Promise<D1Result<unknown>> {
        return Promise.resolve({ results: [], success: true, meta: {} });
      },
    };
  },
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
};

describe("resolveD1Client", () => {
  it("returns a D1Client when the binding is present", async () => {
    const app = new Forge<{ DB: D1Database }>();
    mapHandler(app, "GET", "/", (c) => {
      const ctx = c as AppContext<{ DB: D1Database }>;
      const client = resolveD1Client(ctx, { binding: (appCtx) => (appCtx.env as { DB?: D1Database }).DB });
      return Response.json({ hasClient: client !== null });
    });
    const res = await app.request("/", {}, { DB: stubDb });
    expect(await res.json()).toEqual({ hasClient: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    mapHandler(app, "GET", "/", (c) => {
      resolveD1Client(c as AppContext, { binding: () => undefined });
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => {
      const client = resolveD1Client(c as AppContext, { binding: () => undefined, required: false });
      return Response.json({ hasClient: client !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasClient: false });
  });
});

describe("validateD1Binding", () => {
  it("passes when the binding exists", async () => {
    const app = new Forge<{ DB: D1Database }>();
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { DB: stubDb });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });

  it("rejects a value of the wrong shape (a string is not a D1 database)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { DB: "not-a-db" } as never);
    expect(res.status).toBe(500);
  });

  it("rejects an object missing the prepare method", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { DB: { batch: () => Promise.resolve([]) } } as never);
    expect(res.status).toBe(500);
  });
});
