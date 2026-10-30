import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { oklchToPaintedHex, parseOklch } from "../../../tooling/gate/checks/color";
import { validateCommentBudget } from "../../../tooling/gate/checks/comment-budget-parse";
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
  schemeCss,
  shapeVars,
  splitLightDark,
  stepProperty,
} from "./theme-contract";
import type { DialValues, ScaleFamily } from "./types";

const DEFAULTS = { grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 115, radius: 10, radiusField: 10, radiusBox: 16, controlH: 40 };

describe("lightDark", () => {
  it("writes both branches when the modes differ", () => {
    expect(lightDark("oklch(98.21% 0 0)", "oklch(17.76% 0 0)")).toBe("light-dark(oklch(98.21% 0 0), oklch(17.76% 0 0))");
  });

  it("collapses to the bare value when they agree, since there is nothing to select between", () => {
    expect(lightDark("#00000000", "#00000000")).toBe("#00000000");
  });
});

describe("splitLightDark", () => {
  it("splits the two branches of a plain value", () => {
    expect(splitLightDark("light-dark(oklch(88.53% 0 0), oklch(34.85% 0 0))")).toEqual(["oklch(88.53% 0 0)", "oklch(34.85% 0 0)"]);
  });

  it("splits on the top-level comma, not the one inside a function", () => {
    expect(splitLightDark("light-dark(rgba(0, 0, 0, 0.4), rgba(255, 255, 255, 0.4))")).toEqual(["rgba(0, 0, 0, 0.4)", "rgba(255, 255, 255, 0.4)"]);
  });

  it("splits a pair of var() references, which is what a contrast step is", () => {
    expect(splitLightDark("light-dark(var(--gray-1), var(--gray-12))")).toEqual(["var(--gray-1)", "var(--gray-12)"]);
  });

  it("returns undefined for a value that is not a light-dark() at all", () => {
    expect(splitLightDark("oklch(88.53% 0 0)")).toBeUndefined();
    expect(splitLightDark("var(--gray-6)")).toBeUndefined();
    expect(splitLightDark("#d9d9d9")).toBeUndefined();
  });

  it("returns undefined for a light-dark() carrying no top-level comma", () => {
    expect(splitLightDark("light-dark(var(--gray-1))")).toBeUndefined();
  });

  it("splits a nested light-dark() at its own top-level comma, case-insensitively", () => {
    expect(splitLightDark("LIGHT-DARK( var(--a, #fff) , light-dark(#111, #222) )")).toEqual(["var(--a, #fff)", "light-dark(#111, #222)"]);
  });

  it("returns undefined for an unclosed light-dark() and for an empty value", () => {
    expect(splitLightDark("light-dark(#fff, #000")).toBeUndefined();
    expect(splitLightDark("")).toBeUndefined();
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
    expect(accent[8]).toEqual(["--accent-9", "light-dark(oklch(52.00% 0.1150 267.0), oklch(50.75% 0.1150 267.0))"]);
  });
});

describe("liveRatios", () => {
  // No dial position fails a floor, so the failing branch is only reachable from a theme the
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

  it("puts the two outer control heights 8px either side of the dialled middle one, in rem", () => {
    expect(shapeVars({ ...DEFAULTS, controlH: 48 }).slice(2)).toEqual([
      ["--control-h-sm", "2.5rem"],
      ["--control-h-md", "3rem"],
      ["--control-h-lg", "3.5rem"],
    ]);
  });

  it("writes each radius as an offset from --radius, so it follows the corner radius", () => {
    expect(shapeVars({ radius: 6, radiusField: 4, radiusBox: 12 }).slice(0, 2)).toEqual([
      ["--radius-field", "calc(var(--radius) - 0.125rem)"],
      ["--radius-box", "calc(var(--radius) + 0.375rem)"],
    ]);
  });

  it("falls back to exactly what theme-base.css declares when a dial is absent", () => {
    const base = readFileSync(join(import.meta.dir, "../../assets/css/theme-base.css"), "utf-8");
    const declared = (name: string) => base.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1];

    expect(shapeVars({})).toEqual(SHAPE_PROPERTIES.map((name) => [name, declared(name)]));
    expect(declared("--radius")).toBe("0.625rem");
  });
});

describe("schemeCss", () => {
  it("emits a file forge's own stylesheet comment budget passes, with the layer waiver still on line 1", () => {
    const css = schemeCss(buildTheme(DEFAULTS), DEFAULTS);

    expect(validateCommentBudget("theme-custom.css", css)).toEqual([]);
    expect(css.split("\n")[0]?.startsWith("/* modern-css-allow: forge-ui-platform-layer — ")).toBe(true);
  });

  it("declares no shape token for colour dials alone, or for shape dials at theme-base's values", () => {
    const colour = { grayHue: 43, grayChroma: 11, accentHue: 120, accentChroma: 90 };

    for (const dials of [colour, DEFAULTS]) expect(schemeCss(buildTheme(dials), dials)).not.toMatch(/--radius|--control-h|Shape/);
  });

  it("declares the whole shape block, --radius included, once a shape dial moves", () => {
    const dials = { ...DEFAULTS, controlH: 44 };
    const css = schemeCss(buildTheme(dials), dials);

    expect(css.slice(css.indexOf("/* Shape"))).toBe(
      [
        "/* Shape — save as shape-custom.css beside the scheme, or fold into it */",
        ":root {",
        "  --radius: 0.625rem;",
        "  --radius-field: var(--radius);",
        "  --radius-box: calc(var(--radius) + 0.375rem);",
        "  --control-h-sm: 2.25rem;",
        "  --control-h-md: 2.75rem;",
        "  --control-h-lg: 3.25rem;",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("dialQuery — a dial that is not a finite number", () => {
  it("falls back for a NaN dial rather than writing it into the URL", () => {
    const dials: DialValues = {};
    for (const dial of DIALS) dials[dial.field] = Number.NaN;

    const query = dialQuery(dials);

    expect(query.includes("NaN")).toBe(false);
    expect(query).toBe(dialQuery({}));
  });
});

describe("buildTheme against what its own scheme file paints", () => {
  const unpainted = (family: ScaleFamily, field: "accentChroma" | "grayChroma", hueField: "accentHue" | "grayHue"): string[] => {
    const dial = DIALS.find((row) => row.field === field);
    if (dial === undefined) throw new Error(`no dial named ${field}`);
    const found: string[] = [];
    for (let hue = 0; hue < 360; hue += 3) {
      for (let chroma = dial.min; chroma <= dial.max; chroma += dial.step) {
        const theme = buildTheme({ ...DEFAULTS, [hueField]: hue, [field]: chroma });
        for (const mode of ["light", "dark"] as const) {
          const { solid, oklch } = theme[family][mode];
          oklch.forEach((value, step) => {
            const point = parseOklch(value);
            const painted = point === null ? `unparsed ${value}` : oklchToPaintedHex(point.l, point.c, point.h);
            if (painted !== solid[step])
              found.push(`${family} hue=${hue} chroma=${chroma} ${mode} step ${step + 1}: ${value} paints ${painted}, reported ${solid[step]}`);
          });
        }
      }
    }
    return found;
  };

  it("reports the hex every accent step paints, at every accent chroma", () => {
    const found = unpainted("accent", "accentChroma", "accentHue");
    expect({ count: found.length, first: found.slice(0, 3) }).toEqual({ count: 0, first: [] });
  });

  it("reports the hex every gray step paints, at every gray tint", () => {
    const found = unpainted("gray", "grayChroma", "grayHue");
    expect({ count: found.length, first: found.slice(0, 3) }).toEqual({ count: 0, first: [] });
  });
});
