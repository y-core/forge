import { describe, expect, it } from "bun:test";

import { ANSI_PATTERN, CSI, ESC, hasAnsi, RE_ANSI, RESET, SGR_PATTERN, stripAnsi } from "./ansi";

const BEL = "\u0007";
const ST = "\u001B\\";

describe("ansi constants", () => {
  it("ESC is the single escape byte", () => {
    expect(ESC).toBe("\u001B");
  });

  it("CSI is the single-byte control introducer", () => {
    expect(CSI).toBe("\u009B");
  });

  it("RESET closes every open style", () => {
    expect(RESET).toBe("\u001B[0m");
  });

  it("RE_ANSI compiles ANSI_PATTERN and carries `g`, which is what makes stripAnsi replace every occurrence", () => {
    expect([RE_ANSI.source, RE_ANSI.flags]).toEqual([ANSI_PATTERN, "g"]);
  });
});

describe("SGR_PATTERN", () => {
  it("captures the parameters of one SGR sequence", () => {
    expect(new RegExp(SGR_PATTERN).exec(`${ESC}[1;31m`)?.[1]).toBe("1;31");
  });

  it("captures the empty parameter list of a bare `ESC [ m`", () => {
    expect(new RegExp(SGR_PATTERN).exec(`${ESC}[m`)?.[1]).toBe("");
  });

  it("does not match a non-SGR final byte", () => {
    expect(new RegExp(SGR_PATTERN).exec(`${ESC}[2J`)).toBeNull();
  });
});

describe("hasAnsi", () => {
  for (const [label, input, expected] of [
    ["a plain string", "plain text", false],
    ["the empty string", "", false],
    ["an SGR sequence", `${ESC}[31mred${ESC}[39m`, true],
    ["a single-byte CSI sequence", `${CSI}31mred`, true],
    ["a bare escape byte with no sequence after it", ESC, true],
    ["a bracket that opens nothing", "[31m", false],
  ] as const) {
    it(`returns ${expected} for ${label}`, () => {
      expect(hasAnsi(input)).toBe(expected);
    });
  }
});

describe("stripAnsi", () => {
  it("returns a string with no escape byte unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("returns the empty string unchanged", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("removes every sequence in a string carrying several", () => {
    expect(stripAnsi(`${ESC}[1m${ESC}[31mred${ESC}[39m and ${ESC}[32mgreen${ESC}[39m${ESC}[22m`)).toBe("red and green");
  });

  it("removes a single-byte CSI sequence", () => {
    expect(stripAnsi(`${CSI}31mred${CSI}39m`)).toBe("red");
  });

  it("removes an OSC 8 hyperlink terminated by BEL, leaving the link text", () => {
    expect(stripAnsi(`${ESC}]8;;https://example.com/a?b=1${BEL}label${ESC}]8;;${BEL}`)).toBe("label");
  });

  it("removes an OSC 8 hyperlink terminated by ESC backslash", () => {
    expect(stripAnsi(`${ESC}]8;;https://example.com/${ST}label${ESC}]8;;${ST}`)).toBe("label");
  });

  it("removes a cursor-movement sequence, not only a colour one", () => {
    expect(stripAnsi(`${ESC}[2Kline${ESC}[1A`)).toBe("line");
  });

  it("gives the same answer on a repeated call, so `g` leaves no lastIndex behind", () => {
    const input = `${ESC}[31ma${ESC}[39m${ESC}[32mb${ESC}[39m`;
    expect([stripAnsi(input), stripAnsi(input)]).toEqual(["ab", "ab"]);
  });
});
