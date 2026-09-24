import { describe, expect, it } from "bun:test";

import { ESC } from "./ansi";
import { ansi256To16, COLOR_NAMES, createAnsiCodes, hexToRgb, rgbToAnsi256, STYLE_NAMES } from "./codes";
import type { AnsiColor } from "./types";

const NONE = { open: "", close: "" };
const code = (open: string | number, close: number) => ({ open: `${ESC}[${open}m`, close: `${ESC}[${close}m` });

describe("hexToRgb", () => {
  for (const [input, expected] of [
    ["#ff0000", [255, 0, 0]],
    ["ff0000", [255, 0, 0]],
    ["#00ff88", [0, 255, 136]],
    ["#0f8", [0, 255, 136]],
    ["0f8", [0, 255, 136]],
    ["#ABC", [170, 187, 204]],
    ["#000000", [0, 0, 0]],
    ["#ffffff", [255, 255, 255]],
  ] as const) {
    it(`reads ${input} as ${expected.join(",")}`, () => {
      expect(hexToRgb(input)).toEqual([...expected]);
    });
  }

  for (const input of ["", "#", "#ff00", "#gggggg", "#1234567", "rebeccapurple", "  #ff0000  "]) {
    it(`falls back to black on ${JSON.stringify(input)}`, () => {
      expect(hexToRgb(input)).toEqual([0, 0, 0]);
    });
  }
});

describe("rgbToAnsi256", () => {
  for (const [r, g, b, expected] of [
    [0, 0, 0, 16],
    [7, 7, 7, 16],
    [255, 255, 255, 231],
    [249, 249, 249, 231],
    [128, 128, 128, 244],
    [8, 8, 8, 232],
    [248, 248, 248, 255],
    [255, 0, 0, 196],
    [0, 255, 0, 46],
    [0, 0, 255, 21],
  ] as const) {
    it(`maps rgb(${r}, ${g}, ${b}) to ${expected}`, () => {
      expect(rgbToAnsi256(r, g, b)).toBe(expected);
    });
  }
});

describe("ansi256To16", () => {
  for (const [input, expected] of [
    [0, 30],
    [7, 37],
    [8, 90],
    [15, 97],
    [16, 30],
    [21, 94],
    [196, 91],
    [231, 97],
    [232, 30],
    [255, 37],
  ] as const) {
    it(`maps palette entry ${input} to ${expected}`, () => {
      expect(ansi256To16(input)).toBe(expected);
    });
  }
});

describe("COLOR_NAMES and STYLE_NAMES", () => {
  it("names thirty-six colours and eight styles", () => {
    expect([COLOR_NAMES.length, STYLE_NAMES.length]).toEqual([36, 8]);
  });

  it("has a code for every published name, so the table and the chainable surface cannot drift", () => {
    const codes = createAnsiCodes(3);
    const missing = [...COLOR_NAMES.filter((n) => codes.colors[n] === undefined), ...STYLE_NAMES.filter((n) => codes.styles[n] === undefined)];
    expect(missing).toEqual([]);
  });
});

describe("createAnsiCodes(0)", () => {
  const codes = createAnsiCodes(0);

  it("gives every colour the empty pair", () => {
    expect(COLOR_NAMES.filter((n) => codes.colors[n].open !== "" || codes.colors[n].close !== "")).toEqual([]);
  });

  it("gives every style the empty pair", () => {
    expect(STYLE_NAMES.filter((n) => codes.styles[n].open !== "" || codes.styles[n].close !== "")).toEqual([]);
  });

  it("emits nothing from any value method", () => {
    const { ansi256, bgAnsi256, rgb, bgRgb, hex, bgHex } = codes.methods;
    expect([ansi256(196), bgAnsi256(196), rgb(255, 0, 0), bgRgb(255, 0, 0), hex("#ff0000"), bgHex("#ff0000")]).toEqual([
      NONE,
      NONE,
      NONE,
      NONE,
      NONE,
      NONE,
    ]);
  });
});

describe("createAnsiCodes(3)", () => {
  const codes = createAnsiCodes(3);

  for (const [name, open, close] of [
    ["black", 30, 39],
    ["red", 31, 39],
    ["white", 37, 39],
    ["redBright", 91, 39],
    ["bgRed", 41, 49],
    ["bgWhite", 47, 49],
    ["bgRedBright", 101, 49],
  ] as const) {
    it(`opens ${name} with ${open} and closes it with ${close}`, () => {
      expect(codes.colors[name as AnsiColor]).toEqual(code(open, close));
    });
  }

  it("spells bright black three ways that are the same pair", () => {
    expect([codes.colors.gray, codes.colors.grey]).toEqual([code(90, 39), code(90, 39)]);
  });

  it("spells the background bright black three ways that are the same pair", () => {
    expect([codes.colors.bgGray, codes.colors.bgGrey]).toEqual([code(100, 49), code(100, 49)]);
  });

  for (const [name, open, close] of [
    ["reset", 0, 0],
    ["bold", 1, 22],
    ["dim", 2, 22],
    ["italic", 3, 23],
    ["underline", 4, 24],
    ["inverse", 7, 27],
    ["hidden", 8, 28],
    ["strikethrough", 9, 29],
  ] as const) {
    it(`opens ${name} with ${open} and closes it with ${close}`, () => {
      expect(codes.styles[name]).toEqual(code(open, close));
    });
  }

  it("emits truecolor for rgb and its background", () => {
    expect([codes.methods.rgb(255, 0, 0), codes.methods.bgRgb(0, 128, 255)]).toEqual([code("38;2;255;0;0", 39), code("48;2;0;128;255", 49)]);
  });

  it("emits the 256-palette form for ansi256 and its background", () => {
    expect([codes.methods.ansi256(196), codes.methods.bgAnsi256(196)]).toEqual([code("38;5;196", 39), code("48;5;196", 49)]);
  });

  it("routes hex through rgb", () => {
    expect([codes.methods.hex("#0f8"), codes.methods.bgHex("#0f8")]).toEqual([code("38;2;0;255;136", 39), code("48;2;0;255;136", 49)]);
  });
});

describe("createAnsiCodes(2)", () => {
  const codes = createAnsiCodes(2);

  it("degrades rgb to the nearest 256-palette entry", () => {
    expect([codes.methods.rgb(255, 0, 0), codes.methods.bgRgb(255, 0, 0)]).toEqual([code("38;5;196", 39), code("48;5;196", 49)]);
  });

  it("leaves an explicit 256-palette entry alone", () => {
    expect(codes.methods.ansi256(196)).toEqual(code("38;5;196", 39));
  });

  it("degrades hex the same way rgb is degraded", () => {
    expect(codes.methods.hex("#ff0000")).toEqual(code("38;5;196", 39));
  });

  it("leaves the named colours at their basic codes", () => {
    expect(codes.colors.red).toEqual(code(31, 39));
  });
});

describe("createAnsiCodes(1)", () => {
  const codes = createAnsiCodes(1);

  it("degrades a 256-palette entry to a basic code", () => {
    expect([codes.methods.ansi256(196), codes.methods.bgAnsi256(196)]).toEqual([code(91, 39), code(101, 49)]);
  });

  it("degrades rgb through the palette to a basic code", () => {
    expect([codes.methods.rgb(255, 0, 0), codes.methods.bgRgb(255, 0, 0)]).toEqual([code(91, 39), code(101, 49)]);
  });

  it("degrades hex through the palette to a basic code", () => {
    expect([codes.methods.hex("#ff0000"), codes.methods.bgHex("#ff0000")]).toEqual([code(91, 39), code(101, 49)]);
  });

  it("degrades an unparseable hex to the code black maps to", () => {
    expect(codes.methods.hex("not-a-colour")).toEqual(code(30, 39));
  });
});
