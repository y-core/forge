import type { FORGE_UI_SPRITE_FILES } from "./glyphs";

/** Union of forge UI glyph names. @public */
export type ForgeUiIconName = (typeof FORGE_UI_SPRITE_FILES)[keyof typeof FORGE_UI_SPRITE_FILES][number];

/** One parsed sprite glyph: the symbol's viewBox and its inner markup. */
export interface GlyphEntry {
  viewBox: string;
  markup: string;
}

/** The parsed glyph map keyed by name (the part after the prefix). */
export type GlyphSource = Record<string, GlyphEntry>;
