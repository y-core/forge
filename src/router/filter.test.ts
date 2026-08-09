import { describe, expect, it } from "bun:test";
import type { Middleware } from "@remix-run/fetch-router";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { forMethod, routePaths } from "./filter";
import { get, post, Route, route } from "./mod";

describe("routePaths", () => {
  const routes = route({ home: get("/"), save: post("/api/save"), importDoc: post("/api/import"), any: new Route("ANY", "/api/any") });

  it("returns POST source paths in declaration order, including ANY routes", () => {
    expect(routePaths(routes, { method: "POST" })).toEqual(["/api/save", "/api/import", "/api/any"]);
  });

  it("returns GET source paths, including ANY routes", () => {
    expect(routePaths(routes, { method: "GET" })).toEqual(["/", "/api/any"]);
  });

  it("returns only declared-ANY source paths for the ANY filter", () => {
    expect(routePaths(routes, { method: "ANY" })).toEqual(["/api/any"]);
  });

  it("excludes a route declared for another concrete method", () => {
    const getOnly = route({ home: get("/"), save: post("/api/save") });
    expect(routePaths(getOnly, { method: "POST" })).toEqual(["/api/save"]);
  });

  it("returns every path when no filter is given", () => {
    expect(routePaths(routes)).toEqual(["/", "/api/save", "/api/import", "/api/any"]);
  });

  it("recurses into nested route maps", () => {
    const nested = route({ top: get("/top"), api: route({ save: post("/api/save"), importDoc: post("/api/import") }) });
    expect(routePaths(nested, { method: "POST" })).toEqual(["/api/save", "/api/import"]);
    expect(routePaths(nested)).toEqual(["/top", "/api/save", "/api/import"]);
  });

  it("does not throw when a nested branch contributes nothing but the top level still matches", () => {
    const nested = route({ save: post("/api/save"), reads: route({ load: get("/api/load") }) });
    expect(routePaths(nested, { method: "POST" })).toEqual(["/api/save"]);
  });

  it("throws when a method filter matches no route in a non-empty map", () => {
    const readOnly = route({ home: get("/"), load: get("/api/load") });
    expect(() => routePaths(readOnly, { method: "POST" })).toThrow('no route serves method "POST"');
  });

  it("returns an empty array for an empty route map", () => {
    expect(routePaths(route({}))).toEqual([]);
  });

  it("does not throw for a filtered empty route map", () => {
    expect(routePaths(route({}), { method: "POST" })).toEqual([]);
  });
});

/**
 * The other half of the `routePaths` pattern. `app.use` is **path**-scoped only — dispatch never
 * consults the method — so a `routePaths(routes, { method: "POST" })` loop attaches middleware to
 * those paths for *every* method they serve.
 */
describe("forMethod", () => {
  /** A guard with a visible effect, so "did it run" is a status code rather than a spy. */
  const deny: Middleware = () => new Response("denied", { status: 403 });

  function bothMethodsApp(): Forge {
    const app = new Forge();
    mapHandler(app, "GET", "/api/thing", () => new Response("get"));
    mapHandler(app, "POST", "/api/thing", () => new Response("post"));
    mapHandler(app, "DELETE", "/api/thing", () => new Response("delete"));
    return app;
  }

  it("leaves the GET untouched and applies the guard to the POST on a path serving both", async () => {
    const app = bothMethodsApp();
    app.use("/api/thing", forMethod("POST", deny));

    const read = await app.request("/api/thing");
    expect([read.status, await read.text()]).toEqual([200, "get"]);

    expect((await app.request("/api/thing", { method: "POST" })).status).toBe(403);
  });

  it("bare app.use catches both — the imprecision forMethod exists to close", async () => {
    const app = bothMethodsApp();
    app.use("/api/thing", deny);

    // Pinned as the contrast case: without the wrapper the GET is guarded too.
    expect((await app.request("/api/thing")).status).toBe(403);
    expect((await app.request("/api/thing", { method: "POST" })).status).toBe(403);
  });

  it("an array of methods matches any member and no others", async () => {
    const app = bothMethodsApp();
    app.use("/api/thing", forMethod(["POST", "DELETE"], deny));

    expect((await app.request("/api/thing", { method: "POST" })).status).toBe(403);
    expect((await app.request("/api/thing", { method: "DELETE" })).status).toBe(403);
    expect((await app.request("/api/thing")).status).toBe(200);
  });

  it("passes the request through untouched when the method does not match", async () => {
    const app = bothMethodsApp();
    let ran = 0;
    app.use(
      "/api/thing",
      forMethod("POST", (_context, next) => {
        ran++;
        return next();
      }),
    );

    const read = await app.request("/api/thing");
    expect([read.status, await read.text(), ran]).toEqual([200, "get", 0]);

    await app.request("/api/thing", { method: "POST" });
    expect(ran).toBe(1);
  });

  /**
   * The motivating case. `routePaths` includes an `ANY` route under a concrete method filter — by
   * design, since `ANY` really does serve POST — so the documented `csrfGuard` loop used to guard
   * `/health` on GET.
   */
  it("keeps a routePaths(POST) loop off the GET half of an ANY route", async () => {
    const routes = route({ health: new Route("ANY", "/health"), save: post("/api/save") });
    expect(routePaths(routes, { method: "POST" })).toEqual(["/health", "/api/save"]);

    const app = new Forge();
    mapHandler(app, "ANY", "/health", () => new Response("ok"));
    mapHandler(app, "POST", "/api/save", () => new Response("saved"));
    for (const path of routePaths(routes, { method: "POST" })) {
      app.use(path, forMethod("POST", deny));
    }

    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/health", { method: "POST" })).status).toBe(403);
    expect((await app.request("/api/save", { method: "POST" })).status).toBe(403);
  });
});
