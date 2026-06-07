import { describe, expect, it } from "bun:test";
import { applyAssets, serveAssets } from "./assets";
import { Forge } from "./forge-app";
import { mapHandler } from "./route-test-helper";

type Bindings = { ASSETS?: { fetch: (req: Request) => Promise<Response> } };

function makeApp(assetsResponse: Response | null) {
  const app = new Forge<Bindings>();
  mapHandler(
    app,
    "ANY",
    "*",
    serveAssets(app, { notFoundView: () => new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } }) }),
  );

  if (assetsResponse !== null) {
    return { app, env: { ASSETS: { fetch: async () => assetsResponse } } };
  }
  return { app, env: {} as Bindings };
}

describe("applyAssets", () => {
  it("serves a 200 asset via the default '*' path", async () => {
    const app = new Forge<Bindings>();
    applyAssets(app, { notFoundView: () => new Response("<h1>Not found</h1>", { status: 404 }) });
    const env = { ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) } };
    const res = await app.request("/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("falls back to notFoundView on 404 via the default '*' path", async () => {
    const app = new Forge<Bindings>();
    applyAssets(app, { notFoundView: () => new Response("<h1>Not found</h1>", { status: 404 }) });
    const env = { ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } };
    const res = await app.request("/missing.js", {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  it("registers on a custom path when supplied", async () => {
    const app = new Forge<Bindings>();
    applyAssets(app, { notFoundView: () => new Response("<h1>Not found</h1>", { status: 404 }) }, "/static/*");
    const env = { ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) } };
    const res = await app.request("/static/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });
});

describe("serveAssets", () => {
  it("proxies a 200 response from ASSETS", async () => {
    const { app, env } = makeApp(new Response("<html>asset</html>", { status: 200 }));
    const res = await app.request("/styles.css", {}, env as Bindings);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("renders notFoundView when ASSETS returns 404", async () => {
    const { app, env } = makeApp(new Response("Not Found", { status: 404 }));
    const res = await app.request("/missing.js", {}, env as Bindings);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  it("renders notFoundView when ASSETS binding is absent", async () => {
    const { app, env } = makeApp(null);
    const res = await app.request("/missing.js", {}, env as Bindings);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  it("renders notFoundView for non-GET methods", async () => {
    const app = new Forge<Bindings>();
    mapHandler(
      app,
      "ANY",
      "*",
      serveAssets(app, { notFoundView: () => new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } }) }),
    );
    const env = { ASSETS: { fetch: async () => new Response("", { status: 200 }) } };
    const res = await app.request("/main.abcd1234.js", { method: "POST" }, env as Bindings);
    expect(res.status).toBe(404);
  });

  it("passes through Cache-Control from ASSETS without overwriting it (caching owned by _headers)", async () => {
    // Asset caching is delegated to the declarative public/_headers file emitted by the build
    // pipeline — the Worker must not inject or overwrite Cache-Control for any asset path.
    const upstream = new Response("body{}", { status: 200, headers: { "Cache-Control": "no-store" } });
    const { app, env } = makeApp(upstream);
    const res = await app.request("/assets/main.205ed97c.css", {}, env as Bindings);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
