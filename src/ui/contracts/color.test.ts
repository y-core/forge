/**
 * The colour module's own tests, **and** the cross-namespace agreement test that pays for its
 * existence.
 *
 * `src/assets/build/color.ts` implements the same OKLab transform and the same gamut mapping, and
 * `EDGES` in `scripts/namespace-graph.ts` forbids either source importing the other. This file
 * imports both. Tests are excluded from the namespace-graph parse, so the assertion can cross the
 * boundary the source cannot — which is the whole mitigation for a knowing duplication: drift
 * between the two becomes a red gate rather than a divergence nobody is watching for.
 */

import { describe, expect, it } from "bun:test";
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

/** The scheme files this module claims to reproduce, transcribed from `theme-neutral.css`. */
const NEUTRAL: Readonly<Record<Mode, Scale<string>>> = {
  light: ["#f9f9f9", "#fcfcfc", "#f0f0f0", "#e8e8e8", "#e0e0e0", "#d9d9d9", "#cecece", "#bbbbbb", "#8d8d8d", "#838383", "#646464", "#202020"],
  dark: ["#111111", "#191919", "#222222", "#2a2a2a", "#313131", "#3a3a3a", "#484848", "#606060", "#6e6e6e", "#7b7b7b", "#b4b4b4", "#eeeeee"],
};

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

    // Reported in full rather than as a count: a drift is a specific colour at a specific point,
    // and "1 of 1560 differ" would send the reader back to the grid to find which.
    expect(disagreements.map(({ p, mine, theirs }) => `oklch(${p.l} ${p.c} ${p.h}) — contracts ${mine}, build ${theirs}`)).toEqual([]);
  });

  it("agrees on the out-of-gamut colours, where the two gamut mappings could diverge", () => {
    // Both must reduce chroma at constant lightness and hue rather than clip channels. A clipping
    // implementation agrees with a reducing one on everything in gamut, so only these points can
    // catch that difference.
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
    // The distinguishing property of CSS Color 4 gamut mapping. A channel-clipping implementation
    // shifts hue badly here — this green is well outside sRGB at chroma 0.4.
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
    // The two halves of the live audit row, to two decimals — the same numbers
    // `scripts/contrast-parse.ts` records as measured. If this module disagreed with the audit,
    // every live readout on the customiser would be quietly wrong.
    expect(contrastRatio("#646464", "#f0f0f0")).toBeCloseTo(5.19, 2);
    expect(contrastRatio("#b4b4b4", "#222222")).toBeCloseTo(7.67, 2);
  });
});

describe("buildScale", () => {
  it("reproduces theme-neutral.css byte for byte at chroma 0", () => {
    // The anchor test for the whole generator. `GRAY_RAMP.lightness` was measured *from* this file,
    // so this asserts the extraction and the conversion are jointly exact — a rounding error
    // anywhere in either would show up as a wrong byte here.
    for (const mode of ["light", "dark"] as const) {
      expect(buildScale(GRAY_RAMP[mode], { hue: 0, chroma: 0 })).toEqual(NEUTRAL[mode]);
    }
  });

  it("ignores the hue entirely when chroma is 0", () => {
    for (const hue of [0, 90, 217, 359]) {
      expect(buildScale(GRAY_RAMP.light, { hue, chroma: 0 })).toEqual(NEUTRAL.light);
    }
  });

  it("keeps light steps 1 and 2 non-monotone, as forge's swap requires", () => {
    // `--card` reads as raised only because step 2 is lighter than step 1. A ramp "tidied" into
    // monotonicity would invert every raised surface in light mode, and nothing else would fail.
    const scale = buildScale(GRAY_RAMP.light, { hue: 250, chroma: 0.045 });
    expect(relativeLuminance(scale[1])).toBeGreaterThan(relativeLuminance(scale[0]));
  });

  it("holds one hue across the steps that carry enough chroma to have one", () => {
    const scale = buildScale(GRAY_RAMP.light, { hue: 256, chroma: 0.045 });
    const drift = (step: number) => Math.abs(hexToOklch(scale[step] ?? "").h - 256);

    // Steps 3–12 read back within 2.5° of the dial. That is the generated scale's distinguishing
    // property: the shipped schemes wander several degrees per step because each was authored stop
    // by stop.
    for (let step = 2; step < 12; step++) expect(drift(step)).toBeLessThan(2.5);

    // Steps 1 and 2 are 8°+ off, and that is not a defect to fix — it is the point made from the
    // other side. Their chroma is 0.0029, where one 8-bit quantisation step swamps the signal, so
    // the "hue" of a near-achromatic colour is arithmetic on rounding error. This is the same
    // effect that makes the shipped stone scheme report hues 72° apart across steps 1–3.
    expect(drift(0)).toBeGreaterThan(5);
    expect(drift(1)).toBeGreaterThan(5);
  });

  it("gives the accent a materially darker step 9 than the gray ramp", () => {
    // Risk 1 of the customiser plan, made executable. Step 9 is the solid a brand colour is seen
    // as; at the gray ramp's lightness a saturated hue reads washed out. If someone ever collapses
    // the two ramps into one, this is what says no.
    const gray = hexToOklch(buildScale(GRAY_RAMP.light, { hue: 267, chroma: 0.045 })[8]);
    const accent = hexToOklch(buildScale(ACCENT_RAMP.light, { hue: 267, chroma: 0.195 })[8]);
    expect(gray.l - accent.l).toBeGreaterThan(0.08);
  });

  it("reconstructs Radix indigo everywhere the ramp still follows it", () => {
    // `ACCENT_RAMP` was measured from these twelve colours, so this is the extraction checked
    // against its source. It cannot be byte-exact: Radix authored each step independently and its
    // hue wanders 267°–271° down the scale, where a generated scale holds one hue throughout.
    //
    // The residual is exactly that wander, which is why it is not spread evenly. Step 11 — Radix's
    // own hue there is 267.2, the hue this is generated at — comes back **byte-identical**. Steps 7
    // and 8, where Radix sits at 271.4 and 270.4, are the worst at 5. A tolerance of 5 is therefore
    // a statement about Radix's authoring, not slack in the maths.
    //
    // **Steps 9 and 10 are excluded, and deliberately.** They are the one place the ramp departs
    // from indigo: step 9 sits at lightness 0.52 rather than 0.5438 so that near-white on the solid
    // clears 1.4.3 with margin in dark mode, where indigo's own value measures 4.49. Step 10 moves
    // with it to keep the 9→10 hover gap. Their exclusion is asserted below rather than skipped, so
    // this reads as a recorded departure rather than a tolerance quietly widened to cover it.
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

    // The departure, stated as a number. Step 9 is meaningfully darker than indigo's — if someone
    // ever restores 0.5438 this fails, which is the point: the contrast margin it buys is recorded
    // in `TOKEN_CONTRACT` as `--primary-foreground` at 4.97:1 in dark, and that row would silently
    // become 4.49 without it.
    expect(delta(8)).toBeGreaterThan(5);
    expect(relativeLuminance(built[8] ?? "")).toBeLessThan(relativeLuminance(indigo[8] ?? ""));
  });

  it("gives the accent solid the same colour in both modes, which --accent-contrast depends on", () => {
    // A neutral inverts between modes; a brand colour must not, or it stops being the brand. That
    // is what lets `--accent-contrast` be near-white in *both* blocks — and it has to be exact,
    // not approximately equal, because a one-byte drift would make the contract row's two halves
    // measurements of two different colours.
    const dials = { hue: 267, chroma: 0.195 };
    expect(buildScale(ACCENT_RAMP.light, dials)[8]).toBe(buildScale(ACCENT_RAMP.dark, dials)[8]);
  });

  it("keeps step 10 a visible hover on step 9, in the right direction for each mode", () => {
    // Step 10 is the hover on step 9's solid, so it is the *gap* that has a job. Darkening 9 alone
    // would have left the two 0.009 apart in light and made the hover invisible.
    const dials = { hue: 267, chroma: 0.195 };
    const light = buildScale(ACCENT_RAMP.light, dials);
    const dark = buildScale(ACCENT_RAMP.dark, dials);
    // Light hovers darker, dark hovers lighter — each away from its own page.
    expect(relativeLuminance(light[9])).toBeLessThan(relativeLuminance(light[8]));
    expect(relativeLuminance(dark[9])).toBeGreaterThan(relativeLuminance(dark[8]));
    expect(contrastRatio(light[8], light[9])).toBeGreaterThan(1.1);
    expect(contrastRatio(dark[8], dark[9])).toBeGreaterThan(1.1);
  });
});

describe("the dial model's safety claim", () => {
  it("clears every audited floor at every hue, across the whole chroma range", () => {
    // **This is the claim the customiser rests on**, and the reason its levers can be offered
    // without a warning: lightness is fixed by the ramp, so no setting of the free parameters can
    // push an audited pair under its floor. Argued in prose it is plausible; here it is executed.
    //
    // Swept rather than spot-checked because the failure would not be uniform — WCAG luminance is
    // not OKLCh lightness, and chroma's effect on it depends on hue (a yellow at a given lightness
    // is far more luminous than a blue at the same one). So the worst case lives at some particular
    // hue, and only a sweep finds it.
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
    // The margin is asserted as well as the pass, because "clears its floor" is a weaker statement
    // than it sounds when the margin is 0.01. It is not: the tightest point in the whole space is
    // `--input` in light mode, which lands near 3.19:1 against a 3:1 floor.
    expect(tightest.margin).toBeGreaterThan(0.1);
  });

  it("covers the four pairs a generated scheme can actually be measured on", () => {
    // Guards the sweep above against silently testing nothing. If `scalePairs()` ever returned an
    // empty list — a refactor mistyping `kind`, say — every assertion above would still pass.
    expect(scalePairs().map((pair) => pair.token)).toEqual(["--muted-foreground", "--input", "--track", "--ring"]);
  });

  it("leaves every other pair beyond the gray dials' reach", () => {
    // The complement, and it is a result rather than a caveat: every remaining pair has at least one
    // side the gray dials cannot move — a fixed Tailwind stop for most, and for
    // `--primary-foreground` a mode-varying role that no single scale index describes. That is why
    // a readout may honestly report them as unaffected instead of recomputing them.
    const unreachable = CONTRAST_PAIRS.filter((pair) => pair.foreground.kind === "fixed" || pair.background.kind === "fixed");
    expect(unreachable).toHaveLength(12);
    expect(CONTRAST_PAIRS).toHaveLength(16);
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
    // The one property a derived alpha scale can actually promise — Radix's hand-tuned values are
    // not reproducible by any formula, so this is what stands in for them. Checked on the tinted
    // scheme too, because that is where the overlay stops being neutral and the channel-wise solve
    // starts doing real work.
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
    // Forge swaps light steps 1 and 2, so step 2 is *lighter* than the page. A black overlay cannot
    // reproduce it at any alpha; a mode-fixed base would emit `#00000000` and silently lose the
    // step. This is the assertion that the fallback exists rather than the scale merely looking
    // plausible.
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
