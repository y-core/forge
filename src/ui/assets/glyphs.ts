// Declared here rather than in `sprites.ts`: that module reaches `node:path`/`node:url` at module
// scope, and resolution precedes tree-shaking, so a consumer bundling only the names failed to build.
/** Every forge UI glyph, grouped by the directory its file sits in. @public */
export const FORGE_UI_SPRITE_FILES = {
  // `panel-open`/`panel-close` serves all four cases and mirrored under `rtl:`
  core: ["spinner", "chevron-down", "chevron-left", "chevron-right", "hamburger", "close", "panel-open", "panel-close", "upload"],
  theme: ["sun", "moon", "monitor"],
} as const;

/** Union of forge UI glyph names. @public */
export type ForgeUiIconName = (typeof FORGE_UI_SPRITE_FILES)[keyof typeof FORGE_UI_SPRITE_FILES][number];

/** All forge UI glyph names — the complete set the `controls/` and `chrome/` components need. @public */
export const FORGE_UI_ICON_NAMES: readonly ForgeUiIconName[] = Object.values(FORGE_UI_SPRITE_FILES).flat();

/** One parsed sprite glyph: the symbol's viewBox and its inner markup. */
export interface GlyphEntry {
  viewBox: string;
  markup: string;
}

/** The parsed glyph map keyed by name (the part after the prefix). */
export type GlyphSource = Record<string, GlyphEntry>;

/** Parses a build-generated SVG sprite into a glyph map keyed by name without `prefix`. */
export function parseSpriteGlyphs(svgText: string, prefix = "icon-"): GlyphSource {
  if (!svgText) return {};
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const symbolRe = new RegExp(`<symbol\\s+id="${escaped}([^"]+)"\\s+viewBox="([^"]+)">((?:[\\s\\S])*?)</symbol>`, "g");
  const result: GlyphSource = {};
  for (;;) {
    const match = symbolRe.exec(svgText);
    if (match === null) break;
    const [, name, viewBox, markup] = match;
    if (name && viewBox && markup !== undefined) {
      result[name] = { viewBox, markup };
    }
  }
  return result;
}

/** Fetches the sprite from `url` and parses it into a `GlyphSource`, empty on any failure. */
export async function loadSpriteGlyphs(url: string, prefix = "icon-"): Promise<GlyphSource> {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const text = await res.text();
    return parseSpriteGlyphs(text, prefix);
  } catch {
    return {};
  }
}
