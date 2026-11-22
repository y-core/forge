import { describe, expect, it } from "bun:test";

import { createContextKey, RequestContext } from "@remix-run/fetch-router";

import { RequestFreeBundleError, requestScope } from "./request-scope.node";

const REQUEST_FREE = /^forge's `node` export condition loads a request-free bundle.*docs\/TEST_RUNNERS\.md §7f\)$/;

describe("requestScope under the node bundle condition", () => {
  it("refuses a read and a write of a request's context with the error naming the node condition as request-free", () => {
    const context = new RequestContext(new Request("http://localhost/"));
    const key = createContextKey<string>();
    for (const touch of [() => requestScope.read(context, key), () => requestScope.write(context, key, "value")]) {
      expect(touch).toThrow(RequestFreeBundleError);
      expect(touch).toThrow(REQUEST_FREE);
    }
  });
});
