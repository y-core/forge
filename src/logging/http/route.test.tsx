/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { KVNamespace } from "../../storage/kv/types";
import { logViewer } from "./route";

function makeKvStub(): KVNamespace {
  return {
    get: () => Promise.resolve(null),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true }),
  } as unknown as KVNamespace;
}

function makeApp(options?: { basePath?: string }) {
  const app = new Hono();
  const mod = logViewer({ kv: () => makeKvStub(), ...options });
  app.get("/logs", async (c) => {
    if (!mod.loader) return c.text("no loader", 500);
    const result = await mod.loader(c, undefined);
    if (result instanceof Response) return result;
    return c.json(result);
  });
  return app;
}

describe("logViewer loader — non-HTMX request", () => {
  it("returns 200 with JSON data when HX-Request header is absent", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows).toEqual([]);
    expect(data.complete).toBe(true);
    expect(data.basePath).toBe("/admin/logs");
  });

  it("uses default basePath of /admin/logs", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.basePath).toBe("/admin/logs");
  });

  it("reflects a custom basePath in the returned data", async () => {
    const app = makeApp({ basePath: "/dashboard/logs" });
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.basePath).toBe("/dashboard/logs");
  });

  it("reflects level query param in the returned data", async () => {
    const app = makeApp();
    const res = await app.request("/logs?level=error");
    const data = await res.json();
    expect(data.level).toBe("error");
  });

  it("reflects q query param in the returned data", async () => {
    const app = makeApp();
    const res = await app.request("/logs?q=payment");
    const data = await res.json();
    expect(data.q).toBe("payment");
  });

  it("reflects both level and q query params together", async () => {
    const app = makeApp();
    const res = await app.request("/logs?level=error&q=payment");
    const data = await res.json();
    expect(data.level).toBe("error");
    expect(data.q).toBe("payment");
  });

  it("omits level from data when query param is absent", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.level).toBeUndefined();
  });

  it("omits q from data when query param is absent", async () => {
    const app = makeApp();
    const res = await app.request("/logs");
    const data = await res.json();
    expect(data.q).toBeUndefined();
  });
});

describe("logViewer loader — HTMX request", () => {
  it("returns 200 HTML response when HX-Request header is true", async () => {
    const app = makeApp();
    const res = await app.request("/logs", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<tbody");
  });

  it("returns an HTML content-type for HTMX partial", async () => {
    const app = makeApp();
    const res = await app.request("/logs", {
      headers: { "HX-Request": "true" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  it("does not treat HX-Request: false as an HTMX request", async () => {
    const app = makeApp();
    const res = await app.request("/logs", {
      headers: { "HX-Request": "false" },
    });
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
  });
});
