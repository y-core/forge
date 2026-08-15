import { describe, expect, it } from "bun:test";
import { buildTheme, lightDark, liveRatios, matchPreset, PRESET_CUSTOM, SCHEME_PRESETS, scaleVars, stepProperty } from "./theme-contract";

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

describe("preset derivation", () => {
  // Which preset the dials name is derived on every read. Seeding a signal for it would make the
  // repaint that keeps it current a signal write inside an effect, which the runtime refuses.
  it("names the custom sentinel for dials that sit between schemes", () => {
    expect(matchPreset({ ...DEFAULTS, grayHue: 120, grayChroma: 77 })?.id ?? PRESET_CUSTOM).toBe(PRESET_CUSTOM);
  });
});

describe("scaleVars", () => {
  const pairs = scaleVars("gray", buildTheme(DEFAULTS).gray);

  it("declares each of the twelve properties exactly once", () => {
    expect(pairs).toHaveLength(12);
    expect(new Set(pairs.map(([name]) => name)).size).toBe(12);
    expect(pairs[0]?.[0]).toBe(stepProperty("gray", 0));
  });

  it("writes a solid in the OKLCh the ramp is authored in, both modes in one value", () => {
    expect(pairs[10]).toEqual(["--gray-11", "light-dark(oklch(50.32% 0 0), oklch(76.99% 0 0))"]);
  });

  it("writes both branches for the accent solid step, which the two ramps no longer agree on", () => {
    const accent = scaleVars("accent", buildTheme(DEFAULTS).accent);
    expect(accent[8]).toEqual(["--accent-9", "light-dark(oklch(52.00% 0.1950 267.0), oklch(50.75% 0.1950 267.0))"]);
  });
});

describe("liveRatios", () => {
  // No dial position fails a floor any more, so the failing branch is only reachable from a theme the
  // customiser cannot produce. Built here rather than swept for, so the branch stays covered.
  it("marks a pair that misses its floor with ✗", () => {
    const theme = buildTheme(DEFAULTS);
    (theme.accent.dark.solid as unknown as string[])[8] = "#fdfdfd";

    const primary = liveRatios(theme).find((row) => row.token === "--primary-foreground" && row.mode === "dark");
    expect(primary?.text.endsWith("✗")).toBe(true);
    expect(primary?.value).toBeLessThan(primary?.floor ?? 0);
  });
});
