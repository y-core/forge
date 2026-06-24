import { describe, expect, it } from "bun:test";
import { routePaths } from "./filter";
import { get, post, Route, route } from "./mod";

describe("routePaths", () => {
  const routes = route({ home: get("/"), save: post("/api/save"), importDoc: post("/api/import"), any: new Route("ANY", "/api/any") });

  it("returns only POST source paths in declaration order", () => {
    expect(routePaths(routes, { method: "POST" })).toEqual(["/api/save", "/api/import"]);
  });

  it("returns only GET source paths", () => {
    expect(routePaths(routes, { method: "GET" })).toEqual(["/"]);
  });

  it("returns only ANY source paths", () => {
    expect(routePaths(routes, { method: "ANY" })).toEqual(["/api/any"]);
  });

  it("returns every path when no filter is given", () => {
    expect(routePaths(routes)).toEqual(["/", "/api/save", "/api/import", "/api/any"]);
  });

  it("recurses into nested route maps", () => {
    const nested = route({ top: get("/top"), api: route({ save: post("/api/save"), importDoc: post("/api/import") }) });
    expect(routePaths(nested, { method: "POST" })).toEqual(["/api/save", "/api/import"]);
    expect(routePaths(nested)).toEqual(["/top", "/api/save", "/api/import"]);
  });

  it("returns an empty array for an empty route map", () => {
    expect(routePaths(route({}))).toEqual([]);
  });
});
