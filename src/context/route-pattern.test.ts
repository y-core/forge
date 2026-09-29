import { describe, expect, it } from "bun:test";

import { RequestContext } from "@remix-run/fetch-router";

import { matchedRoutePattern } from "./route-pattern";

function makeCtx() {
  return new RequestContext(new Request("http://localhost/n/abc"));
}

describe("matchedRoutePattern", () => {
  it("is undefined before a route stamps it", () => {
    expect(matchedRoutePattern.getOptional(makeCtx())).toBeUndefined();
  });

  it("returns the stamped pattern source", () => {
    const c = makeCtx();
    matchedRoutePattern.set(c, "/n/:nb");
    expect(matchedRoutePattern.getOptional(c)).toBe("/n/:nb");
  });
});
