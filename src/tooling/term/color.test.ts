import { describe, expect, it } from "bun:test";

import { ESC } from "./ansi";
import { ansi256To16, createAnsiCodes, hexToRgb, rgbToAnsi256 } from "./codes";
import { createColorize, PLAIN } from "./color";

const sgr = (code: string) => `${ESC}[${code}m`;

describe("hexToRgb()", () => {
  it("expands a 3-digit hex", () => {
    expect(hexToRgb("#96C")).toEqual([153, 102, 204]);
  });

  it("reads a 6-digit hex", () => {
    expect(hexToRgb("#E0115F")).toEqual([224, 17, 95]);
  });

  it("reads a hex without the hash", () => {
    expect(hexToRgb("E0115F")).toEqual([224, 17, 95]);
  });

  it("falls back to black on anything unparseable", () => {
    expect(hexToRgb("#GGG")).toEqual([0, 0, 0]);
  });
});

describe("rgbToAnsi256() and ansi256To16()", () => {
  it("maps near-black to the greyscale floor", () => {
    expect(rgbToAnsi256(0, 0, 0)).toBe(16);
  });

  it("maps near-white to the greyscale ceiling", () => {
    expect(rgbToAnsi256(255, 255, 255)).toBe(231);
  });

  it("maps pure red into the colour cube", () => {
    expect(rgbToAnsi256(255, 0, 0)).toBe(196);
  });

  it("maps the first eight palette entries onto the basic codes", () => {
    expect([0, 1, 7].map(ansi256To16)).toEqual([30, 31, 37]);
  });

  it("maps the next eight onto the bright codes", () => {
    expect([8, 9].map(ansi256To16)).toEqual([90, 91]);
  });
});

describe("createAnsiCodes()", () => {
  it("emits nothing at level 0", () => {
    expect(createAnsiCodes(0).colors.red).toEqual({ open: "", close: "" });
  });

  it("emits the basic code at level 1", () => {
    expect(createAnsiCodes(1).colors.red).toEqual({ open: sgr("31"), close: sgr("39") });
  });

  it("spells a background colour with its own close", () => {
    expect(createAnsiCodes(1).colors.bgRed).toEqual({ open: sgr("41"), close: sgr("49") });
  });

  it("treats gray and grey as the same bright black", () => {
    const codes = createAnsiCodes(1);
    expect([codes.colors.gray, codes.colors.grey]).toEqual([codes.colors.blackBright, codes.colors.blackBright]);
  });

  it("degrades an RGB request to the nearest basic code at level 1", () => {
    expect(createAnsiCodes(1).methods.rgb(224, 17, 95).open).toBe(sgr("31"));
  });

  it("degrades an RGB request to a palette entry at level 2", () => {
    expect(createAnsiCodes(2).methods.rgb(224, 17, 95).open).toBe(sgr("38;5;162"));
  });

  it("emits the RGB triple at level 3", () => {
    expect(createAnsiCodes(3).methods.rgb(224, 17, 95).open).toBe(sgr("38;2;224;17;95"));
  });
});

describe("createColorize()", () => {
  const c = createColorize(1);

  it("reports the level it was built for", () => {
    expect(c.level).toBe(1);
  });

  it("wraps text in one style", () => {
    expect(c.red("x")).toBe(`${sgr("31")}x${sgr("39")}`);
  });

  it("composes a chain outermost-first", () => {
    expect(c.red.bold("x")).toBe(`${sgr("31")}${sgr("1")}x${sgr("22")}${sgr("39")}`);
  });

  it("returns the empty string untouched", () => {
    expect(c.red("")).toBe("");
  });

  it("memoizes a chain, so a table of cells does not rebuild it per cell", () => {
    expect(c.red.bold).toBe(c.red.bold);
  });

  it("restores the outer style after a nested one, rather than resetting", () => {
    expect(c.red(`${c.green("g")}y`)).toBe(`${sgr("31")}${sgr("32")}g${sgr("31")}y${sgr("39")}`);
  });

  it("closes and reopens across a newline, so a background does not bleed to the edge", () => {
    expect(c.bgRed("a\nb")).toBe(`${sgr("41")}a${sgr("49")}\n${sgr("41")}b${sgr("49")}`);
  });

  it("takes a hex colour", () => {
    expect(createColorize(3).hex("#E0115F")("x")).toBe(`${sgr("38;2;224;17;95")}x${sgr("39")}`);
  });

  it("takes an RGB triple", () => {
    expect(createColorize(3).rgb(224, 17, 95)("x")).toBe(`${sgr("38;2;224;17;95")}x${sgr("39")}`);
  });

  it("takes a palette entry", () => {
    expect(createColorize(2).ansi256(162)("x")).toBe(`${sgr("38;5;162")}x${sgr("39")}`);
  });

  it("chains onward from a style method", () => {
    expect(createColorize(3).hex("#E0115F").bold("x")).toBe(`${sgr("38;2;224;17;95")}${sgr("1")}x${sgr("22")}${sgr("39")}`);
  });

  it("strips escape sequences whatever produced them", () => {
    expect(c.strip(c.red.bold("x"))).toBe("x");
  });

  it("returns PLAIN at level 0", () => {
    expect(createColorize(0)).toBe(PLAIN);
  });
});

describe("PLAIN", () => {
  it("is level 0", () => {
    expect(PLAIN.level).toBe(0);
  });

  it("returns its input from any chain", () => {
    expect(PLAIN.red.bold.underline("x")).toBe("x");
  });

  it("returns its input from a style method", () => {
    expect(PLAIN.hex("#E0115F")("x")).toBe("x");
  });

  it("opens and closes nothing", () => {
    expect([PLAIN.open, PLAIN.close]).toEqual(["", ""]);
  });

  it("is frozen, so no caller can turn the shared no-op into something else", () => {
    expect(Object.isFrozen(PLAIN)).toBe(true);
  });
});
