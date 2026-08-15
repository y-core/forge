import {
  ACCENT_RAMP,
  buildAlphaScale,
  buildScale,
  contrastRatio,
  GRAY_RAMP,
  type Mode,
  oklchCss,
  type Ramp,
  type Scale,
  toSrgbGamut,
} from "./color";
import { CONTRAST_PAIRS, CRITERION } from "./contrast-pairs";

/** Resumable-scope name the customiser's lever panel stamps. @public */
export const CUSTOMISE_SCOPE = "customise";

/** The two scales a generated scheme declares. @public */
export type ScaleFamily = "gray" | "accent";

/** One lever: what it writes, what it is called, and where it may travel. @public */
export interface Dial {
  /** The `SignalRecord` field, the `data-field` the slider stamps, and the state key. */
  readonly field: string;
  /** The query-string parameter. */
  readonly param: string;
  /** The control's accessible name; must contain {@link short} verbatim. */
  readonly label: string;
  /** The family this dial belongs to, printed once per row, or `null` to stand alone. */
  readonly group: string | null;
  /** The part of {@link label} drawn beside the control, once the family has been printed. */
  readonly short: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value the shipped default scheme sits at, and what an absent parameter means. */
  readonly fallback: number;
  /** The unit the number is in, for the readout. */
  readonly unit: string;
}

/** The five levers, in the order they are rendered; chroma is carried in thousandths. @public */
export const DIALS: readonly Dial[] = [
  { field: "accentHue", param: "ah", label: "Accent hue", group: "Accent", short: "hue", min: 0, max: 360, step: 1, fallback: 267, unit: "°" },
  {
    field: "accentChroma",
    param: "ac",
    label: "Accent chroma",
    group: "Accent",
    short: "chroma",
    min: 0,
    max: 200,
    step: 1,
    fallback: 195,
    unit: "",
  },
  { field: "grayHue", param: "gh", label: "Gray hue", group: "Gray", short: "hue", min: 0, max: 360, step: 1, fallback: 0, unit: "°" },
  { field: "grayChroma", param: "gc", label: "Gray tint", group: "Gray", short: "tint", min: 0, max: 100, step: 1, fallback: 0, unit: "" },
  { field: "radius", param: "r", label: "Corner radius", group: null, short: "Corner radius", min: 0, max: 24, step: 1, fallback: 10, unit: "px" },
];

/** Groups `DIALS` into rows: consecutive dials sharing a `group` ride one row. @public */
export function leverRows(dials: readonly Dial[] = DIALS): readonly (readonly Dial[])[] {
  const rows: Dial[][] = [];
  for (const dial of dials) {
    const last = rows[rows.length - 1];
    if (dial.group !== null && last !== undefined && last[0]?.group === dial.group) last.push(dial);
    else rows.push([dial]);
  }
  return rows;
}

/** Every dial's value, keyed by field. The loader produces one; the scope rehydrates one. @public */
export type DialValues = Record<string, number>;

/** The dials as a query string. @public */
export function dialQuery(dials: DialValues): string {
  return DIALS.map((dial) => `${dial.param}=${dials[dial.field] ?? dial.fallback}`).join("&");
}

/** The input-only query parameter a preset travels under; an explicit `gh`/`gc` beside it wins. @public */
export const PRESET_PARAM = "p";

/** The `data-field` the preset picker stamps, where {@link PRESET_PARAM} is its URL spelling. @public */
export const PRESET_FIELD = "preset";

/** The option value standing for "no shipped scheme reproduces these dials". @public */
export const PRESET_CUSTOM = "";

/** A shipped scheme, and the gray dials that reproduce it. @public */
export interface SchemePreset {
  /** Matches the scheme file's name without its prefix — `stone` for `theme-stone.css`. */
  readonly id: string;
  readonly file: string;
  /** How the scheme reads, in one word. */
  readonly character: string;
  readonly grayHue: number;
  readonly grayChroma: number;
}

// Fitted, not transcribed: only `neutral` is byte-exact; the rest land within 3/255 per channel,
// and `color.test.ts` re-derives the fit against the real CSS files.
/** The four shipped schemes, as dial positions, with `grayChroma` in the dial's thousandths. @public */
export const SCHEME_PRESETS: readonly SchemePreset[] = [
  { id: "neutral", file: "theme-neutral.css", character: "achromatic", grayHue: 0, grayChroma: 0 },
  { id: "stone", file: "theme-stone.css", character: "warm", grayHue: 43, grayChroma: 11 },
  { id: "gray", file: "theme-gray.css", character: "cool", grayHue: 252, grayChroma: 23 },
  { id: "slate", file: "theme-slate.css", character: "strongly cool", grayHue: 258, grayChroma: 42 },
];

/** The shipped scheme a set of dials reproduces, or `undefined` when they sit between presets. @public */
export function matchPreset(dials: DialValues): SchemePreset | undefined {
  return SCHEME_PRESETS.find((preset) => dials.grayHue === preset.grayHue && dials.grayChroma === preset.grayChroma);
}

/** The gray dials a preset sets, and the only fields the picker drives. @public */
export const PRESET_FIELDS = ["grayHue", "grayChroma"] as const;

/** The customiser's scope state: every dial, plus the preset the dials currently name. @public */
export function customiseState(dials: DialValues): Record<string, number | string> {
  return { ...dials, [PRESET_FIELD]: matchPreset(dials)?.id ?? PRESET_CUSTOM };
}

/** The `--radius` token, which the customiser drives directly rather than through a scale. @public */
export const RADIUS_PROPERTY = "--radius";

/** The custom property a 0-indexed step is declared under — `--gray-11`, `--accent-a3`. @public */
export function stepProperty(family: ScaleFamily, step: number, kind: "solid" | "alpha" = "solid"): string {
  return `--${family}-${kind === "alpha" ? "a" : ""}${step + 1}`;
}

/** One value covering both modes, collapsed to a bare value where the two modes agree. @public */
export function lightDark(light: string, dark: string): string {
  return light === dark ? light : `light-dark(${light}, ${dark})`;
}

/** One family's twenty-four declarations as `[property, value]` pairs, each already mode-complete. @public */
export function scaleVars(family: ScaleFamily, scales: GeneratedTheme["gray"]): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let step = 0; step < 12; step++) {
    pairs.push([stepProperty(family, step), lightDark(scales.light.oklch[step] ?? "", scales.dark.oklch[step] ?? "")]);
  }
  for (let step = 0; step < 12; step++) {
    pairs.push([stepProperty(family, step, "alpha"), lightDark(scales.light.alpha[step] ?? "", scales.dark.alpha[step] ?? "")]);
  }
  return pairs;
}

// `solid` is kept beside `oklch` rather than derived from it: the overlay solver, the ratios, and
// the preview all work in the byte-quantised sRGB the hex names.
/** Both families, both modes — everything a scheme declares, from five numbers. @public */
export interface GeneratedTheme {
  readonly gray: Readonly<Record<Mode, { solid: Scale<string>; alpha: Scale<string>; oklch: Scale<string> }>>;
  readonly accent: Readonly<Record<Mode, { solid: Scale<string>; alpha: Scale<string>; oklch: Scale<string> }>>;
}

function buildFamily(ramp: Readonly<Record<Mode, Ramp>>, hue: number, chroma: number): GeneratedTheme["gray"] {
  const build = (mode: Mode) => {
    const solid = buildScale(ramp[mode], { hue, chroma });
    const oklch = solid.map((_, step) =>
      oklchCss(toSrgbGamut(ramp[mode].lightness[step] ?? 0, (ramp[mode].chroma[step] ?? 0) * chroma, hue)),
    ) as unknown as Scale<string>;
    return { solid, alpha: buildAlphaScale(solid, mode), oklch };
  };
  return { light: build("light"), dark: build("dark") };
}

/** The whole scheme, from the five dials; chroma arrives in {@link DIALS}' thousandths. @public */
export function buildTheme(dials: DialValues): GeneratedTheme {
  return {
    gray: buildFamily(GRAY_RAMP, dials.grayHue ?? 0, (dials.grayChroma ?? 0) / 1000),
    accent: buildFamily(ACCENT_RAMP, dials.accentHue ?? 0, (dials.accentChroma ?? 0) / 1000),
  };
}

/** The scheme as a `theme-*.css` file, ready to paste. @public */
export function schemeCss(theme: GeneratedTheme, dials: DialValues): string {
  const declare = ([name, value]: readonly [string, string]) => `  ${name}: ${value};`;

  return [
    "/* Generated by the forge theme customiser.",
    `   Gray   hue ${dials.grayHue ?? 0}deg, chroma ${(dials.grayChroma ?? 0) / 1000}`,
    `   Accent hue ${dials.accentHue ?? 0}deg, chroma ${(dials.accentChroma ?? 0) / 1000}`,
    "",
    "   A scheme file is exactly this: twelve steps and twelve alpha steps per family, each declared",
    "   once. Every semantic token in theme-base.css resolves through them, so this is the whole of",
    "   re-theming. A step that differs by mode is written with light-dark(); theme-base.css sets the",
    "   color-scheme that picks the branch, so import that file and this one is complete. */",
    "",
    ":root {",
    ...scaleVars("gray", theme.gray).map(declare),
    "",
    ...scaleVars("accent", theme.accent).map(declare),
    "",
    `  --accent-contrast: ${lightDark("var(--gray-1)", "var(--gray-12)")};`,
    "}",
    "",
  ].join("\n");
}

/** The `data-` attribute marking a preview row, valued with the row's id. @public */
export const SCALE_ROW_ATTR = "data-scale-row";

/** The `data-` attribute marking a printed hex, valued with the 0-indexed step. @public */
export const HEX_ATTR = "data-hex";

/** The two rows of the preview: each generated scale, drawn on the surface it belongs to. @public */
export const SCALE_ROWS: readonly { readonly id: string; readonly mode: Mode; readonly label: string }[] = [
  { id: "light", mode: "light", label: "Light scale, light surface" },
  { id: "dark", mode: "dark", label: "Dark scale, dark surface" },
];

/** The five bands the twelve steps are drawn under; `span` must total twelve. @public */
export const STEP_SEGMENTS: readonly { readonly label: string; readonly span: number }[] = [
  { label: "Surfaces", span: 2 },
  { label: "Interactive", span: 3 },
  { label: "Decorative edges", span: 3 },
  { label: "Solid fills", span: 2 },
  { label: "Text and focus", span: 2 },
];

// The background is part of the key: `--input` is audited against two backgrounds, and a
// token-only key collapses those two rows onto one another in the lookup map.
/** The `data-ratio` value one cell carries. @public */
export function ratioKey(token: string, background: string, mode: Mode): string {
  return `${token}|${background}:${mode}`;
}

/** One computed cell: its handle, its number, and the exact text both writers print. @public */
export interface LiveRatio {
  readonly key: string;
  readonly token: string;
  readonly mode: Mode;
  readonly value: number;
  readonly floor: number;
  /** `"5.19:1 ✓"` — the exact text both the Worker and the browser print. */
  readonly text: string;
}

/** Every audited pair a generated scheme can actually be measured on, in both modes. @public */
export function liveRatios(theme: GeneratedTheme): readonly LiveRatio[] {
  const out: LiveRatio[] = [];
  for (const pair of CONTRAST_PAIRS) {
    if (pair.foreground.kind !== "scale" || pair.background.kind !== "scale") continue;
    const { floor } = CRITERION[pair.criterion];
    for (const mode of ["light", "dark"] as const) {
      const scale = theme.gray[mode].solid;
      const value = contrastRatio(scale[pair.foreground.step] ?? "", scale[pair.background.step] ?? "");
      out.push({
        key: ratioKey(pair.token, pair.background.token, mode),
        token: pair.token,
        mode,
        value,
        floor,
        text: `${value.toFixed(2)}:1 ${value >= floor ? "✓" : "✗"}`,
      });
    }
  }
  return out;
}
