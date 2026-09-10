import { describe, expect, it } from "bun:test";

import { mapHandler } from "../testing/route";
import { applyAssets, serveAssets } from "./assets";
import { Forge } from "./forge-app";

type Bindings = { ASSETS?: { fetch: (req: Request) => Promise<Response> } };

const NOT_FOUND_VIEW = () => new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });

function makeApp(assetsResponse: Response | null) {
  const app = new Forge<Bindings>();
  app.setNotFound(NOT_FOUND_VIEW);
  mapHandler(app, "ANY", "*", serveAssets(app));

  if (assetsResponse !== null) {
    return { app, env: { ASSETS: { fetch: async () => assetsResponse } } };
  }
  return { app, env: {} as Bindings };
}

describe("applyAssets", () => {
  it("serves a 200 asset via the default '*' path", async () => {
    const app = new Forge<Bindings>();
    app.setNotFound(NOT_FOUND_VIEW);
    applyAssets(app);
    const env = { ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) } };
    const res = await app.request("/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("falls back to the app's not-found answer on 404 via the default '*' path", async () => {
    const app = new Forge<Bindings>();
    app.setNotFound(NOT_FOUND_VIEW);
    applyAssets(app);
    const env = { ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } };
    const res = await app.request("/missing.js", {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<h1>Not found</h1>");
  });

  it("registers on a custom path when supplied", async () => {
    const app = new Forge<Bindings>();
    app.setNotFound(NOT_FOUND_VIEW);
    applyAssets(app, "/static/*");
    const env = { ASSETS: { fetch: async () => new Response("<html>asset</html>", { status: 200 }) } };
    const res = await app.request("/static/styles.css", {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("uses forge's hardened default when the app registered no not-found hook", async () => {
    const app = new Forge<Bindings>();
    applyAssets(app);
    const env = { ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } };
    const res = await app.request("/secret/path.js", {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("serveAssets", () => {
  it("proxies a 200 response from ASSETS", async () => {
    const { app, env } = makeApp(new Response("<html>asset</html>", { status: 200 }));
    const res = await app.request("/styles.css", {}, env as Bindings);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>asset</html>");
  });

  it("renders the not-found answer when ASSETS returns 404", async () => {
    const { app, env } = makeApp(new Response("Not Found", { status: 404 }));
    const res = await app.request("/missing.js", {}, env as Bindings);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<h1>Not found</h1>");
  });

  it("renders the not-found answer when the ASSETS binding is absent", async () => {
    const { app, env } = makeApp(null);
    const res = await app.request("/missing.js", {}, env as Bindings);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<h1>Not found</h1>");
  });

  it("renders the not-found answer for non-GET methods", async () => {
    const app = new Forge<Bindings>();
    app.setNotFound(NOT_FOUND_VIEW);
    mapHandler(app, "ANY", "*", serveAssets(app));
    const env = { ASSETS: { fetch: async () => new Response("", { status: 200 }) } };
    const res = await app.request("/main.abcd1234.js", { method: "POST" }, env as Bindings);
    expect(res.status).toBe(404);
  });

  it("passes through Cache-Control from ASSETS without overwriting it (caching owned by _headers)", async () => {
    const upstream = new Response("body{}", { status: 200, headers: { "Cache-Control": "no-store" } });
    const { app, env } = makeApp(upstream);
    const res = await app.request("/assets/main.205ed97c.css", {}, env as Bindings);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
