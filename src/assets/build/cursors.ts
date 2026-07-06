import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CursorsConfig } from "../types";
import { parseColor, toHex } from "./color";
import { readThemeTokens, resolveToken } from "./css-tokens";
import { extractRootAttrs, propagateRootAttrs, sanitizeSVG } from "./sprites";

/**
 * Per-cursor metadata extracted from a cursor SVG root. `viewBox` and `markup` (the
 * sanitized inner geometry) are always present; each `data-cursor-*` attribute is stored
 * under its suffix (e.g. `data-cursor-token` → `token`).
 */
interface CursorMeta {
  viewBox: string;
  markup: string;
  [key: string]: string;
}

function parseCursorSvg(content: string): CursorMeta | null {
  const svgTagMatch = content.match(/<svg([^>]*)>/i);
  const innerMatch = content.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!svgTagMatch?.[1] || innerMatch?.[1] === undefined) return null;

  const rootTag = svgTagMatch[1];
  const viewBoxMatch = rootTag.match(/viewBox="([^"]+)"/i);
  const viewBox = viewBoxMatch?.[1] ?? "0 0 24 24";

  const meta: CursorMeta = { viewBox, markup: "" };
  const dataRegex = /data-cursor-([a-zA-Z0-9-]+)="([^"]*)"/g;
  let dataMatch = dataRegex.exec(rootTag);
  while (dataMatch !== null) {
    if (dataMatch[1]) meta[dataMatch[1]] = dataMatch[2] ?? "";
    dataMatch = dataRegex.exec(rootTag);
  }

  const rootAttrs = extractRootAttrs(rootTag);
  const sanitized = sanitizeSVG(innerMatch[1]).trim();
  meta.markup = propagateRootAttrs(sanitized, rootAttrs);
  return meta;
}

function substitute(template: string, replacements: Record<string, string>, meta: CursorMeta): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (whole, key: string) => {
    if (key in replacements) return replacements[key] ?? "";
    if (key in meta) return meta[key] ?? "";
    return whole;
  });
}

/**
 * Build all cursor bakes: for each cursor × theme, substitute the template SVG with the
 * cursor's geometry and theme-resolved colours, then emit a CSS `cursor` value with hotspot.
 * Returns `{ [cursorName]: { [themeKey]: 'url("data:image/svg+xml,...") hx hy, auto' } }`. @public
 */
export function buildCursors(config: CursorsConfig, cssText: string): Record<string, Record<string, string>> {
  const templateContent = readFileSync(join(config.template.path, config.template.file), "utf-8");
  const themeTokens = readThemeTokens(cssText, config.themes);
  const haloToken = config.haloToken ?? "--background";

  const result: Record<string, Record<string, string>> = {};

  for (const source of config.sources) {
    for (const rawEntry of source.files) {
      const entry = typeof rawEntry === "string" ? { key: rawEntry.replace(/\.svg$/, ""), file: rawEntry } : rawEntry;
      const cursorContent = readFileSync(join(source.path, entry.file), "utf-8");
      const meta = parseCursorSvg(cursorContent);
      if (!meta) continue;

      const perTheme: Record<string, string> = {};

      for (const [theme, tokens] of Object.entries(themeTokens)) {
        const haloRaw = resolveToken(haloToken, tokens);
        const haloRgb = haloRaw ? parseColor(haloRaw) : null;
        const halo = haloRgb ? toHex(haloRgb) : "#000000";

        const signalToken = meta.token;
        let signal = "#000000";
        if (signalToken !== undefined) {
          const signalRaw = resolveToken(signalToken, tokens);
          if (signalRaw === null) {
            throw new Error(`[forge-assets] cursor "${entry.key}" references missing CSS token "${signalToken}" for theme "${theme}"`);
          }
          const signalRgb = parseColor(signalRaw);
          signal = signalRgb ? toHex(signalRgb) : "#000000";
        }

        const svg = substitute(templateContent, { viewBox: meta.viewBox, markup: meta.markup, halo, signal }, meta);
        const encoded = encodeURIComponent(svg);

        const hotspot = meta.hotspot ?? "0 0";
        const [hx = "0", hy = "0"] = hotspot.trim().split(/\s+/);
        perTheme[theme] = `url("data:image/svg+xml,${encoded}") ${hx} ${hy}, auto`;
      }

      result[entry.key] = perTheme;
    }
  }

  return result;
}
