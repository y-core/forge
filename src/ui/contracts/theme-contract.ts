/**
 * The theme customiser's shared vocabulary: its scope name, its dials, and the custom-property
 * names a generated scale is written under.
 *
 * Four consumers read this and they run in different places — the SSR page renders the sliders, the
 * loader parses the query string, the browser scope writes the properties, and the copyable output
 * emits a scheme file. A dial defined in any one of them alone would drift from the other three at
 * the first edit, and the failure would be silent: a slider that moves a signal nothing reads, or a
 * property written under a name no stylesheet declares.
 *
 * Same reasoning as `overlay-contract.ts` and `tabs-contract.ts` — a name shared across the SSR/
 * client boundary is a contract, and contracts live here.
 */

import { ACCENT_RAMP, buildAlphaScale, buildScale, contrastRatio, GRAY_RAMP, type Mode, type Ramp, type Scale } from "./color";
import { CONTRAST_PAIRS, CRITERION } from "./contrast-pairs";

/** Resumable-scope name the customiser's lever panel stamps. **Eager** — see the note below. @public */
export const CUSTOMISE_SCOPE = "customise";

/**
 * The two scales a generated scheme declares.
 *
 * `gray` is the neutral every semantic token resolves through; `accent` is the brand scale
 * `--primary` points at. They are separate families rather than one scale with two hues because
 * they sit on different lightness ramps — see `ACCENT_RAMP`. @public
 */
export type ScaleFamily = "gray" | "accent";

/** One lever: what it writes, what it is called, and where it may travel. @public */
export interface Dial {
  /** The `SignalRecord` field, the `data-field` the slider stamps, and the state key. */
  readonly field: string;
  /** The query-string parameter. Short, because these end up in a shared URL. */
  readonly param: string;
  /**
   * The control's **accessible** name, and what a screen reader announces — "Accent hue".
   *
   * Drawn as {@link short} beside the control with {@link group} carried in a visually-hidden span
   * inside the same label, because the family is printed once for the whole row. `label` must
   * therefore contain `short` verbatim, or the accessible name would not contain the visible one.
   */
  readonly label: string;
  /**
   * The family this dial belongs to, printed once per row — or `null` for a dial that stands alone.
   *
   * This is what pairs hue with chroma on one line. It lives here rather than in the page because
   * the pairing is a fact about the dials: they are one family's two free parameters, and lightness
   * is not among them.
   */
  readonly group: string | null;
  /** The part of {@link label} drawn beside the control, once the family has been printed. */
  readonly short: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value the shipped default scheme sits at, and what an absent parameter means. */
  readonly fallback: number;
  /** The unit the number is in, for the readout — degrees, thousandths of chroma, or pixels. */
  readonly unit: string;
}

/**
 * The five levers, in the order they are rendered.
 *
 * **Chroma is carried in thousandths** rather than as an OKLCh float, and that is a deliberate
 * choice about the control rather than a serialisation detail. A range input's value is a string
 * either way, but an integer dial makes the shipped tint ladder legible as a ladder — neutral 0,
 * stone 12, gray 20, slate 45 — where 0.045 reads as an arbitrary decimal. `CHROMA_MAX` in
 * `color.ts` holds the ceilings in OKLCh units; divide by 1000 to cross between them.
 *
 * `fallback` is the shipped default, so a bare `/showcase/ui/theme` renders exactly the scheme
 * `theme-neutral.css` declares: gray chroma 0 makes the hue irrelevant and the scale achromatic.
 * The accent has no shipped counterpart yet, so it falls back to Radix indigo — the scale
 * `ACCENT_RAMP` was measured from. @public
 */
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

/**
 * `DIALS` grouped into the rows the customiser draws.
 *
 * Consecutive dials sharing a `group` ride one row; a `null` group takes a row of its own. Derived
 * rather than hand-listed so a sixth dial joins a row by declaring its family, and so the page never
 * re-derives layout from string equality on labels. @public
 */
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

/** The `--radius` token, which the customiser drives directly rather than through a scale. @public */
export const RADIUS_PROPERTY = "--radius";

/**
 * The custom property one step is declared under — `--gray-11`, `--accent-a3`.
 *
 * `step` is **0-indexed**, matching {@link Scale} and `ContrastSide.step`, and the `+ 1` happens
 * exactly here. Every other call site indexes an array; only this one names a CSS property, so this
 * is the single place the two numbering systems meet. @public
 */
export function stepProperty(family: ScaleFamily, step: number, kind: "solid" | "alpha" = "solid"): string {
  return `--${family}-${kind === "alpha" ? "a" : ""}${step + 1}`;
}

/**
 * One family's twenty-four declarations as `[property, value]` pairs.
 *
 * The single source for both writers: the browser scope passes these to `setProperty`, and the
 * copyable scheme block prints them as CSS. That is the whole reason this function exists rather
 * than each side formatting its own names — a scheme file whose property names disagreed with the
 * ones the preview wrote would look correct on the page and do nothing when pasted. @public
 */
export function scaleVars(family: ScaleFamily, solid: Scale<string>, alpha: Scale<string>): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let step = 0; step < 12; step++) pairs.push([stepProperty(family, step), solid[step] ?? ""]);
  for (let step = 0; step < 12; step++) pairs.push([stepProperty(family, step, "alpha"), alpha[step] ?? ""]);
  return pairs;
}

// ── Generation ───────────────────────────────────────────────────────────────────────────────────

/** Both families, both modes — everything a scheme declares, from five numbers. @public */
export interface GeneratedTheme {
  readonly gray: Readonly<Record<Mode, { solid: Scale<string>; alpha: Scale<string> }>>;
  readonly accent: Readonly<Record<Mode, { solid: Scale<string>; alpha: Scale<string> }>>;
}

function buildFamily(ramp: Readonly<Record<Mode, Ramp>>, hue: number, chroma: number): GeneratedTheme["gray"] {
  const build = (mode: Mode) => {
    const solid = buildScale(ramp[mode], { hue, chroma });
    return { solid, alpha: buildAlphaScale(solid, mode) };
  };
  return { light: build("light"), dark: build("dark") };
}

/**
 * The whole scheme, from the five dials.
 *
 * Lives here rather than beside the page because **both sides run it**: the Worker calls it to
 * render hex text and the WCAG table, and the browser scope calls it inside an effect to paint. One
 * function, so a readout can never describe a colour different from the one on screen — which is
 * the failure a customiser is most likely to ship and least likely to notice.
 *
 * Chroma arrives in thousandths from {@link DIALS} and is converted here, at the single boundary
 * between the dial's units and OKLCh's. @public
 */
export function buildTheme(dials: DialValues): GeneratedTheme {
  return {
    gray: buildFamily(GRAY_RAMP, dials.grayHue ?? 0, (dials.grayChroma ?? 0) / 1000),
    accent: buildFamily(ACCENT_RAMP, dials.accentHue ?? 0, (dials.accentChroma ?? 0) / 1000),
  };
}

/**
 * The scheme as a `theme-*.css` file, ready to paste.
 *
 * The output *is* the artifact, and that is a fact about forge's colour layer rather than a
 * convenience: a scheme file is exactly twelve steps plus twelve alpha steps in a `:root`/`.dark`
 * pair — see the header of `theme-neutral.css` — so there is nothing else for this to emit. Names
 * come from {@link scaleVars}, the same function the browser writes through, so a pasted file
 * declares precisely what the preview painted. @public
 */
export function schemeCss(theme: GeneratedTheme, dials: DialValues): string {
  const block = (mode: Mode, selector: string) =>
    [
      `${selector} {`,
      ...scaleVars("gray", theme.gray[mode].solid, theme.gray[mode].alpha).map(([name, value]) => `  ${name}: ${value};`),
      "",
      ...scaleVars("accent", theme.accent[mode].solid, theme.accent[mode].alpha).map(([name, value]) => `  ${name}: ${value};`),
      "}",
    ].join("\n");

  return [
    "/* Generated by the forge theme customiser.",
    `   Gray   hue ${dials.grayHue ?? 0}deg, chroma ${(dials.grayChroma ?? 0) / 1000}`,
    `   Accent hue ${dials.accentHue ?? 0}deg, chroma ${(dials.accentChroma ?? 0) / 1000}`,
    "",
    "   A scheme file is exactly this: twelve steps and twelve alpha steps, per mode. Every semantic",
    "   token in theme-base.css resolves through them, so this is the whole of re-theming. Import it",
    "   after theme-neutral.css - both selectors weigh 0-1-0, so source order decides. */",
    "",
    block("light", ":root"),
    "",
    block("dark", ".dark"),
    "",
  ].join("\n");
}

/** The `data-` attribute marking a preview row, valued with the row's id. @public */
export const SCALE_ROW_ATTR = "data-scale-row";

/**
 * The `data-` attribute marking a printed hex, valued with the same 0-indexed step `data-swatch`
 * carries.
 *
 * A second handle on the same column because the two are written differently: the browser paints
 * `background-color` on the swatch and writes *text* here. One attribute for both would make "which
 * of the two did I mean" a question answered at run time. It exists at all because a hex the effect
 * never rewrote sat under a swatch it no longer described. @public
 */
export const HEX_ATTR = "data-hex";

/**
 * The two rows of the preview: each generated scale, drawn on the surface it belongs to.
 *
 * **Two rather than four, and the reason is a correctness one.** An earlier version drew all four
 * scale/surface combinations, on the theory that the crossed pairs were where a bad dial setting
 * became visible. They are not, because forge's `.dark` class swaps the **scale and the surface
 * together** — a light step never lands on a dark page. The crossed quadrants depicted a state the
 * cascade cannot produce, and invited a judgement about a combination nobody will ever see.
 *
 * Dropping them also dissolves a duplication: there are only two generated scales, so four rows
 * printed half their hex values twice, inviting a reader to look for a difference the generator
 * cannot make.
 *
 * `label` is **not drawn**. Each row is a bordered box painting its own mode's `--background`, so
 * which scale it holds is visible rather than captioned — a label reading "light scale, light
 * surface" over a visibly light box is a sentence the reader has to go and verify. The text is kept
 * because it is still the only thing a screen reader can be given, and it goes into the table's
 * visually-hidden `<caption>`. @public
 */
export const SCALE_ROWS: readonly { readonly id: string; readonly mode: Mode; readonly label: string }[] = [
  { id: "light", mode: "light", label: "Light scale, light surface" },
  { id: "dark", mode: "dark", label: "Dark scale, dark surface" },
];

// ── Live WCAG readouts ───────────────────────────────────────────────────────────────────────────

/**
 * The `data-ratio` value one cell carries.
 *
 * One function, so the attribute the Worker writes and the selector the browser looks up cannot
 * drift apart into a readout that is never found and therefore never wrong. @public
 */
export function ratioKey(token: string, mode: Mode): string {
  return `${token}:${mode}`;
}

/** One computed cell: its handle, its number, and the exact text both writers print. @public */
export interface LiveRatio {
  readonly key: string;
  readonly token: string;
  readonly mode: Mode;
  readonly value: number;
  readonly floor: number;
  /**
   * `"5.19:1 ✓"` — formatted **here** rather than at each call site, so the Worker's first paint and
   * the browser's rewrite are the same string by construction. {@link scaleVars} is the precedent,
   * and the reason is the same: the last time this page formatted a value in two places, one of them
   * stopped being updated and nothing noticed.
   */
  readonly text: string;
}

/**
 * Every audited pair a generated scheme can actually be measured on, in both modes.
 *
 * Four pairs × two modes. The other eleven have a side on a fixed Tailwind stop this repository
 * cannot resolve, and are **absent** rather than present-and-null: a caller wanting the full list
 * reads `CONTRAST_PAIRS`, and a caller wanting the computable ones should not have to filter nulls
 * out of it. @public
 */
export function liveRatios(theme: GeneratedTheme): readonly LiveRatio[] {
  const out: LiveRatio[] = [];
  for (const pair of CONTRAST_PAIRS) {
    if (pair.foreground.kind !== "scale" || pair.background.kind !== "scale") continue;
    const { floor } = CRITERION[pair.criterion];
    for (const mode of ["light", "dark"] as const) {
      const scale = theme.gray[mode].solid;
      const value = contrastRatio(scale[pair.foreground.step] ?? "", scale[pair.background.step] ?? "");
      out.push({
        key: ratioKey(pair.token, mode),
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
