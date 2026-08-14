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
