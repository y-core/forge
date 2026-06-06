import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SpriteGroup, Sprites } from "../types";
import { fetchURL } from "./download";
import { hashFile } from "./hash";

export interface SpriteGroupResult {
  spriteKey: string;
  meta: Record<string, string>;
}

export interface SpriteBuildResult {
  mapping: Record<string, string>;
  groups: Record<string, SpriteGroupResult>;
}

export async function buildSprites(sprites: Sprites, publicDir: string, opts?: { hash?: boolean }): Promise<SpriteBuildResult> {
  const mapping: Record<string, string> = {};
  const groups: Record<string, SpriteGroupResult> = {};
  for (const [key, group] of Object.entries(sprites)) {
    const result = await buildSpriteGroup(group, publicDir, opts?.hash ?? false);
    if (result) {
      Object.assign(mapping, result.mapping);
      groups[key] = { spriteKey: result.spriteKey, meta: result.meta };
    }
  }
  return { mapping, groups };
}

export function extractViewBoxes(spriteContent: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const symbolRegex = /<symbol([^>]*)>/g;
  let match = symbolRegex.exec(spriteContent);
  while (match !== null) {
    const attrs = match[1] ?? "";
    const idMatch = attrs.match(/id="([^"]+)"/);
    const viewBoxMatch = attrs.match(/viewBox="([^"]+)"/i);
    if (idMatch?.[1] && viewBoxMatch?.[1]) {
      meta[idMatch[1]] = viewBoxMatch[1];
    }
    match = symbolRegex.exec(spriteContent);
  }
  return meta;
}

async function buildSpriteGroup(
  group: SpriteGroup,
  publicDir: string,
  shouldHash: boolean,
): Promise<{ mapping: Record<string, string>; spriteKey: string; meta: Record<string, string> } | null> {
  const target = join(publicDir, group.target);
  const spriteDir = dirname(target);
  mkdirSync(spriteDir, { recursive: true });

  const symbols: string[] = [];

  for (const source of group.sources) {
    const isRemote = source.path.startsWith("http://") || source.path.startsWith("https://");

    for (const file of source.files) {
      let content: string;

      if (isRemote) {
        const cachePath = join(spriteDir, ".svg-cache", file);
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
    return null;
  }

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join("\n")}\n</svg>`;

  // Clean up old sprite files (hashed or not) before writing.
  try {
    for (const entry of readdirSync(spriteDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".svg") && !entry.name.startsWith(".")) {
        rmSync(join(spriteDir, entry.name));
      }
    }
  } catch {
    /* ignore */
  }

  writeFileSync(target, sprite);

  const viewBoxMeta = extractViewBoxes(sprite);

  if (!shouldHash) {
    return { mapping: { [group.target]: group.target }, spriteKey: group.target, meta: viewBoxMeta };
  }

  const hash = hashFile(target);
  const ext = ".svg";
  const stem = group.target.slice(0, group.target.lastIndexOf("."));
  const hashedRelative = `${stem}.${hash}${ext}`;

  renameSync(target, join(publicDir, hashedRelative));

  return { mapping: { [group.target]: hashedRelative }, spriteKey: group.target, meta: viewBoxMeta };
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
    if (match?.[1]) attrs[attr] = match[1];
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
  const rawViewBox = viewBoxMatch?.[1] ?? "0 0 24 24";

  // Normalize non-zero-origin viewBoxes to "0 0 w h" and compensate with a
  // translate on the inner content. This ensures <use> at (0,0) is always
  // within the symbol's viewport, regardless of the source SVG's coordinate origin.
  const [minX = 0, minY = 0, w = 24, h = 24] = rawViewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasOffset = minX !== 0 || minY !== 0;
  const viewBox = `0 0 ${w} ${h}`;

  const svgTagMatch = svgContent.match(/<svg([^>]*)>/i);
  const innerMatch = svgContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (innerMatch?.[1] === undefined) return null;

  const rootAttrs = svgTagMatch?.[1] ? extractRootAttrs(svgTagMatch[1]) : {};
  const sanitized = sanitizeSVG(innerMatch[1]).trim();
  const propagated = propagateRootAttrs(sanitized, rootAttrs);
  const inner = hasOffset ? `<g transform="translate(${-minX} ${-minY})">${propagated}</g>` : propagated;

  const id = `icon-${basename(filename, ".svg")}`;
  return `  <symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`;
}
