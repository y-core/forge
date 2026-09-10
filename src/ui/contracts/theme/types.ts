/** The two blocks a scheme file declares. Matches `Mode` in `src/tooling/gate/checks/contrast-parse.ts`. @public */
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

/** The two scales a generated scheme declares. @public */
export type ScaleFamily = "gray" | "accent";

/** One contrast pair exempted from the audit, with what it measures and why no criterion binds. @public */
export interface AcceptedContrastRow {
  /** The custom property the exemption is about. */
  token: string;
  /** The role step it resolves through. */
  step: string;
  /** The value the step is pinned at, per mode. */
  value: Readonly<Record<Mode, string>>;
  /** Worst-case measured ratios. */
  measured: string;
  /** Why no criterion binds. Mandatory and non-empty. */
  reason: string;
}

/** The WCAG success criterion a pair is bound by. Only these two appear in forge's audit. @public */
export type Criterion = "1.4.3" | "1.4.11";

/** A step on a generated scale: one index, or one per mode where the token re-points. @public */
export type SideStep = number | Readonly<Record<Mode, number>>;

export type ContrastSide =
  | { readonly kind: "scale"; readonly token: string; readonly family: ScaleFamily; readonly step: SideStep }
  | { readonly kind: "fixed"; readonly token: string };

/** A side both the audit and the live measurement resolve on a generated scale. @public */
export type ScaleSide = Extract<ContrastSide, { kind: "scale" }>;

export interface ContrastPair {
  readonly token: string;
  readonly role: string;
  readonly step: string;
  readonly foreground: ContrastSide;
  readonly background: ContrastSide;
  readonly against: Readonly<Record<"light" | "dark", string>>;
  readonly criterion: Criterion;
}

/** A pair whose two sides are both steps on a generated scale. @public */
export type ScalePair = ContrastPair & { foreground: ScaleSide; background: ScaleSide };

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

/** Every dial's value, keyed by field. The loader produces one; the scope rehydrates one. @public */
export type DialValues = Record<string, number>;

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

// `solid` is kept beside `oklch` rather than derived from it: the ratios and the preview both work
// in the byte-quantised sRGB the hex names.
/** Both families, both modes — everything a scheme declares, from five numbers. @public */
export interface GeneratedTheme {
  readonly gray: Readonly<Record<Mode, { solid: Scale<string>; oklch: Scale<string> }>>;
  readonly accent: Readonly<Record<Mode, { solid: Scale<string>; oklch: Scale<string> }>>;
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
