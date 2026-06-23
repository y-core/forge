import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import type { AppContext } from "../../context/types";
import { resolveKVStore, validateKVBinding } from "./bindings";
import type { KVBindingOptions, KVNamespace, KVNamespaceLike } from "./types";

const stubNs = {
  get: () => Promise.resolve(null),
  getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ keys: [], list_complete: true }),
} as unknown as KVNamespace;

describe("resolveKVStore", () => {
  it("returns a KVStore when the binding is present", async () => {
    const app = new Forge<{ KV: KVNamespace }>();
    mapHandler(app, "GET", "/", (c) => {
      const ctx = c as AppContext<{ KV: KVNamespace }>;
      const store = resolveKVStore(ctx, { binding: (appCtx) => (appCtx.env as { KV?: KVNamespace }).KV });
      return Response.json({ hasStore: store !== null });
    });
    const res = await app.request("/", {}, { KV: stubNs });
    expect(await res.json()).toEqual({ hasStore: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    mapHandler(app, "GET", "/", (c) => {
      resolveKVStore(c as AppContext, { binding: () => undefined });
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => {
      const store = resolveKVStore(c as AppContext, { binding: () => undefined, required: false });
      return Response.json({ hasStore: store !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasStore: false });
  });
});

// ── Cloudflare-shaped contract proof (compile-time) ────────────────────────
// Mirrors the divergent shape of Cloudflare's real KV binding — a generic
// `KVNamespace<Key>` with many overloaded `get`/`getWithMetadata` signatures, a
// metadata result carrying an extra `cacheStatus`, and a branded list result.
// The structural contract `KVNamespaceLike` must accept it cast-free.

interface CfKVListResult<M> {
  keys: { name: string; expiration?: number; metadata?: M }[];
  list_complete: boolean;
  cursor?: string;
  cacheStatus: string | null;
}
interface CfKVNamespace<Key extends string = string> {
  get(key: Key, options?: { type: "text"; cacheTtl?: number }): Promise<string | null>;
  get(key: Key, options: { type: "arrayBuffer"; cacheTtl?: number }): Promise<ArrayBuffer | null>;
  get<V = unknown>(key: Key, options: { type: "json" }): Promise<V | null>;
  get(key: Key, options: { type: "stream" }): Promise<ReadableStream | null>;
  getWithMetadata<M = unknown>(
    key: Key,
    options?: { type: "text" },
  ): Promise<{ value: string | null; metadata: M | null; cacheStatus: string | null }>;
  getWithMetadata<M = unknown>(
    key: Key,
    options: { type: "arrayBuffer" },
  ): Promise<{ value: ArrayBuffer | null; metadata: M | null; cacheStatus: string | null }>;
  put(
    key: Key,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: Key): Promise<void>;
  list<M = unknown>(options?: { limit?: number; prefix?: string | null; cursor?: string | null }): Promise<CfKVListResult<M>>;
}

describe("KVNamespaceLike structural contract", () => {
  it("accepts a Cloudflare-shaped KV namespace without a cast", () => {
    type Accepts = CfKVNamespace extends KVNamespaceLike ? true : false;
    const accepts: Accepts = true;

    const opts: KVBindingOptions<{ SETTINGS: CfKVNamespace }, unknown, CfKVNamespace> = { binding: (c) => c.env.SETTINGS };

    expect(accepts).toBe(true);
    expect(typeof opts.binding).toBe("function");
  });
});

describe("validateKVBinding", () => {
  it("passes when the binding exists", async () => {
    const app = new Forge<{ MY_KV: KVNamespace }>();
    app.use("*", validateKVBinding("MY_KV"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { MY_KV: stubNs });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateKVBinding("MY_KV"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });

  it("rejects a value of the wrong shape (a string is not a KV namespace)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateKVBinding("MY_KV"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { MY_KV: "not-a-namespace" } as never);
    expect(res.status).toBe(500);
  });

  it("rejects an object missing the put method", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateKVBinding("MY_KV"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { MY_KV: { get: () => Promise.resolve(null) } } as never);
    expect(res.status).toBe(500);
  });
});
