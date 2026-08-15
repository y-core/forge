/** The two blocks a scheme file declares. Matches `Mode` in `src/pkg/gate/checks/contrast-parse.ts`. @public */
export type Mode = "light" | "dark";

/** A twelve-position scale, as a tuple rather than an array. @public */
export type Scale<T> = readonly [T, T, T, T, T, T, T, T, T, T, T, T];

/** A colour in OKLCh: lightness 0–1, chroma (0–0.4 in practice), hue in degrees. @public */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** The fixed half of a scale: per-step lightness, and per-step chroma as weights in 0–1. @public */
export interface Ramp {
  readonly lightness: Scale<number>;
  readonly chroma: Scale<number>;
}

/** The two free parameters. `hue` is degrees; `chroma` is the ramp's **peak** chroma. @public */
export interface Dials {
  readonly hue: number;
  readonly chroma: number;
}

// Light steps 1 and 2 are non-monotone on purpose: forge swaps them so `--card` reads as raised
// above `--background` without the semantic layer needing a `.dark` twin.
/** The neutral scale's lightness, and the tint shape every scheme applies over it. @public */
export const GRAY_RAMP: Readonly<Record<Mode, Ramp>> = {
  light: {
    lightness: [0.9821, 0.9911, 0.9551, 0.931, 0.9067, 0.8853, 0.8514, 0.7921, 0.6434, 0.61, 0.5032, 0.2435],
    chroma: [0.076, 0.063, 0.19, 0.279, 0.358, 0.425, 0.52, 0.675, 0.922, 0.964, 1, 0.921],
  },
  dark: {
    lightness: [0.1776, 0.2134, 0.252, 0.285, 0.3132, 0.3485, 0.4017, 0.4891, 0.5382, 0.5829, 0.7699, 0.9491],
    chroma: [0.902, 0.905, 0.901, 0.924, 0.925, 0.949, 0.963, 0.961, 1, 0.98, 0.697, 0.226],
  },
};

/** The accent scale's lightness, and the chroma shape a scheme's accent dials apply over it. @public */
export const ACCENT_RAMP: Readonly<Record<Mode, Ramp>> = {
  light: {
    lightness: [0.9943, 0.9823, 0.9609, 0.9346, 0.9019, 0.862, 0.8062, 0.7309, 0.52, 0.4868, 0.5092, 0.3126],
    chroma: [0.007, 0.042, 0.087, 0.159, 0.241, 0.346, 0.448, 0.575, 1, 1, 0.883, 0.439],
  },
  dark: {
    // Step 9 is bounded on both sides: below by step 8's 0.5021, which it must stay above for the
    // ramp to ascend; above by the 4.5:1 floor `--primary-foreground` holds against `--gray-12`,
    // which 0.5075 clears by 0.09 at the worst of the four dials.
    lightness: [0.1909, 0.2094, 0.2716, 0.3185, 0.3625, 0.4033, 0.4491, 0.5021, 0.5075, 0.5653, 0.7759, 0.9108],
    chroma: [0.129, 0.158, 0.369, 0.495, 0.546, 0.582, 0.629, 0.715, 1, 0.92, 0.596, 0.224],
  },
};

/** The two scales a generated scheme declares. @public */
export type ScaleFamily = "gray" | "accent";

/** The highest peak chroma each family's dial reaches. @public */
export const CHROMA_MAX: Readonly<Record<ScaleFamily, number>> = { gray: 0.1, accent: 0.2 };

const GAMUT_EPSILON = 1e-4;

function srgbGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function srgbLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function clip01(c: number): number {
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

function inGamut(rgb: readonly [number, number, number]): boolean {
  return rgb.every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

function byte(c: number): string {
  return Math.round(clip01(c) * 255)
    .toString(16)
    .padStart(2, "0");
}

// Out-of-gamut colours are brought in by reducing chroma at constant lightness and hue, as CSS
// Color 4 specifies; clipping channels instead would shift the hue.
/** The nearest OKLCh coordinate sRGB can represent, reached by reducing chroma alone. @public */
export function toSrgbGamut(l: number, c: number, h: number): Oklch {
  const hRad = (h * Math.PI) / 180;
  const cos = Math.cos(hRad);
  const sin = Math.sin(hRad);

  if (inGamut(oklabToLinearSrgb(l, c * cos, c * sin))) return { l, c, h };
  if (l >= 1) return { l: 1, c: 0, h };
  if (l <= 0) return { l: 0, c: 0, h };

  let lo = 0;
  let hi = c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearSrgb(l, mid * cos, mid * sin))) lo = mid;
    else hi = mid;
  }
  return { l, c: lo, h };
}

// Hue is dropped at zero chroma rather than printed: it is noise there, and a varying number would
// make two identical greys read as two colours.
/** An OKLCh coordinate as the `oklch()` a scheme file carries. @public */
export function oklchCss(color: Oklch): string {
  const lightness = `${(color.l * 100).toFixed(2)}%`;
  const chroma = color.c.toFixed(4);
  return Number(chroma) === 0 ? `oklch(${lightness} 0 0)` : `oklch(${lightness} ${chroma} ${color.h.toFixed(1)})`;
}

/** OKLCh → `#rrggbb`. @public */
export function oklchToHex(l: number, c: number, h: number): string {
  const mapped = toSrgbGamut(l, c, h);
  const hRad = (mapped.h * Math.PI) / 180;
  const [r, g, b] = oklabToLinearSrgb(mapped.l, mapped.c * Math.cos(hRad), mapped.c * Math.sin(hRad));
  return `#${byte(srgbGamma(r))}${byte(srgbGamma(g))}${byte(srgbGamma(b))}`;
}

/** The three sRGB channels of a `#rrggbb` literal, as 0–1. Throws on any other shape. */
function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (match?.[1] === undefined) throw new Error(`not a #rrggbb colour: ${hex}`);
  const int = Number.parseInt(match[1], 16);
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

/** `#rrggbb` → OKLCh, the inverse of {@link oklchToHex}; hue is noise as chroma nears zero. @public */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex).map(srgbLinear) as [number, number, number];
  const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const b2 = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;

  const hue = (Math.atan2(b2, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b2), h: hue < 0 ? hue + 360 : hue };
}

// The 0.03928 threshold is WCAG SC 1.4.3's own, not sRGB's 0.04045 that `hexToOklch` uses: the
// pinned ratios are conformance numbers, so this reproduces WCAG's procedure, not an equivalent.
/** WCAG relative luminance of a `#rrggbb` colour. @public */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The order-independent WCAG contrast ratio between two opaque `#rrggbb` colours, 1–21. @public */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

function twelve<T>(f: (index: number) => T): Scale<T> {
  return STEPS.map(f) as unknown as Scale<T>;
}

// Lightness comes from the ramp and never from a dial, so no dial setting can move an audited
// contrast pair across its WCAG floor.
/** Twelve hex steps: the ramp's fixed lightness, its shape scaled by the chroma dial, at one hue. @public */
export function buildScale(ramp: Ramp, dials: Dials): Scale<string> {
  return twelve((i) => oklchToHex(ramp.lightness[i] ?? 0, (ramp.chroma[i] ?? 0) * dials.chroma, dials.hue));
}
