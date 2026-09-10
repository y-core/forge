import { describe, expect, it } from "bun:test";

import {
  buildTheme,
  DIALS,
  dialQuery,
  lightDark,
  liveRatios,
  matchPreset,
  PRESET_CUSTOM,
  SCHEME_PRESETS,
  SHAPE_PROPERTIES,
  scaleVars,
  shapeVars,
  stepProperty,
} from "./theme-contract";
import type { DialValues } from "./types";

const DEFAULTS = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };

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

describe("shapeVars", () => {
  it("writes every shape property once, in the order SHAPE_PROPERTIES declares", () => {
    expect(shapeVars(DEFAULTS).map(([name]) => name)).toEqual([...SHAPE_PROPERTIES]);
  });

  it("puts the two outer control heights 8px either side of the dialled middle one", () => {
    expect(shapeVars({ ...DEFAULTS, controlH: 48 })).toEqual([
      ["--radius-field", "10px"],
      ["--radius-box", "16px"],
      ["--control-h-sm", "40px"],
      ["--control-h-md", "48px"],
      ["--control-h-lg", "56px"],
    ]);
  });

  it("falls back to the shipped shape when a dial is absent", () => {
    expect(shapeVars({})).toEqual([
      ["--radius-field", "10px"],
      ["--radius-box", "16px"],
      ["--control-h-sm", "32px"],
      ["--control-h-md", "40px"],
      ["--control-h-lg", "48px"],
    ]);
  });
});

describe("dialQuery — a dial that is not a finite number", () => {
  // `??` passes a NaN straight through, so a share URL came out `?ah=NaN` — a link that reproduces
  // nothing, and that `Number()` on the way back in turns into another NaN.
  it("falls back for a NaN dial rather than writing it into the URL", () => {
    const dials: DialValues = {};
    for (const dial of DIALS) dials[dial.field] = Number.NaN;

    const query = dialQuery(dials);

    expect(query.includes("NaN")).toBe(false);
    expect(query).toBe(dialQuery({}));
  });
});
