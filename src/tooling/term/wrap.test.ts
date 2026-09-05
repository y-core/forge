import { describe, expect, it } from "bun:test";

import { ESC } from "./ansi";
import { padAlign, wrapLines } from "./wrap";

const RED = `${ESC}[31m`;
const DEFAULT_FG = `${ESC}[39m`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const NOT_BOLD = `${ESC}[22m`;

describe("padAlign()", () => {
  it("returns the input when it already fills the column", () => {
    expect(padAlign("abcde", 5)).toBe("abcde");
  });

  it("returns the input when it overflows the column", () => {
    expect(padAlign("abcdef", 5)).toBe("abcdef");
  });

  it("pads on the right by default", () => {
    expect(padAlign("ab", 5)).toBe("ab   ");
  });

  it("pads on the left when aligned right", () => {
    expect(padAlign("ab", 5, "right")).toBe("   ab");
  });

  it("puts the odd column on the right when centred", () => {
    expect(padAlign("ab", 5, "center")).toBe(" ab  ");
  });

  it("pads a styled cell by its visible width, not its byte length", () => {
    expect(padAlign(`${RED}ab${DEFAULT_FG}`, 5)).toBe(`${RED}ab${DEFAULT_FG}   `);
  });

  it("pads a wide cell by its column count", () => {
    expect(padAlign("古", 5)).toBe("古   ");
  });
});

describe("wrapLines()", () => {
  it("returns a short line whole", () => {
    expect(wrapLines("hello", 10)).toEqual(["hello"]);
  });

  it("breaks greedily on spaces", () => {
    expect(wrapLines("the quick brown fox jumps over", 10)).toEqual(["the quick", "brown fox", "jumps over"]);
  });

  it("honours an existing newline as a hard break", () => {
    expect(wrapLines("one\ntwo", 10)).toEqual(["one", "two"]);
  });

  it("keeps a blank line blank", () => {
    expect(wrapLines("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
  });

  it("breaks a word too long for a line of its own", () => {
    expect(wrapLines("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
  });

  it("finishes the current line before breaking an over-long word", () => {
    expect(wrapLines("hi abcdefghijkl", 5)).toEqual(["hi", "abcde", "fghij", "kl"]);
  });

  it("wraps by visible width, so a styled line is not broken early", () => {
    expect(wrapLines(`${RED}the quick${DEFAULT_FG} brown`, 10)).toEqual([`${RED}the quick${DEFAULT_FG}`, "brown"]);
  });

  it("returns the input's own lines when the width cannot hold anything", () => {
    expect(wrapLines("one\ntwo", 0)).toEqual(["one", "two"]);
  });
});

describe("wrapLines() across a style", () => {
  it("closes and reopens a style the wrap itself broke", () => {
    // Without this the open sits on one line and the close on the next, so anything drawn between
    // them — a grid's border, most visibly — is painted in the cell's colour.
    expect(wrapLines(`${RED}create on --commit${DEFAULT_FG}`, 10)).toEqual([`${RED}create on${RESET}`, `${RED}--commit${DEFAULT_FG}`]);
  });

  it("leaves a style that was already closed on the same line alone", () => {
    expect(wrapLines(`${RED}one${DEFAULT_FG} two`, 10)).toEqual([`${RED}one${DEFAULT_FG} two`]);
  });

  it("carries two nested styles onto the next line", () => {
    expect(wrapLines(`${RED}${BOLD}aaa bbb${NOT_BOLD}${DEFAULT_FG}`, 3)).toEqual([
      `${RED}${BOLD}aaa${RESET}`,
      `${RED}${BOLD}bbb${NOT_BOLD}${DEFAULT_FG}`,
    ]);
  });

  it("drops a style a reset had already cancelled", () => {
    expect(wrapLines(`${RED}aaa${RESET} bbb ccc`, 7)).toEqual([`${RED}aaa${RESET} bbb`, "ccc"]);
  });

  it("adds nothing to text that carries no style", () => {
    expect(wrapLines("aaa bbb", 3)).toEqual(["aaa", "bbb"]);
  });

  it("hard-breaks a styled word without eating the characters behind the reset", () => {
    // Each cut used to be sliced by the head's byte length, which includes a reset `truncate`
    // appends and `hardBreak` never asked for — four visible characters lost per break.
    expect(wrapLines(`${RED}abcdefghijklmnopqrstuvwxyz${DEFAULT_FG}`, 5)).toEqual([
      `${RED}abcde${RESET}`,
      "fghij",
      "klmno",
      "pqrst",
      "uvwxy",
      `z${DEFAULT_FG}`,
    ]);
  });
});
