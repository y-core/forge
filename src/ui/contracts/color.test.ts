import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { oklchToSrgb, toHex } from "../../assets/build/color";
import {
  ACCENT_RAMP,
  buildAlphaScale,
  buildScale,
  CHROMA_MAX,
  contrastRatio,
  GRAY_RAMP,
  hexToOklch,
  type Mode,
  oklchToHex,
  relativeLuminance,
  type Scale,
} from "./color";
import { CONTRAST_PAIRS, CRITERION, scalePairs } from "./contrast-pairs";
import { SCHEME_PRESETS } from "./theme-contract";

/** The scheme files this module claims to reproduce, transcribed from `theme-neutral.css`. */
const NEUTRAL: Readonly<Record<Mode, Scale<string>>> = {
  light: ["#f9f9f9", "#fcfcfc", "#f0f0f0", "#e8e8e8", "#e0e0e0", "#d9d9d9", "#cecece", "#bbbbbb", "#8d8d8d", "#838383", "#646464", "#202020"],
  dark: ["#111111", "#191919", "#222222", "#2a2a2a", "#313131", "#3a3a3a", "#484848", "#606060", "#6e6e6e", "#7b7b7b", "#b4b4b4", "#eeeeee"],
};

function shippedScale(file: string): Record<Mode, readonly string[]> {
  const text = readFileSync(new URL(`../assets/css/${file}`, import.meta.url).pathname, "utf-8");
  const block = (selector: string): readonly string[] => {
    const start = text.indexOf(selector);
    if (start === -1) throw new Error(`${file}: no ${selector} block`);
    const chunk = text.slice(start, text.indexOf("}", start));
    return Array.from({ length: 12 }, (_, i) => {
      const hex = chunk.match(new RegExp(`--gray-${i + 1}:\\s*(#[0-9a-f]{6})`))?.[1];
      if (hex === undefined) throw new Error(`${file}: no --gray-${i + 1} in ${selector}`);
      return hex;
    });
  };
  return { light: block(":root {"), dark: block(".dark {") };
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

  it("holds every audited floor for each shipped scheme as the preset generates it", () => {
    const failures: string[] = [];
    for (const preset of SCHEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const scale = buildScale(GRAY_RAMP[mode], { hue: preset.grayHue, chroma: preset.grayChroma / 1000 });
        for (const pair of scalePairs()) {
          const ratio = contrastRatio(scale[pair.foreground.step] ?? "", scale[pair.background.step] ?? "");
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

  it("gives the accent solid the same colour in both modes, which --accent-contrast depends on", () => {
    const dials = { hue: 267, chroma: 0.195 };
    expect(buildScale(ACCENT_RAMP.light, dials)[8]).toBe(buildScale(ACCENT_RAMP.dark, dials)[8]);
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

describe("the dial model's safety claim", () => {
  it("clears every audited floor at every hue, across the whole chroma range", () => {
    const failures: string[] = [];
    let tightest = { margin: Number.POSITIVE_INFINITY, detail: "" };

    for (let hue = 0; hue < 360; hue += 5) {
      for (const chroma of [0, 0.02, 0.045, CHROMA_MAX.gray]) {
        for (const mode of ["light", "dark"] as const) {
          const scale = buildScale(GRAY_RAMP[mode], { hue, chroma });
          for (const pair of scalePairs()) {
            const ratio = contrastRatio(scale[pair.foreground.step] ?? "", scale[pair.background.step] ?? "");
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

  it("covers the six pairs a generated scheme can actually be measured on", () => {
    expect(scalePairs().map((pair) => pair.token)).toEqual(["--foreground", "--muted-foreground", "--input", "--input", "--track", "--ring"]);
  });

  it("leaves every other pair beyond the gray dials' reach", () => {
    const unreachable = CONTRAST_PAIRS.filter((pair) => pair.foreground.kind === "fixed" || pair.background.kind === "fixed");
    expect(unreachable).toHaveLength(17);
    expect(CONTRAST_PAIRS).toHaveLength(23);
  });
});

/** Composite an `#rrggbbaa` overlay onto an opaque `#rrggbb` backdrop, the way a browser would. */
function composite(overlay: string, backdrop: string): string {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const alpha = Number.parseInt(overlay.slice(7, 9), 16) / 255;
  const bytes = [0, 1, 2].map((i) =>
    Math.round((alpha * channel(overlay, i) + (1 - alpha) * channel(backdrop, i)) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${bytes.join("")}`;
}

describe("buildAlphaScale", () => {
  it("emits twelve 8-digit hex overlays", () => {
    const alpha = buildAlphaScale(buildScale(GRAY_RAMP.light, { hue: 0, chroma: 0 }), "light");
    expect(alpha).toHaveLength(12);
    for (const step of alpha) expect(step).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("composites back to its own solid step over the page, for both modes and a tinted scheme", () => {
    const cases: { mode: Mode; dials: { hue: number; chroma: number } }[] = [
      { mode: "light", dials: { hue: 0, chroma: 0 } },
      { mode: "dark", dials: { hue: 0, chroma: 0 } },
      { mode: "light", dials: { hue: 256, chroma: 0.045 } },
      { mode: "dark", dials: { hue: 256, chroma: 0.045 } },
    ];

    for (const { mode, dials } of cases) {
      const scale = buildScale(GRAY_RAMP[mode], dials);
      const alpha = buildAlphaScale(scale, mode);
      const wrong = alpha
        .map((overlay, i) => ({ step: i + 1, got: composite(overlay, scale[0]), want: scale[i] ?? "" }))
        .filter(({ got, want }) => got !== want);
      expect(wrong).toEqual([]);
    }
  });

  it("reaches light step 2 by falling back to a white base", () => {
    const scale = buildScale(GRAY_RAMP.light, { hue: 0, chroma: 0 });
    const step2 = buildAlphaScale(scale, "light")[1];
    expect(step2.startsWith("#ffffff")).toBe(true);
    expect(composite(step2, scale[0])).toBe(scale[1]);
  });

  it("makes step 1 fully transparent, since it is the page itself", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(buildAlphaScale(buildScale(GRAY_RAMP[mode], { hue: 0, chroma: 0 }), mode)[0]).toBe("#00000000");
    }
  });
});
