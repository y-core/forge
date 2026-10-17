import { describe, expect, it } from "bun:test";

import { D1_LIMITS } from "./limits";

describe("D1_LIMITS", () => {
  it("holds Cloudflare's published bound-parameter, statement-length and column limits", () => {
    expect(D1_LIMITS).toEqual({ boundParams: 100, statementBytes: 100_000, columns: 100 });
  });
});
