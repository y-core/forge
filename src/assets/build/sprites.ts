import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SpriteGroup, Sprites } from "../types";
import { fetchURL } from "./download";

export async function buildSprites(sprites: Sprites, publicDir: string): Promise<void> {
  for (const group of Object.values(sprites)) {
    await buildSpriteGroup(group, publicDir);
  }
}

async function buildSpriteGroup(group: SpriteGroup, publicDir: string): Promise<void> {
  const target = join(publicDir, group.target);
  mkdirSync(dirname(target), { recursive: true });

  const symbols: string[] = [];

  for (const source of group.sources) {
    const isRemote = source.path.startsWith("http://") || source.path.startsWith("https://");

    for (const file of source.files) {
      let content: string;

      if (isRemote) {
        const cachePath = join(dirname(target), ".svg-cache", file);
        await fetchURL(`${source.path}${file}`, cachePath);
        content = readFileSync(cachePath, "utf-8");
      } else {
        const filePath = join(source.path, file);
        if (!existsSync(filePath)) {
          console.warn(`[forge-assets] SVG not found, skipping: ${filePath}`);
          continue;
        }
        content = readFileSync(filePath, "utf-8");
      }

      const symbol = svgToSymbol(content, file);
      if (symbol) symbols.push(symbol);
    }
  }

  if (symbols.length === 0) {
    console.warn(`[forge-assets] No symbols produced for ${group.target}, skipping write`);
    return;
  }

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join("\n")}\n</svg>`;
  writeFileSync(target, sprite);
}

export function sanitizeSVG(content: string): string {
  // Strip script tags (covers both inline and src-based scripts)
  let result = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  // Strip event handler attributes (onclick, onload, onerror, etc.)
  result = result.replace(/\s+on[a-zA-Z]+="[^"]*"/g, "");
  result = result.replace(/\s+on[a-zA-Z]+='[^']*'/g, "");
  return result;
}

const PROPAGATABLE_ATTRS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"] as const;
const SHAPE_ELEMENTS = ["path", "rect", "circle", "line", "ellipse", "polygon", "polyline"];

function extractRootAttrs(svgTag: string): Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>> {
  const attrs: Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>> = {};
  for (const attr of PROPAGATABLE_ATTRS) {
    const match = svgTag.match(new RegExp(`${attr}="([^"]+)"`, "i"));
    if (match) attrs[attr] = match[1];
  }
  return attrs;
}

function propagateRootAttrs(inner: string, rootAttrs: Partial<Record<string, string>>): string {
  const entries = Object.entries(rootAttrs);
  if (entries.length === 0) return inner;

  const shapePattern = new RegExp(`<(${SHAPE_ELEMENTS.join("|")})([^>]*)>`, "gi");

  return inner.replace(shapePattern, (_, tag: string, rest: string) => {
    const selfClose = rest.endsWith("/");
    const existingAttrs = selfClose ? rest.slice(0, -1) : rest;

    let injected = existingAttrs;
    for (const [attr, value] of entries) {
      if (!new RegExp(`\\b${attr}\\s*=`, "i").test(existingAttrs)) {
        injected += ` ${attr}="${value}"`;
      }
    }

    return selfClose ? `<${tag}${injected}/>` : `<${tag}${injected}>`;
  });
}

export function svgToSymbol(svgContent: string, filename: string): string | null {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/i);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 24 24";

  const svgTagMatch = svgContent.match(/<svg([^>]*)>/i);
  const innerMatch = svgContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!innerMatch) return null;

  const rootAttrs = svgTagMatch ? extractRootAttrs(svgTagMatch[1]) : {};
  const sanitized = sanitizeSVG(innerMatch[1]).trim();
  const inner = propagateRootAttrs(sanitized, rootAttrs);

  const id = `icon-${basename(filename, ".svg")}`;
  return `  <symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`;
}
