import { describe, expect, it } from "bun:test";

import { admitsTestingSecret } from "./turnstile.strict";

describe("admitsTestingSecret", () => {
  it("refuses a published testing secret", () => {
    expect(admitsTestingSecret("1x0000000000000000000000000000000AA")).toBe(false);
  });
});
