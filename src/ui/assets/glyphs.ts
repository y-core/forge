/** One parsed sprite glyph: the symbol's viewBox and its inner markup. */
export interface GlyphEntry {
  viewBox: string;
  markup: string;
}

/** The parsed glyph map keyed by name (the part after the prefix). */
export type GlyphSource = Record<string, GlyphEntry>;

/** Parse the text content of a build-generated SVG sprite into a keyed glyph map.
 *
 *  The `prefix` (default `"icon-"`) must match the sprite's symbol id prefix so that
 *  callers look up by bare name (e.g. `"move"` for `id="icon-move"`).
 *
 *  Returns an empty record for empty or unparseable input — never throws. Only
 *  `<symbol>` elements whose `id` starts with `prefix` are included. */
export function parseSpriteGlyphs(svgText: string, prefix = "icon-"): GlyphSource {
  if (!svgText) return {};
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const symbolRe = new RegExp(
    `<symbol\\s+id="${escaped}([^"]+)"\\s+viewBox="([^"]+)">((?:[\\s\\S])*?)</symbol>`,
    "g",
  );
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

/** Fetch the sprite from `url` and parse it into a `GlyphSource`.
 *
 *  On any fetch or parse failure returns an empty source — callers degrade gracefully to
 *  the stylesheet default cursor. Never throws at boot. */
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
