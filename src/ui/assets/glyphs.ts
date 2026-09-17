import type { ForgeUiIconName, GlyphSource } from "./types";
// Declared here rather than in `sprites.ts`: that module reaches `node:path`/`node:url` at module
// scope, and resolution precedes tree-shaking, so a consumer bundling only the names failed to build.
/** Every forge UI glyph, grouped by the directory its file sits in. @public */
export const FORGE_UI_SPRITE_FILES = {
  // `panel-open`/`panel-close` serves all four cases and mirrored under `rtl:`
  core: ["spinner", "chevron-down", "chevron-left", "chevron-right", "hamburger", "close", "panel-open", "panel-close", "upload"],
  theme: ["sun", "moon", "monitor"],
} as const;

/** All forge UI glyph names — the complete set the `controls/` and `chrome/` components need. @public */
export const FORGE_UI_ICON_NAMES: readonly ForgeUiIconName[] = Object.values(FORGE_UI_SPRITE_FILES).flat();

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

/** The in-flight or settled read per sprite, keyed by the URL and prefix that produced it. */
const spriteReads = new Map<string, Promise<GlyphSource>>();

// Memoized for the isolate's life, which a deploy resets; a failure is not kept, or one transient
// error would blank every glyph until the isolate is replaced.
/** Fetches the sprite from `url` and parses it into a `GlyphSource`, empty on any failure. */
export async function loadSpriteGlyphs(url: string, prefix = "icon-"): Promise<GlyphSource> {
  const key = `${prefix}\u0000${url}`;
  const cached = spriteReads.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return {};
      const text = await res.text();
      return parseSpriteGlyphs(text, prefix);
    } catch {
      return {};
    }
  })();

  spriteReads.set(key, pending);
  const glyphs = await pending;
  if (Object.keys(glyphs).length === 0) spriteReads.delete(key);
  return glyphs;
}
