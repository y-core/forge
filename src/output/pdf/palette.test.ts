import { describe, expect, test } from "bun:test";

import { PDF_INK_NAMES, createPdfPalette } from "./palette";

describe("createPdfPalette", () => {
  test("converts #rrggbb to device RGB fractions, which is what PDF's operands are", () => {
    const palette = createPdfPalette({ heading: "#1f4e79" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("heading")).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255]);
  });

  test("accepts an opaque #rrggbbaa and drops the alpha channel", () => {
    const palette = createPdfPalette({ heading: "#1f4e79ff" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("heading")).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255]);
  });

  test("carries a non-opaque alpha as a fourth component, which is what renders it", () => {
    const palette = createPdfPalette({ letterhead: "#1f4e7980" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("letterhead")).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255, 0x80 / 255]);
  });

  test("answers undefined for a colour the document never named", () => {
    const palette = createPdfPalette({ heading: "#000000" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("rule")).toBeUndefined();
  });
});

describe("createPdfPalette — every other notation is refused by name", () => {
  const REFUSED = [
    { description: "a named colour", notation: "rebeccapurple" },
    { description: "an rgb() function", notation: "rgb(31, 78, 121)" },
    { description: "an HSL function", notation: "hsl(210 60% 30%)" },
    { description: "a three-digit shorthand", notation: "#1f4" },
    { description: "a hex with no hash", notation: "1f4e79" },
  ];

  for (const { description, notation } of REFUSED) {
    test(`refuses ${description}`, () => {
      const palette = createPdfPalette({ heading: notation });
      expect(palette.ok).toBe(false);
      if (palette.ok) return;
      expect(palette.error.kind).toBe("colour-notation");
      expect(palette.error.message).toContain("heading");
    });
  }

  test("carries no colour of its own, so an empty scheme answers undefined for every name", () => {
    const palette = createPdfPalette({});
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("heading")).toBeUndefined();
  });
});

// The defect this closes: `brand` was accepted, stored, never read by `channelFor`, and reported to
// the caller as a successful palette — the one input in the engine that was not refused by name.
describe("createPdfPalette — a name no page reads is refused too", () => {
  test("refuses a name the engine paints nothing with, naming it and what it expected", () => {
    const palette = createPdfPalette({ brand: "#1f4e79" } as never);
    expect(palette.ok).toBe(false);
    if (palette.ok) return;
    expect(palette.error.kind).toBe("colour-name");
    expect(palette.error.message).toContain("brand");
    expect(palette.error.message).toContain("heading, rule, letterhead, intro");
  });

  test("names every unread key rather than only the first, so one pass fixes the whole object", () => {
    const palette = createPdfPalette({ brand: "#1f4e79", wash: "#000000", rule: "#ffffff" } as never);
    expect(palette.ok).toBe(false);
    if (palette.ok) return;
    expect(palette.error.message).toContain("brand, wash");
  });

  // `in` walks the prototype chain, so these tested as known inks and were accepted — through the
  // JSON boundary the runtime guard exists for, which is where such a key actually arrives.
  test("refuses a name inherited from Object.prototype, which is no more an ink than any other", () => {
    for (const name of ["toString", "valueOf", "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]) {
      const palette = createPdfPalette(JSON.parse(`{"${name}":"#ffffff"}`) as never);
      expect(palette.ok).toBe(false);
      if (palette.ok) return;
      expect(palette.error.kind).toBe("colour-name");
      expect(palette.error.message).toContain(name);
    }
  });

  test("accepts every name it lists, so the refusal above cannot name an ink that does not work", () => {
    for (const name of PDF_INK_NAMES) {
      const palette = createPdfPalette({ [name]: "#1f4e79" });
      expect(palette.ok && palette.data.ink(name)).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255]);
    }
  });
});
