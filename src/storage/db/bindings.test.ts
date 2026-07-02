import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import type { AppContext } from "../../context/types";
import { resolveD1Client, validateD1Binding } from "./bindings";
import type { D1BindingOptions, D1Database, D1DatabaseLike, D1PreparedStatement, D1Result } from "./types";

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
    expect(await res.text()).toBe("D1 database binding not available");
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

// ── Cloudflare-shaped contract proof (compile-time) ────────────────────────
// Mirrors the divergent shape of Cloudflare's real D1 binding — an abstract class
// with extra `withSession`/`dump` members, an overloaded `first`, a generic `run`,
// and a richer `D1Result` whose `meta` has all-required fields plus an index
// signature. The structural contract `D1DatabaseLike` must accept it cast-free.

interface CfD1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}
type CfD1Result<T = unknown> = { success: true; meta: CfD1Meta & Record<string, unknown>; results: T[] };
interface CfD1PreparedStatement {
  bind(...values: unknown[]): CfD1PreparedStatement;
  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<CfD1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<CfD1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}
interface CfD1Database {
  prepare(query: string): CfD1PreparedStatement;
  batch<T = unknown>(statements: CfD1PreparedStatement[]): Promise<CfD1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(constraintOrBookmark?: string): unknown;
  dump(): Promise<ArrayBuffer>;
}

describe("D1DatabaseLike structural contract", () => {
  it("accepts a Cloudflare-shaped D1 database without a cast", () => {
    type Accepts = CfD1Database extends D1DatabaseLike ? true : false;
    const accepts: Accepts = true;

    const opts: D1BindingOptions<{ DB: CfD1Database }, CfD1Database> = { binding: (c) => c.env.DB };

    expect(accepts).toBe(true);
    expect(typeof opts.binding).toBe("function");
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
