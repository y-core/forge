import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { oklchToSrgb, toHex } from "../../../assets/build/color";
import {
  ACCENT_RAMP,
  buildScale,
  CHROMA_MAX,
  contrastRatio,
  GRAY_RAMP,
  hexToOklch,
  type Mode,
  oklchToHex,
  relativeLuminance,
  type Scale,
  type ScaleFamily,
} from "./color";
import { ACCENT_CONTRAST, CONTRAST_PAIRS, CRITERION, type ScalePair, scalePairs, sideStep } from "./contrast-pairs";
import { buildTheme, DIALS, liveRatios, SCHEME_PRESETS } from "./theme-contract";

/** A dial's shipped default — where `theme-neutral.css`'s accent position actually lives. */
function fallback(field: string): number {
  const dial = DIALS.find((row) => row.field === field);
  if (dial === undefined) throw new Error(`no dial named ${field}`);
  return dial.fallback;
}

/** The pairs a sweep of the *gray* dials describes — an accent side measured on a gray ramp describes nothing. */
function grayPairs(): readonly ScalePair[] {
  return scalePairs().filter((pair) => pair.foreground.family === "gray" && pair.background.family === "gray");
}

/** One gray pair's ratio on a single built scale. */
function grayRatio(scale: Scale<string>, pair: ScalePair, mode: Mode): number {
  return contrastRatio(scale[sideStep(pair.foreground, mode)] ?? "", scale[sideStep(pair.background, mode)] ?? "");
}

/** The scheme files this module claims to reproduce, transcribed from `theme-neutral.css`. */
const NEUTRAL: Readonly<Record<Mode, Scale<string>>> = {
  light: ["#f9f9f9", "#fcfcfc", "#f0f0f0", "#e8e8e8", "#e0e0e0", "#d9d9d9", "#cecece", "#bbbbbb", "#8d8d8d", "#838383", "#646464", "#202020"],
  dark: ["#111111", "#191919", "#222222", "#2a2a2a", "#313131", "#3a3a3a", "#484848", "#606060", "#6e6e6e", "#7b7b7b", "#b4b4b4", "#eeeeee"],
};

/** An `oklch(L% C H)` literal back to the hex it names, so a declared step can be compared to a built one. */
function declaredHex(value: string): string {
  const parsed = /^oklch\(([0-9.]+)% ([0-9.]+) ([0-9.]+)\)$/.exec(value.trim());
  if (parsed === null) throw new Error(`not an oklch() literal: ${value}`);
  return oklchToHex(Number(parsed[1]) / 100, Number(parsed[2]), Number(parsed[3]));
}

// A scheme declares each step once, so the two modes are read off the argument positions of one
// `light-dark()` rather than off two blocks; a step equal in both modes is written bare.
function shippedScale(file: string, family: ScaleFamily = "gray"): Record<Mode, readonly string[]> {
  const text = readFileSync(new URL(`../../assets/css/${file}`, import.meta.url).pathname, "utf-8");
  const start = text.indexOf(":root {");
  if (start === -1) throw new Error(`${file}: no :root block`);
  const chunk = text.slice(start, text.indexOf("}", start));

  const scale: Record<Mode, string[]> = { light: [], dark: [] };
  for (let i = 0; i < 12; i++) {
    const declared = chunk.match(new RegExp(`--${family}-${i + 1}:\\s*([^;]+);`))?.[1];
    if (declared === undefined) throw new Error(`${file}: no --${family}-${i + 1} in :root`);
    const branches = /^light-dark\((.+?), (.+)\)$/.exec(declared.trim());
    scale.light.push(declaredHex(branches?.[1] ?? declared));
    scale.dark.push(declaredHex(branches?.[2] ?? declared));
  }
  return scale;
}

/** The largest per-channel gap between two `#rrggbb` literals, in bytes out of 255. */
function channelDistance(a: string, b: string): number {
  let worst = 0;
  for (let i = 1; i < 7; i += 2) {
    worst = Math.max(worst, Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)));
  }
  return worst;
}

/** A grid over the whole space the customiser can reach, plus the degenerate ends. */
function sample(): { l: number; c: number; h: number }[] {
  const points: { l: number; c: number; h: number }[] = [];
  for (let l = 0; l <= 1.0001; l += 0.1) {
    for (let c = 0; c <= 0.3001; c += 0.05) {
      for (let h = 0; h < 360; h += 30) points.push({ l, c, h });
    }
  }
  return points;
}

describe("agreement with src/assets/build/color.ts", () => {
  it("produces the identical hex for every point of an oklch grid", () => {
    const disagreements = sample()
      .map((p) => ({ p, mine: oklchToHex(p.l, p.c, p.h), theirs: toHex(oklchToSrgb(p.l, p.c, p.h)) }))
      .filter(({ mine, theirs }) => mine !== theirs);

    expect(disagreements.map(({ p, mine, theirs }) => `oklch(${p.l} ${p.c} ${p.h}) — contracts ${mine}, build ${theirs}`)).toEqual([]);
  });

  it("agrees on the out-of-gamut colours, where the two gamut mappings could diverge", () => {
    for (const h of [0, 60, 120, 180, 240, 300]) {
      expect(oklchToHex(0.5, 0.4, h)).toBe(toHex(oklchToSrgb(0.5, 0.4, h)));
    }
  });
});

describe("oklchToHex", () => {
  it("converts the achromatic ends exactly", () => {
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
  });

  it("stays in `#rrggbb` shape for a colour far outside sRGB", () => {
    expect(oklchToHex(0.7, 0.4, 150)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("holds the hue while reducing chroma, rather than clipping channels", () => {
    const mapped = hexToOklch(oklchToHex(0.7, 0.4, 150));
    expect(mapped.h).toBeCloseTo(150, 0);
    expect(mapped.c).toBeLessThan(0.4);
  });
});

describe("hexToOklch", () => {
  it("round-trips every step of the shipped neutral scheme", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const hex of NEUTRAL[mode]) {
        const { l, c, h } = hexToOklch(hex);
        expect(oklchToHex(l, c, h)).toBe(hex);
      }
    }
  });

  it("reports zero chroma for a gray", () => {
    expect(hexToOklch("#808080").c).toBeCloseTo(0, 4);
  });

  it("rejects anything that is not a `#rrggbb` literal", () => {
    expect(() => hexToOklch("#fff")).toThrow("not a #rrggbb colour: #fff");
    expect(() => hexToOklch("rgb(0 0 0)")).toThrow();
    expect(() => hexToOklch("#00000000")).toThrow();
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("puts black and white at the ends of the WCAG range", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrastRatio("#646464", "#646464")).toBeCloseTo(1, 10);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#646464", "#f0f0f0")).toBeCloseTo(contrastRatio("#f0f0f0", "#646464"), 10);
  });

  it("reproduces the ratios TOKEN_CONTRACT pins for --muted-foreground", () => {
    expect(contrastRatio("#646464", "#f0f0f0")).toBeCloseTo(5.19, 2);
    expect(contrastRatio("#b4b4b4", "#222222")).toBeCloseTo(7.67, 2);
  });
});

describe("buildScale", () => {
  it("reproduces theme-neutral.css byte for byte at chroma 0", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(buildScale(GRAY_RAMP[mode], { hue: 0, chroma: 0 })).toEqual(NEUTRAL[mode]);
    }
  });

  it("reconstructs every shipped scheme from its preset's two dials", () => {
    const drift: string[] = [];
    for (const preset of SCHEME_PRESETS) {
      const declared = shippedScale(preset.file);
      for (const mode of ["light", "dark"] as const) {
        const generated = buildScale(GRAY_RAMP[mode], { hue: preset.grayHue, chroma: preset.grayChroma / 1000 });
        generated.forEach((hex, step) => {
          const target = declared[mode][step] ?? "";
          const bytes = channelDistance(hex, target);
          const allowed = preset.id === "neutral" ? 0 : 3;
          if (bytes > allowed) drift.push(`${preset.file} ${mode} step ${step + 1}: declared ${target}, generated ${hex} (${bytes} > ${allowed})`);
          const dLightness = Math.abs(hexToOklch(hex).l - hexToOklch(target).l);
          if (dLightness > 0.005) drift.push(`${preset.file} ${mode} step ${step + 1}: lightness off by ${dLightness.toFixed(4)}`);
        });
      }
    }
    expect(drift).toEqual([]);
  });

  // The preset sweep above covers gray only — no preset carries accent dials — so `ACCENT_RAMP` could
  // move without the stylesheet following it. This is the tie between the two.
  it("reconstructs theme-neutral.css's accent block from ACCENT_RAMP and the dials' fallbacks", () => {
    const declared = shippedScale("theme-neutral.css", "accent");
    const dials = { hue: fallback("accentHue"), chroma: fallback("accentChroma") / 1000 };
    for (const mode of ["light", "dark"] as const) {
      expect(buildScale(ACCENT_RAMP[mode], dials)).toEqual(declared[mode]);
    }
  });

  it("holds every audited floor for each shipped scheme as the preset generates it", () => {
    const failures: string[] = [];
    for (const preset of SCHEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const scale = buildScale(GRAY_RAMP[mode], { hue: preset.grayHue, chroma: preset.grayChroma / 1000 });
        for (const pair of grayPairs()) {
          const ratio = grayRatio(scale, pair, mode);
          const { floor } = CRITERION[pair.criterion];
          if (ratio < floor) failures.push(`${preset.id} ${mode} ${pair.token}: ${ratio.toFixed(2)} < ${floor}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("ignores the hue entirely when chroma is 0", () => {
    for (const hue of [0, 90, 217, 359]) {
      expect(buildScale(GRAY_RAMP.light, { hue, chroma: 0 })).toEqual(NEUTRAL.light);
    }
  });

  it("keeps light steps 1 and 2 non-monotone, as forge's swap requires", () => {
    const scale = buildScale(GRAY_RAMP.light, { hue: 250, chroma: 0.045 });
    expect(relativeLuminance(scale[1])).toBeGreaterThan(relativeLuminance(scale[0]));
  });

  it("holds one hue across the steps that carry enough chroma to have one", () => {
    const scale = buildScale(GRAY_RAMP.light, { hue: 256, chroma: 0.045 });
    const drift = (step: number) => Math.abs(hexToOklch(scale[step] ?? "").h - 256);

    for (let step = 2; step < 12; step++) expect(drift(step)).toBeLessThan(2.5);
    expect(drift(0)).toBeGreaterThan(5);
    expect(drift(1)).toBeGreaterThan(5);
  });

  it("gives the accent a materially darker step 9 than the gray ramp", () => {
    const gray = hexToOklch(buildScale(GRAY_RAMP.light, { hue: 267, chroma: 0.045 })[8]);
    const accent = hexToOklch(buildScale(ACCENT_RAMP.light, { hue: 267, chroma: 0.195 })[8]);
    expect(gray.l - accent.l).toBeGreaterThan(0.08);
  });

  it("reconstructs indigo everywhere the ramp still follows it", () => {
    const indigo = [
      "#fdfdfe",
      "#f7f9ff",
      "#edf2fe",
      "#e1e9ff",
      "#d2deff",
      "#c1d0ff",
      "#abbdf9",
      "#8da4ef",
      "#3e63dd",
      "#3358d4",
      "#3a5bc7",
      "#1f2d5c",
    ];
    const built = buildScale(ACCENT_RAMP.light, { hue: 267, chroma: 0.1954 });

    const channel = (hex: string, ch: number) => Number.parseInt(hex.slice(1 + ch * 2, 3 + ch * 2), 16);
    const delta = (i: number) => Math.max(...[0, 1, 2].map((ch) => Math.abs(channel(indigo[i] ?? "", ch) - channel(built[i] ?? "", ch))));

    const SOLID_BAND = [8, 9];
    for (let i = 0; i < 12; i++) {
      if (SOLID_BAND.includes(i)) continue;
      expect(delta(i)).toBeLessThanOrEqual(5);
    }
    expect(built[10]).toBe(indigo[10]);

    expect(delta(8)).toBeGreaterThan(5);
    expect(relativeLuminance(built[8] ?? "")).toBeLessThan(relativeLuminance(indigo[8] ?? ""));
  });

  // A mode-identical solid was the hazard, not a dependency: `--accent-contrast` is
  // `light-dark(--gray-1, --gray-12)` and never reads step 9, so one colour served both a light and a
  // dark foreground, and dark — the side with the darker foreground — had the smaller headroom.
  it("gives the accent solid a darker step 9 in dark than in light, which is what buys dark its headroom", () => {
    const dials = { hue: 267, chroma: 0.195 };
    const light = buildScale(ACCENT_RAMP.light, dials)[8];
    const dark = buildScale(ACCENT_RAMP.dark, dials)[8];
    expect(dark).not.toBe(light);
    expect(relativeLuminance(dark)).toBeLessThan(relativeLuminance(light));
  });

  it("keeps step 10 a visible hover on step 9, in the right direction for each mode", () => {
    const dials = { hue: 267, chroma: 0.195 };
    const light = buildScale(ACCENT_RAMP.light, dials);
    const dark = buildScale(ACCENT_RAMP.dark, dials);
    expect(relativeLuminance(light[9])).toBeLessThan(relativeLuminance(light[8]));
    expect(relativeLuminance(dark[9])).toBeGreaterThan(relativeLuminance(dark[8]));
    expect(contrastRatio(light[8], light[9])).toBeGreaterThan(1.1);
    expect(contrastRatio(dark[8], dark[9])).toBeGreaterThan(1.1);
  });
});

describe("the gray dials' safety claim", () => {
  it("clears every audited floor at every gray hue, across the whole gray chroma range", () => {
    const failures: string[] = [];
    let tightest = { margin: Number.POSITIVE_INFINITY, detail: "" };

    for (let hue = 0; hue < 360; hue += 5) {
      for (const chroma of [0, 0.02, 0.045, CHROMA_MAX.gray]) {
        for (const mode of ["light", "dark"] as const) {
          const scale = buildScale(GRAY_RAMP[mode], { hue, chroma });
          for (const pair of grayPairs()) {
            const ratio = grayRatio(scale, pair, mode);
            const { floor } = CRITERION[pair.criterion];
            const detail = `${pair.token} ${mode} hue=${hue} chroma=${chroma} — ${ratio.toFixed(2)}:1 against ${floor}:1`;
            if (ratio < floor) failures.push(detail);
            if (ratio - floor < tightest.margin) tightest = { margin: ratio - floor, detail };
          }
        }
      }
    }

    expect(failures).toEqual([]);
    expect(tightest.margin).toBeGreaterThan(0.1);
  });

  it("covers the seven pairs a generated scheme can actually be measured on", () => {
    expect(scalePairs().map((pair) => pair.token)).toEqual([
      "--foreground",
      "--muted-foreground",
      "--input",
      "--input",
      "--track",
      "--ring",
      "--primary-foreground",
    ]);
  });

  it("leaves every other pair beyond the dials' reach", () => {
    const unreachable = CONTRAST_PAIRS.filter((pair) => pair.foreground.kind === "fixed" || pair.background.kind === "fixed");
    expect(scalePairs().length + unreachable.length).toBe(CONTRAST_PAIRS.length);
    expect(unreachable).toHaveLength(16);
    expect(CONTRAST_PAIRS).toHaveLength(23);
  });
});

describe("a per-mode contrast side", () => {
  it("resolves to a different step in each mode, which is what --accent-contrast is", () => {
    expect(sideStep(ACCENT_CONTRAST, "light")).toBe(0);
    expect(sideStep(ACCENT_CONTRAST, "dark")).toBe(11);
  });

  it("resolves a uniform side to the same step in both modes", () => {
    const foreground = scalePairs()[0]?.foreground;
    if (foreground === undefined) throw new Error("no scale pair to read");
    expect(sideStep(foreground, "light")).toBe(sideStep(foreground, "dark"));
  });
});

// `--accent-contrast` is `--gray-1` in light but the darker `--gray-12` in dark, so the dark side has
// the smaller headroom at any given step 9. A high-chroma green once pushed it under the floor; the
// dark ramp's step 9 is lowered to 0.5075 to buy back the margin, so both modes now clear 4.5.
describe("the accent dials against the --primary-foreground floor", () => {
  const pair = scalePairs().find((row) => row.token === "--primary-foreground");
  if (pair === undefined) throw new Error("--primary-foreground is not a scale pair");

  const worst = (mode: Mode) => {
    // The gray dials sit at their defaults: this sweeps the two dials the finding is about, and the
    // foreground step is read through the same resolver the page uses.
    const foreground = NEUTRAL[mode][sideStep(pair.foreground, mode)] ?? "";
    let low = { ratio: Number.POSITIVE_INFINITY, hue: 0, chroma: 0 };
    for (let hue = 0; hue < 360; hue += 2) {
      for (let chroma = 0; chroma <= CHROMA_MAX.accent + 1e-9; chroma += 0.01) {
        const background = buildScale(ACCENT_RAMP[mode], { hue, chroma })[sideStep(pair.background, mode)] ?? "";
        const ratio = contrastRatio(foreground, background);
        if (ratio < low.ratio) low = { ratio, hue, chroma };
      }
    }
    return low;
  };

  it("holds the 4.5 floor everywhere in light, bottoming out around 4.85", () => {
    const low = worst("light");
    expect(low.ratio).toBeGreaterThan(4.5);
    expect(low.ratio).toBeCloseTo(4.85, 1);
  });

  it("holds the 4.5 floor in dark too, with the band of greens that once broke it bottoming out around 4.65", () => {
    const low = worst("dark");
    expect(low.ratio).toBeGreaterThan(4.5);
    expect(low.ratio).toBeCloseTo(4.65, 1);
    expect(low.hue).toBeGreaterThan(120);
    expect(low.hue).toBeLessThan(170);
  });

  it("is safe at the shipped defaults, in both modes", () => {
    const theme = buildTheme({ grayHue: 0, grayChroma: 0, accentHue: 267, accentChroma: 195, radius: 10 });
    for (const entry of liveRatios(theme).filter((row) => row.token === "--primary-foreground")) {
      expect(entry.value).toBeGreaterThan(4.5);
      expect(entry.text).toContain("✓");
    }
  });
});
