import { describe, expect, it } from "bun:test";

import type { CfApiError } from "./types";
import { CfApiClientError } from "./types";

describe("CfApiClientError", () => {
  it("is an Error carrying its own name", () => {
    const error = new CfApiClientError("network", "connect failed");
    expect([error instanceof Error, error instanceof CfApiClientError, error.name]).toEqual([true, true, "CfApiClientError"]);
  });

  it("carries the message through to Error", () => {
    expect(new CfApiClientError("api", "boom").message).toBe("boom");
  });

  it("leaves statusCode and cfErrors undefined when no options are given", () => {
    const error = new CfApiClientError("parse", "bad json");
    expect([error.kind, error.statusCode, error.cfErrors]).toEqual(["parse", undefined, undefined]);
  });

  it("records the status code and the envelope errors it was constructed with", () => {
    const cfErrors: CfApiError[] = [{ code: 10000, message: "Authentication error" }];
    const error = new CfApiClientError("api", "rejected", { statusCode: 403, cfErrors });
    expect([error.kind, error.statusCode, error.cfErrors]).toEqual(["api", 403, [{ code: 10000, message: "Authentication error" }]]);
  });

  it("accepts an empty envelope error list as distinct from an absent one", () => {
    expect(new CfApiClientError("api", "rejected", { cfErrors: [] }).cfErrors).toEqual([]);
  });

  it("accepts a status code without any envelope errors", () => {
    const error = new CfApiClientError("api", "rejected", { statusCode: 500 });
    expect([error.statusCode, error.cfErrors]).toEqual([500, undefined]);
  });

  for (const kind of ["network", "api", "parse"] as const) {
    it(`records the ${kind} kind`, () => {
      expect(new CfApiClientError(kind, "x").kind).toBe(kind);
    });
  }

  it("is catchable as itself, which is what lets a caller narrow on kind", () => {
    const thrown = ((): unknown => {
      try {
        throw new CfApiClientError("network", "socket closed");
      } catch (e) {
        return e;
      }
    })();
    expect(thrown instanceof CfApiClientError && thrown.kind === "network").toBe(true);
  });
});
