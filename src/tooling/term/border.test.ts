import { describe, expect, it } from "bun:test";

import type { BorderSlot, BorderStyle } from "./border";
import { BORDERS } from "./border";

const SLOTS: readonly (keyof BorderStyle)[] = [
  "topLeft",
  "topBody",
  "topJoin",
  "topRight",
  "joinLeft",
  "joinBody",
  "joinJoin",
  "joinRight",
  "bodyLeft",
  "bodyJoin",
  "bodyRight",
  "bottomLeft",
  "bottomBody",
  "bottomJoin",
  "bottomRight",
];

const drawn = (char: string): BorderSlot => ({ char, width: 1 });
const SKIP: BorderSlot = { char: "", width: 0 };

describe("BORDERS", () => {
  it("names exactly the four presets renderGrid accepts", () => {
    expect(Object.keys(BORDERS)).toEqual(["none", "ascii", "single", "markdown"]);
  });

  it("is frozen, so a caller cannot swap a preset for the whole process", () => {
    expect(Object.isFrozen(BORDERS)).toBe(true);
  });

  for (const preset of ["none", "ascii", "single", "markdown"] as const) {
    it(`gives ${preset} all fifteen slots`, () => {
      expect(Object.keys(BORDERS[preset]).sort()).toEqual([...SLOTS].sort());
    });

    it(`gives every ${preset} slot a width matching whether it draws`, () => {
      const wrong = SLOTS.filter((slot) => {
        const { char, width } = BORDERS[preset][slot];
        return width !== (char === "" ? 0 : 1);
      });
      expect(wrong).toEqual([]);
    });
  }
});

describe("BORDERS.none", () => {
  it("skips every slot, which is what leaves columns separated by the grid gap alone", () => {
    expect(SLOTS.filter((slot) => BORDERS.none[slot].width !== 0)).toEqual([]);
  });

  it("carries the empty character in every slot", () => {
    expect(BORDERS.none.bodyJoin).toEqual(SKIP);
  });
});

describe("BORDERS.ascii", () => {
  it("boxes the grid in characters every terminal has", () => {
    expect(BORDERS.ascii).toEqual({
      topLeft: drawn("+"),
      topBody: drawn("-"),
      topJoin: drawn("+"),
      topRight: drawn("+"),
      joinLeft: drawn("+"),
      joinBody: drawn("-"),
      joinJoin: drawn("+"),
      joinRight: drawn("+"),
      bodyLeft: drawn("|"),
      bodyJoin: drawn("|"),
      bodyRight: drawn("|"),
      bottomLeft: drawn("+"),
      bottomBody: drawn("-"),
      bottomJoin: drawn("+"),
      bottomRight: drawn("+"),
    });
  });
});

describe("BORDERS.single", () => {
  it("boxes the grid in single-line box-drawing characters", () => {
    expect(BORDERS.single).toEqual({
      topLeft: drawn("┌"),
      topBody: drawn("─"),
      topJoin: drawn("┬"),
      topRight: drawn("┐"),
      joinLeft: drawn("├"),
      joinBody: drawn("─"),
      joinJoin: drawn("┼"),
      joinRight: drawn("┤"),
      bodyLeft: drawn("│"),
      bodyJoin: drawn("│"),
      bodyRight: drawn("│"),
      bottomLeft: drawn("└"),
      bottomBody: drawn("─"),
      bottomJoin: drawn("┴"),
      bottomRight: drawn("┘"),
    });
  });
});

describe("BORDERS.markdown", () => {
  it("draws pipes and the header rule, and skips the lines above and below", () => {
    expect(BORDERS.markdown).toEqual({
      topLeft: SKIP,
      topBody: SKIP,
      topJoin: SKIP,
      topRight: SKIP,
      joinLeft: drawn("|"),
      joinBody: drawn("-"),
      joinJoin: drawn("|"),
      joinRight: drawn("|"),
      bodyLeft: drawn("|"),
      bodyJoin: drawn("|"),
      bodyRight: drawn("|"),
      bottomLeft: SKIP,
      bottomBody: SKIP,
      bottomJoin: SKIP,
      bottomRight: SKIP,
    });
  });
});
