import { describe, expect, it } from "bun:test";

import { disclosedErrorMessage } from "./error-page.strict";

describe("disclosedErrorMessage", () => {
  it("discloses nothing about the thrown error", () => {
    expect(disclosedErrorMessage(new Error("refused"))).toBeUndefined();
  });
});
