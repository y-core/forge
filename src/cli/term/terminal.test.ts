import { describe, expect, it } from "bun:test";
import { DEFAULT_WIDTH, terminalWidth } from "./terminal";

describe("terminalWidth()", () => {
  it("reports the stream's own column count", () => {
    expect(terminalWidth({ columns: 120 })).toBe(120);
  });

  it("falls back when the stream is not a terminal", () => {
    expect(terminalWidth({})).toBe(DEFAULT_WIDTH);
  });

  it("falls back on a zero column count, which no terminal has", () => {
    expect(terminalWidth({ columns: 0 })).toBe(DEFAULT_WIDTH);
  });

  it("honours an explicit fallback", () => {
    expect(terminalWidth({}, 100)).toBe(100);
  });
});
