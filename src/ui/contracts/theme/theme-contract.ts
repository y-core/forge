import {
  ACCENT_RAMP,
  buildScale,
  contrastRatio,
  GRAY_RAMP,
  type Mode,
  oklchCss,
  type Ramp,
  type Scale,
  type ScaleFamily,
  toSrgbGamut,
} from "./color";
import { ACCENT_CONTRAST, CRITERION, scalePairs, sideStep } from "./contrast-pairs";

export type { ScaleFamily } from "./color";

/** Resumable-scope name the customiser's lever panel stamps. @public */
export const CUSTOMISE_SCOPE = "customise";

// A second scope rather than a wider one: `runAction` walks to the nearest `[data-scope]`, so a copy
// button outside `CUSTOMISE_SCOPE` would fire nothing — and widening that scope over the page would
// hand `bindControls` every control in the compositions band.
/** Resumable-scope name the customiser's output block stamps, so a copy button has a scope to act in. @public */
export const COPY_SCOPE = "customise-copy";

/** The `data-on-click` action every copy button fires. @public */
export const COPY_ACTION = "copy";

/** The attribute a copy button carries, valued with its target's id. @public */
export const COPY_TARGET_ATTR = "data-copy-target";

/** The attribute on the span holding a copy button's swappable text. @public */
export const COPY_LABEL_ATTR = "data-copy-label";

/** The attribute on a copy button's `role='status'` span, valued with its target's id. @public */
export const COPY_STATUS_ATTR = "data-copy-status";

/** How long a copy button reads "Copied" before its own label returns. @public */
export const COPY_CONFIRM_MS = 2000;

/** One copy control: the element it reads, and the three things it can say. @public */
export interface CopyTarget {
  readonly id: string;
  /** The element whose `textContent` is copied — what is displayed is what is copied. */
  readonly source: string;
  readonly label: string;
  readonly copied: string;
  /** Announced through the status span, never through the button's accessible name. */
  readonly announce: string;
  readonly failed: string;
}

/** The two things the customiser hands you, and the control beside each. @public */
export const COPY_TARGETS: readonly CopyTarget[] = [
  {
    id: "url",
    source: "[data-share-url]",
    label: "Copy link",
    copied: "Copied",
    announce: "Share link copied to the clipboard",
    failed: "This browser will not let the page copy; select the link and copy it instead",
  },
  {
    id: "css",
    source: "[data-scheme-output] code",
    label: "Copy CSS",
    copied: "Copied",
    announce: "Scheme CSS copied to the clipboard",
    failed: "This browser will not let the page copy; select the CSS and copy it instead",
  },
];

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

/** The scope action a pick fires; picking is a command that writes the dials, never a field binding. @public */
export const PRESET_ACTION = "applyPreset";

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

/** The `--radius` token, which the customiser drives directly rather than through a scale. @public */
export const RADIUS_PROPERTY = "--radius";

/** The custom property a 0-indexed step is declared under — `--gray-11`. @public */
export function stepProperty(family: ScaleFamily, step: number): string {
  return `--${family}-${step + 1}`;
}

/** One value covering both modes, collapsed to a bare value where the two modes agree. @public */
export function lightDark(light: string, dark: string): string {
  return light === dark ? light : `light-dark(${light}, ${dark})`;
}

/** One family's twelve declarations as `[property, value]` pairs, each already mode-complete. @public */
export function scaleVars(family: ScaleFamily, scales: GeneratedTheme[ScaleFamily]): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let step = 0; step < 12; step++) {
    pairs.push([stepProperty(family, step), lightDark(scales.light.oklch[step] ?? "", scales.dark.oklch[step] ?? "")]);
  }
  return pairs;
}

// `solid` is kept beside `oklch` rather than derived from it: the ratios and the preview both work
// in the byte-quantised sRGB the hex names.
/** Both families, both modes — everything a scheme declares, from five numbers. @public */
export interface GeneratedTheme {
  readonly gray: Readonly<Record<Mode, { solid: Scale<string>; oklch: Scale<string> }>>;
  readonly accent: Readonly<Record<Mode, { solid: Scale<string>; oklch: Scale<string> }>>;
}

type ScaleStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

function buildFamily(ramp: Readonly<Record<Mode, Ramp>>, hue: number, chroma: number): GeneratedTheme[ScaleFamily] {
  const build = (mode: Mode) => {
    const solid = buildScale(ramp[mode], { hue, chroma });
    const css = (step: ScaleStep) => oklchCss(toSrgbGamut(ramp[mode].lightness[step], ramp[mode].chroma[step] * chroma, hue));
    const oklch: Scale<string> = [css(0), css(1), css(2), css(3), css(4), css(5), css(6), css(7), css(8), css(9), css(10), css(11)];
    return { solid, oklch };
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

// Derived rather than written out, so the emitted declaration is provably the same two steps the
// live measurement reads through `ACCENT_CONTRAST`.
/** The `var()` `--accent-contrast` resolves to in one mode. */
function contrastVar(mode: Mode): string {
  return `var(${stepProperty(ACCENT_CONTRAST.family, sideStep(ACCENT_CONTRAST, mode))})`;
}

/** The scheme as a `theme-*.css` file, ready to paste. @public */
export function schemeCss(theme: GeneratedTheme, dials: DialValues): string {
  const declare = ([name, value]: readonly [string, string]) => `  ${name}: ${value};`;

  return [
    "/* Generated by the forge theme customiser.",
    `   Gray   hue ${dials.grayHue ?? 0}deg, chroma ${(dials.grayChroma ?? 0) / 1000}`,
    `   Accent hue ${dials.accentHue ?? 0}deg, chroma ${(dials.accentChroma ?? 0) / 1000}`,
    "",
    "   A scheme file is exactly this: twelve steps per family, each declared once. Every semantic",
    "   token in theme-base.css resolves through them, so this is the whole of re-theming. A step that",
    "   differs by mode is written with light-dark(); theme-base.css sets the color-scheme that picks",
    "   the branch, so import that file and this one is complete. */",
    "",
    ":root {",
    ...scaleVars("gray", theme.gray).map(declare),
    "",
    ...scaleVars("accent", theme.accent).map(declare),
    "",
    `  --accent-contrast: ${lightDark(contrastVar("light"), contrastVar("dark"))};`,
    "}",
    "",
  ].join("\n");
}

/** The `data-` attribute marking a preview row, valued with the row's id. @public */
export const SCALE_ROW_ATTR = "data-scale-row";

/** The `data-` attribute marking a printed hex, valued with the 0-indexed step. @public */
export const HEX_ATTR = "data-hex";

// Every id is family-prefixed, gray included: a bare `light` beside `accent-light` would make the
// rows non-uniform and invite parsing the id to recover the family it already carries.
/** The four rows of the preview: each generated scale, drawn on the surface it belongs to. @public */
export const SCALE_ROWS: readonly { readonly id: string; readonly family: ScaleFamily; readonly mode: Mode; readonly label: string }[] = [
  { id: "accent-light", family: "accent", mode: "light", label: "Accent scale, light surface" },
  { id: "accent-dark", family: "accent", mode: "dark", label: "Accent scale, dark surface" },
  { id: "gray-light", family: "gray", mode: "light", label: "Gray scale, light surface" },
  { id: "gray-dark", family: "gray", mode: "dark", label: "Gray scale, dark surface" },
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
  for (const pair of scalePairs()) {
    const { floor } = CRITERION[pair.criterion];
    for (const mode of ["light", "dark"] as const) {
      const read = (side: typeof pair.foreground) => theme[side.family][mode].solid[sideStep(side, mode)] ?? "";
      const value = contrastRatio(read(pair.foreground), read(pair.background));
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
