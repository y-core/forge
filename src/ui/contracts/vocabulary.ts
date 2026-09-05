/** Every colour intent a forge surface can carry; `neutral` is the un-toned default. @public */
export const TONES = ["neutral", "primary", "secondary", "destructive", "info", "success", "warning"] as const;

/** One of {@link TONES}. @public */
export type Tone = (typeof TONES)[number];

/** How a tone is painted — the five emphasis levels every toned surface chooses from. @public */
export const APPEARANCES = ["solid", "soft", "outline", "ghost", "link"] as const;

/** One of {@link APPEARANCES}. @public */
export type Appearance = (typeof APPEARANCES)[number];

/** The three control heights, read from `--control-h-*`. @public */
export type Size = "sm" | "md" | "lg";

/** A button's footprint beyond its size: text, an icon-only square, a full-width square, or a circle. @public */
export type Shape = "default" | "icon" | "square" | "circle";

/** Every presentational attribute forge emits — the enum half of the vocabulary, beside the boolean
 *  state hooks in `state-attrs.ts`. @public */
export const PRESENTATION_ATTRS = {
  /** The colour intent the surface carries — one of {@link TONES}. */
  tone: "data-tone",
  /** How that tone is painted — one of {@link APPEARANCES}. */
  appearance: "data-appearance",
  /** The control height, one of {@link Size}. */
  size: "data-size",
  /** A component-local enum a stylesheet reads. Never a serialized payload — that is `data-island-state`. */
  state: "data-state",
} as const;

/** One of the declared presentational-attribute names. @public */
export type PresentationAttrName = (typeof PRESENTATION_ATTRS)[keyof typeof PRESENTATION_ATTRS];

/** The presentational axes a forge component can declare; an omitted key emits nothing. @public */
export interface PresentationAttrsProps {
  tone?: Tone | undefined;
  appearance?: Appearance | undefined;
  size?: Size | undefined;
  state?: string | undefined;
}

/** Builds the presentational attributes for an SSR element, to be spread onto it. @public */
export function presentationAttrs(presentation: PresentationAttrsProps): Record<string, string> {
  // Literal keys, never `PRESENTATION_ATTRS.tone`: a runtime reference would retain the whole table
  // in every bundle that spreads one of these — the technique `state-attrs.ts` documents.
  return {
    ...(presentation.tone === undefined ? {} : { "data-tone": presentation.tone }),
    ...(presentation.appearance === undefined ? {} : { "data-appearance": presentation.appearance }),
    ...(presentation.size === undefined ? {} : { "data-size": presentation.size }),
    ...(presentation.state === undefined ? {} : { "data-state": presentation.state }),
  };
}
