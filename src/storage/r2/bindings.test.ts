import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import type { AppContext } from "../../context/types";
import { resolveObjectStore, validateR2Binding } from "./bindings";
import type { R2BindingOptions, R2Bucket, R2BucketLike, R2Object } from "./types";

function makeR2Stub(): R2Bucket {
  const obj: R2Object = { key: "test", version: "v1", size: 0, etag: "abc", httpEtag: '"abc"', uploaded: new Date() };
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
    const app = new Forge<{ BUCKET: R2Bucket }>();
    mapHandler(app, "GET", "/", (c) => {
      const ctx = c as AppContext<{ BUCKET: R2Bucket }>;
      const store = resolveObjectStore(ctx, { binding: (appCtx) => (appCtx.env as { BUCKET?: R2Bucket }).BUCKET });
      return Response.json({ hasStore: store !== null });
    });
    const res = await app.request("/", {}, { BUCKET: makeR2Stub() });
    expect(await res.json()).toEqual({ hasStore: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    mapHandler(app, "GET", "/", (c) => {
      resolveObjectStore(c as AppContext, { binding: () => undefined });
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("R2 bucket binding not available");
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => {
      const store = resolveObjectStore(c as AppContext, { binding: () => undefined, required: false });
      return Response.json({ hasStore: store !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasStore: false });
  });
});

// ── Cloudflare-shaped contract proof (compile-time) ────────────────────────
// These interfaces mirror the divergent shape of Cloudflare's real R2 binding —
// an abstract-class `R2Object` with extra required members and readonly fields,
// overloaded `put`/`get` (one branch returns `… | null`), a discriminated-union
// `list` return, and branded option types. Forge's neutral `R2Bucket` could not
// accept this without an `as unknown as R2Bucket` double-cast; the structural
// contract `R2BucketLike` is designed to. If a divergence ever broke the contract,
// the typed initializers below would fail to compile.

interface CfR2Object {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly checksums: { readonly md5?: ArrayBuffer };
  readonly uploaded: Date;
  readonly httpMetadata?: { contentType?: string; cacheExpiry?: Date };
  readonly customMetadata?: Record<string, string>;
  readonly storageClass: string;
  writeHttpMetadata(headers: Headers): void;
}
interface CfR2ObjectBody extends CfR2Object {
  get body(): ReadableStream;
  get bodyUsed(): boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}
type CfR2Objects = { objects: CfR2Object[]; delimitedPrefixes: string[] } & ({ truncated: true; cursor: string } | { truncated: false });
interface CfR2Bucket {
  head(key: string): Promise<CfR2Object | null>;
  get(key: string, options: { onlyIf: unknown }): Promise<CfR2ObjectBody | CfR2Object | null>;
  get(key: string, options?: { range?: unknown }): Promise<CfR2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options: { onlyIf: unknown },
  ): Promise<CfR2Object | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: { httpMetadata?: unknown },
  ): Promise<CfR2Object>;
  createMultipartUpload(key: string): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string }): Promise<CfR2Objects>;
}

describe("R2BucketLike structural contract", () => {
  it("accepts a Cloudflare-shaped R2 bucket without a cast", () => {
    // Assignability proof: the platform-shaped bucket satisfies the contract.
    type Accepts = CfR2Bucket extends R2BucketLike ? true : false;
    const accepts: Accepts = true;

    // Real-usage proof: the exact resolve-site call shape — `binding: (c) => c.env.X` —
    // type-checks with the platform type as the binding's `B`, no cast. Constructing this
    // options value violates the `B extends R2BucketLike` constraint if the contract fails.
    const opts: R2BindingOptions<{ DOCUMENTS: CfR2Bucket }, CfR2Bucket> = { binding: (c) => c.env.DOCUMENTS };

    expect(accepts).toBe(true);
    expect(typeof opts.binding).toBe("function");
  });
});

describe("validateR2Binding", () => {
  it("passes when the binding exists", async () => {
    const app = new Forge<{ MY_BUCKET: R2Bucket }>();
    app.use("*", validateR2Binding("MY_BUCKET"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { MY_BUCKET: makeR2Stub() });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateR2Binding("MY_BUCKET"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });

  it("rejects a value of the wrong shape (a string is not an R2 bucket)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateR2Binding("MY_BUCKET"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { MY_BUCKET: "not-a-bucket" } as never);
    expect(res.status).toBe(500);
  });

  it("rejects an object missing the put method", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateR2Binding("MY_BUCKET"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { MY_BUCKET: { get: () => Promise.resolve(null) } } as never);
    expect(res.status).toBe(500);
  });
});
