import { describe, expect, it } from "bun:test";
import { ESC, hasAnsi, stripAnsi } from "./ansi";
import { stringWidth, truncate } from "./width";

const BEL = "\u0007";
const RED = `${ESC}[31m`;
const DEFAULT_FG = `${ESC}[39m`;
const RESET = `${ESC}[0m`;

describe("hasAnsi()", () => {
  it("is false for plain text", () => {
    expect(hasAnsi("plain")).toBe(false);
  });

  it("is true once an escape byte appears", () => {
    expect(hasAnsi(`${RED}x`)).toBe(true);
  });
});

describe("stripAnsi()", () => {
  it("returns plain text unchanged", () => {
    expect(stripAnsi("plain")).toBe("plain");
  });

  it("removes an SGR pair", () => {
    expect(stripAnsi(`${RED}red${DEFAULT_FG}`)).toBe("red");
  });

  it("removes an OSC 8 hyperlink, leaving the link text", () => {
    expect(stripAnsi(`${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`)).toBe("link");
  });
});

describe("stringWidth()", () => {
  it("is 0 for the empty string", () => {
    expect(stringWidth("")).toBe(0);
  });

  it("counts ASCII one column each", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  it("counts CJK two columns each", () => {
    expect(stringWidth("古池や")).toBe(6);
  });

  it("counts a combining mark as part of the cell it attaches to", () => {
    expect(stringWidth("e\u0301")).toBe(1);
  });

  it("ignores the escape sequences around styled text", () => {
    expect(stringWidth(`${RED}red${DEFAULT_FG}`)).toBe(3);
  });

  it("counts a tab as eight columns", () => {
    expect(stringWidth("a\tb")).toBe(10);
  });

  it("counts box-drawing characters one column each", () => {
    expect(stringWidth("\u250C\u2500\u2510")).toBe(3);
  });

  it("counts the horizontal ellipsis as one column", () => {
    expect(stringWidth("…")).toBe(1);
  });

  it("counts an emoji as two columns", () => {
    expect(stringWidth("\u{1F44D}")).toBe(2);
  });

  it("counts a ZWJ family sequence as one emoji, not three", () => {
    expect(stringWidth("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}")).toBe(2);
  });

  it("counts a text-default pictograph as one column", () => {
    expect(stringWidth("©")).toBe(1);
  });

  it("counts a pictograph forced to emoji presentation as two", () => {
    expect(stringWidth("\u2764\uFE0F")).toBe(2);
  });

  it("counts an OSC 8 hyperlink as its link text only", () => {
    expect(stringWidth(`${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`)).toBe(4);
  });

  it("agrees with String.length on every cell the sync tables render", () => {
    // The Stage 1 acceptance criterion: `sync/table.ts` measured with `String.length`, so the
    // grid engine can only replace it if the two agree on every string it was ever given.
    const fixtures = [
      "Type",
      "Binding",
      "Action",
      "Remote ID",
      "Detail",
      "kv",
      "d1",
      "MY_KV",
      "KV1",
      "DB1",
      "BASE_URL",
      "in sync",
      "created",
      "deploy pushes",
      "not verified — no read API",
      "a-much-longer-value",
      "A-VERY-LONG-BINDING-NAME",
      "id-2",
      "No .dev.vars at /tmp/.dev.vars.",
      "Rotated by --commit",
      "the local value is never sent",
      "",
    ];
    expect(fixtures.map((s) => stringWidth(s))).toEqual(fixtures.map((s) => s.length));
  });
});

describe("truncate()", () => {
  it("returns the input untouched when it fits", () => {
    expect(truncate("hello", 8)).toEqual({ text: "hello", width: 5, truncated: false });
  });

  it("returns the input untouched at exactly the limit", () => {
    expect(truncate("hello", 5)).toEqual({ text: "hello", width: 5, truncated: false });
  });

  it("cuts to the limit and marks the cut", () => {
    expect(truncate("hello world", 8)).toEqual({ text: "hello w…", width: 8, truncated: true });
  });

  it("honours a custom ellipsis", () => {
    expect(truncate("hello world", 8, { ellipsis: "..." })).toEqual({ text: "hello...", width: 8, truncated: true });
  });

  it("cuts silently when the ellipsis is wider than the column", () => {
    expect(truncate("hello", 2, { ellipsis: "..." })).toEqual({ text: "he", width: 2, truncated: true });
  });

  it("never splits a wide character across the boundary", () => {
    expect(truncate("古池や", 3, { ellipsis: "" })).toEqual({ text: "古", width: 2, truncated: true });
  });

  it("closes the style it cut into, so the colour does not run on", () => {
    expect(truncate(`${RED}hello world${DEFAULT_FG}`, 8)).toEqual({ text: `${RED}hello w${RESET}…`, width: 8, truncated: true });
  });
});
