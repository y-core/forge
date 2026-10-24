import { describe, expect, it } from "bun:test";

import { isBrowserEngine } from "./browser";

describe("isBrowserEngine()", () => {
  it("accepts each engine the Playwright server launches", () => {
    expect(["chromium", "firefox", "webkit"].every(isBrowserEngine)).toBe(true);
  });

  it("rejects a runtime project such as workerd", () => {
    expect(isBrowserEngine("workerd")).toBe(false);
  });
});
