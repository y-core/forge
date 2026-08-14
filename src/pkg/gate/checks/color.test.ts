import { describe, expect, it } from "bun:test";
import { contrastRatio as uiContrastRatio, relativeLuminance as uiRelativeLuminance } from "../../../ui/contracts/color";
import { contrastRatio, oklchToPaintedHex, parseOklch, relativeLuminance } from "./color";

const SAMPLES = ["#000000", "#ffffff", "#646464", "#b4b4b4", "#f0f0f0", "#202020", "#c10007", "#ffa2a2", "#008236", "#1c398e"];

describe("WCAG maths — the standard", () => {
  it("gives black on white the maximum ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("gives a colour against itself a ratio of 1", () => {
    expect(contrastRatio("#646464", "#646464")).toBeCloseTo(1, 10);
  });

  it("is order-independent, as the definition is", () => {
    expect(contrastRatio("#646464", "#f0f0f0")).toBeCloseTo(contrastRatio("#f0f0f0", "#646464"), 10);
  });

  it("uses WCAG's transfer function, so mid-grey has its stated luminance", () => {
    expect(relativeLuminance("#808080")).toBeCloseTo(0.21586, 4);
  });
});

describe("agreement with src/ui/contracts/color.ts", () => {
  it("computes the same relative luminance for every sample", () => {
    for (const hex of SAMPLES) expect(relativeLuminance(hex)).toBeCloseTo(uiRelativeLuminance(hex), 12);
  });

  it("computes the same contrast ratio for every pair of samples", () => {
    for (const a of SAMPLES) {
      for (const b of SAMPLES) expect(contrastRatio(a, b)).toBeCloseTo(uiContrastRatio(a, b), 12);
    }
  });
});

describe("parseOklch()", () => {
  it("reads a percentage lightness, as Tailwind writes it", () => {
    expect(parseOklch("oklch(50.5% 0.213 27.518)")).toEqual({ l: 0.505, c: 0.213, h: 27.518 });
  });

  it("reads a 0–1 lightness, as a hand-written scheme writes it", () => {
    expect(parseOklch("oklch(0.505 0.213 27.518)")).toEqual({ l: 0.505, c: 0.213, h: 27.518 });
  });

  it("returns null for a hex literal", () => {
    expect(parseOklch("#646464")).toBeNull();
  });

  it("refuses an alpha component rather than dropping it", () => {
    expect(parseOklch("oklch(0.505 0.213 27.518 / 50%)")).toBeNull();
  });
});

describe("oklchToPaintedHex() — what Chromium paints", () => {
  it("reproduces an out-of-gamut Tailwind red", () => {
    expect(oklchToPaintedHex(0.505, 0.213, 27.518)).toBe("#c10007");
  });

  it("reproduces an out-of-gamut Tailwind light red", () => {
    expect(oklchToPaintedHex(0.808, 0.114, 19.571)).toBe("#ffa2a2");
  });

  it("agrees with the in-gamut case, where clipping and chroma reduction cannot differ", () => {
    expect(oklchToPaintedHex(0.5, 0, 0)).toBe("#636363");
  });

  it("differs from the generator's chroma-reduced conversion out of gamut", () => {
    expect(oklchToPaintedHex(0.505, 0.213, 27.518)).not.toBe("#bf000f");
  });
});
