import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { applyAssets, serveAssets } from "./assets";

type Bindings = { ASSETS?: { fetch: (req: Request) => Promise<Response> } };

function makeApp(assetsResponse: Response | null) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.all(
    "*",
    serveAssets(app, {
      notFoundView: (c) => c.html("<h1>Not found</h1>", 404),
    }),
  );

  if (assetsResponse !== null) {
    return { app, env: { ASSETS: { fetch: async () => assetsResponse } } };
  }
  return { app, env: {} };
}

describe("applyAssets", () => {
  it("serves a 200 asset via the default '*' path", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    applyAssets(app, { notFoundView: (c) => c.html("<h1>Not found</h1>", 404) });
    const env = { ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) } };
    const res = await app.request("/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("falls back to notFoundView on 404 via the default '*' path", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    applyAssets(app, { notFoundView: (c) => c.html("<h1>Not found</h1>", 404) });
    const env = { ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } };
    const res = await app.request("/missing.js", {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  it("registers on a custom path when supplied", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    applyAssets(app, { notFoundView: (c) => c.html("<h1>Not found</h1>", 404) }, "/static/*");
    const env = { ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) } };
    const res = await app.request("/static/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });
});

describe("serveAssets", () => {
  it("proxies a 200 response from ASSETS", async () => {
    const { app, env } = makeApp(new Response("<html>asset</html>", { status: 200 }));
    const res = await app.request("/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("renders notFoundView when ASSETS returns 404", async () => {
    const { app, env } = makeApp(new Response("Not Found", { status: 404 }));
    const res = await app.request("/missing.js", {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  it("renders notFoundView when ASSETS binding is absent", async () => {
    const { app, env } = makeApp(null);
    const res = await app.request("/missing.js", {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });
});
