import { describe, expect, it } from "bun:test";

import { isDynamicRoute } from "./dynamic-route";

describe("isDynamicRoute", () => {
  it("treats a plain path as static", () => {
    for (const source of ["/", "/fica", "/a-b.c"]) expect(isDynamicRoute(source)).toBe(false);
  });

  it("treats a param, wildcard, optional, search or brace as dynamic", () => {
    for (const source of ["/u/:id", "/f/*rest", "/f/*", "/d(/x)", "/s?q", "/{x}"]) expect(isDynamicRoute(source)).toBe(true);
  });

  it("treats an escaped character as dynamic, so a literal backslash is never read as a static path", () => {
    expect(isDynamicRoute("/a\\b")).toBe(true);
    expect(isDynamicRoute("/t/12\\:30")).toBe(true);
  });
});
