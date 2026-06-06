import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import type { AppContext } from "../../context/types";
import { resolveObjectStore, validateR2Binding } from "./bindings";
import type { R2Bucket, R2Object } from "./types";

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
