import { describe, expect, it } from "bun:test";
import {
  buildTheme,
  customiseState,
  lightDark,
  matchPreset,
  PRESET_CUSTOM,
  PRESET_FIELD,
  SCHEME_PRESETS,
  scaleVars,
  stepProperty,
} from "./theme-contract";

const DEFAULTS = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10 };

describe("lightDark", () => {
  it("writes both branches when the modes differ", () => {
    expect(lightDark("oklch(98.21% 0 0)", "oklch(17.76% 0 0)")).toBe("light-dark(oklch(98.21% 0 0), oklch(17.76% 0 0))");
  });

  it("collapses to the bare value when they agree, since there is nothing to select between", () => {
    expect(lightDark("#00000000", "#00000000")).toBe("#00000000");
  });
});

describe("matchPreset", () => {
  // The client drives a preset → dials → preset loop, which terminates on this round trip naming
  // the scheme it was handed rather than a second, different one.
  it("names back every scheme its own dials reproduce", () => {
    for (const preset of SCHEME_PRESETS) {
      expect(matchPreset({ ...DEFAULTS, grayHue: preset.grayHue, grayChroma: preset.grayChroma })).toBe(preset);
    }
  });

  it("names nothing for dials that sit between schemes", () => {
    expect(matchPreset({ ...DEFAULTS, grayHue: 120, grayChroma: 77 })).toBeUndefined();
  });
});

describe("customiseState", () => {
  it("carries every dial beside the preset the dials name", () => {
    const slate = SCHEME_PRESETS.find((preset) => preset.id === "slate");
    expect(customiseState({ ...DEFAULTS, grayHue: slate?.grayHue ?? 0, grayChroma: slate?.grayChroma ?? 0 })).toEqual({
      ...DEFAULTS,
      grayHue: slate?.grayHue ?? 0,
      grayChroma: slate?.grayChroma ?? 0,
      [PRESET_FIELD]: "slate",
    });
  });

  it("seeds the custom option when no scheme reproduces the dials", () => {
    expect(customiseState({ ...DEFAULTS, grayHue: 120, grayChroma: 77 })[PRESET_FIELD]).toBe(PRESET_CUSTOM);
  });
});

describe("scaleVars", () => {
  const pairs = scaleVars("gray", buildTheme(DEFAULTS).gray);

  it("declares each of the twenty-four properties exactly once", () => {
    expect(pairs).toHaveLength(24);
    expect(new Set(pairs.map(([name]) => name)).size).toBe(24);
    expect(pairs[0]?.[0]).toBe(stepProperty("gray", 0));
    expect(pairs[12]?.[0]).toBe(stepProperty("gray", 0, "alpha"));
  });

  it("writes a solid in the OKLCh the ramp is authored in, both modes in one value", () => {
    expect(pairs[10]).toEqual(["--gray-11", "light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0))"]);
  });

  it("leaves an alpha overlay as the eight-digit hex the solver fitted, never restated in OKLCh", () => {
    expect(pairs[14]).toEqual(["--gray-a3", "light-dark(#00000009, #ffffff12)"]);
    for (const [, value] of pairs.slice(12)) expect(value).toMatch(/^(light-dark\(#[0-9a-f]{8}, #[0-9a-f]{8}\)|#[0-9a-f]{8})$/);
  });

  it("reads the accent's mode-identical solid step as one bare value", () => {
    const accent = scaleVars("accent", buildTheme(DEFAULTS).accent);
    expect(accent[8]).toEqual(["--accent-9", "oklch(52.00% 0.1950 267.0)"]);
  });
});
