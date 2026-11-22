import { describe, expect, it } from "bun:test";

import { createContextKey, RequestContext } from "@remix-run/fetch-router";

import { requestScope } from "./request-scope";

describe("requestScope", () => {
  it("reads back what it wrote to a request's context, and undefined for a key never written", () => {
    const context = new RequestContext(new Request("http://localhost/"));
    const written = createContextKey<string>();
    requestScope.write(context, written, "value");
    expect([requestScope.read(context, written), requestScope.read(context, createContextKey<string>())]).toEqual(["value", undefined]);
  });

  it("is what `#request-scope` resolves to outside the forge-node-bundle condition, so the source under Bun reads a request's context", async () => {
    expect((await import("#request-scope")).requestScope).toBe(requestScope);
  });
});
