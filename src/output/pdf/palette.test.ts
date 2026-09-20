import { describe, expect, test } from "bun:test";

import { createPdfPalette } from "./palette";

describe("createPdfPalette", () => {
  test("converts #rrggbb to device RGB fractions, which is what PDF's operands are", () => {
    const palette = createPdfPalette({ brand: "#1f4e79" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("brand")).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255]);
  });

  test("accepts an opaque #rrggbbaa and drops the alpha channel", () => {
    const palette = createPdfPalette({ brand: "#1f4e79ff" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("brand")).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255]);
  });

  test("carries a non-opaque alpha as a fourth component, which is what renders it", () => {
    const palette = createPdfPalette({ wash: "#1f4e7980" });
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("wash")).toEqual([0x1f / 255, 0x4e / 255, 0x79 / 255, 0x80 / 255]);
  });

  test("answers undefined for a colour the document never named", () => {
    const palette = createPdfPalette({ brand: "#000000" });
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
      const palette = createPdfPalette({ brand: notation });
      expect(palette.ok).toBe(false);
      if (palette.ok) return;
      expect(palette.error.kind).toBe("colour-notation");
      expect(palette.error.message).toContain("brand");
    });
  }

  test("carries no colour of its own, so an empty scheme answers undefined for every name", () => {
    const palette = createPdfPalette({});
    expect(palette.ok).toBe(true);
    if (!palette.ok) return;
    expect(palette.data.ink("brand")).toBeUndefined();
  });
});
