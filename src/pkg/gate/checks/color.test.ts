import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio as uiContrastRatio, relativeLuminance as uiRelativeLuminance } from "../../../ui/contracts/color";
import { contrastRatio, oklchToPaintedHex, parseOklch, relativeLuminance } from "./color";
import { type Mode, parseThemeDeclarations, resolveStep } from "./contrast-parse";

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

// The collapse onto `light-dark()` restated every solid step in OKLCh. Because the emitted
// coordinates are already gamut-mapped, the mapping converter that wrote them and the clipping
// converter a browser uses must land on the same byte — so this one table proves both that the
// rounding is lossless and that the mapping happened.
/** Every solid step the scheme files declared at v0.0.85, when each mode was its own block of hex. */
const V0_0_85: Readonly<Record<string, Readonly<Record<Mode, readonly string[]>>>> = {
  "theme-neutral.css gray": {
    light: ["#f9f9f9", "#fcfcfc", "#f0f0f0", "#e8e8e8", "#e0e0e0", "#d9d9d9", "#cecece", "#bbbbbb", "#8d8d8d", "#838383", "#646464", "#202020"],
    dark: ["#111111", "#191919", "#222222", "#2a2a2a", "#313131", "#3a3a3a", "#484848", "#606060", "#6e6e6e", "#7b7b7b", "#b4b4b4", "#eeeeee"],
  },
  "theme-neutral.css accent": {
    light: ["#fdfdfe", "#f7f9ff", "#edf2fe", "#e0e9ff", "#d1dfff", "#bed1ff", "#a6bff9", "#88a6ef", "#375bd7", "#2f50cc", "#3a5bc7", "#1d2d5c"],
    dark: ["#0f141f", "#121826", "#17244a", "#1c2e63", "#243975", "#2d4385", "#365098", "#405db3", "#375bd7", "#476cde", "#96b4ff", "#d5e1ff"],
  },
  "theme-stone.css gray": {
    light: ["#f9f9f8", "#fcfcfb", "#f0f0ef", "#e9e8e6", "#e2dfde", "#dcd8d6", "#d1cdcb", "#bfbab7", "#938c87", "#89827c", "#69635d", "#231f1e"],
    dark: ["#13100f", "#1b1816", "#252120", "#2e2927", "#35302d", "#3e3935", "#4c4742", "#655f59", "#746d67", "#817974", "#b8b3af", "#efeeed"],
  },
  "theme-gray.css gray": {
    light: ["#f8f9fa", "#fbfcfd", "#eff0f2", "#e7e8eb", "#dee0e4", "#d6d9de", "#cbced4", "#b6bbc4", "#878d99", "#7d8390", "#5d6571", "#19202d"],
    dark: ["#0b111c", "#131926", "#1b222f", "#222b37", "#29323f", "#323b48", "#404956", "#59616e", "#686e7b", "#757b88", "#afb5bd", "#edeef1"],
  },
  "theme-slate.css gray": {
    light: ["#f7f9fb", "#fbfcfe", "#ecf1f6", "#e3e9f1", "#d9e1eb", "#d1dae6", "#c4d0de", "#aebdcf", "#7d8fa7", "#73859e", "#54657e", "#152034"],
    dark: ["#081023", "#10182c", "#172236", "#1e2a3f", "#243247", "#2c3b51", "#394960", "#506179", "#5e6f89", "#6b7c96", "#a7b6c9", "#e9eff5"],
  },
};

describe("the shipped scheme files, read the way the audit reads them", () => {
  it("paints every declared step to the hex its two-block predecessor carried", () => {
    const drift: string[] = [];

    for (const [key, baseline] of Object.entries(V0_0_85)) {
      const [file = "", family = ""] = key.split(" ");
      const declared = parseThemeDeclarations(readFileSync(new URL(`../../../ui/assets/css/${file}`, import.meta.url).pathname, "utf-8"));

      for (const mode of ["light", "dark"] as const) {
        baseline[mode].forEach((want, step) => {
          const property = `--${family}-${step + 1}`;
          const value = resolveStep(declared, mode, property)?.value;
          if (value === undefined) {
            drift.push(`${file} ${mode} ${property}: declared nowhere`);
            return;
          }
          const oklch = parseOklch(value);
          if (oklch === null) {
            drift.push(`${file} ${mode} ${property}: \`${value}\` is not an oklch() the gate parses`);
            return;
          }
          const painted = oklchToPaintedHex(oklch.l, oklch.c, oklch.h);
          if (painted !== want) drift.push(`${file} ${mode} ${property}: \`${value}\` paints ${painted}, was ${want}`);
        });
      }
    }

    expect(drift).toEqual([]);
  });
});
