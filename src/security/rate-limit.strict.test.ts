import { describe, expect, it } from "bun:test";

import { admitsAbsentLimiter } from "./rate-limit.strict";

describe("admitsAbsentLimiter", () => {
  it("refuses a request past an absent limiter binding", () => {
    expect(admitsAbsentLimiter()).toBe(false);
  });
});
