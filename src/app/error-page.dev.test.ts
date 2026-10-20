import { describe, expect, it } from "bun:test";

import { disclosedErrorMessage, discloseThrownMessage } from "./error-page.dev";

describe("discloseThrownMessage", () => {
  it("discloses the thrown message as plain text, leaving the escaping to the page", () => {
    expect(discloseThrownMessage(new Error("<b>refused</b>"))).toBe("<b>refused</b>");
  });
});

describe("disclosedErrorMessage", () => {
  it("discloses nothing in a run that does not arm the development build", () => {
    expect(disclosedErrorMessage(new Error("refused"))).toBeUndefined();
  });
});
