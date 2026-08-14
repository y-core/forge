import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SpriteGroup, Sprites } from "../types";
import { fetchURL } from "./download";
import { hashFile } from "./hash";
import { safeJoin } from "./paths";

/** One built sprite sheet: its manifest key, its symbol-id-to-viewBox map, and its symbol id prefix. @public */
export interface SpriteGroupResult {
  spriteKey: string;
  meta: Record<string, string>;
  prefix: string;
}

/** A sprite build's logical-to-emitted path mappings, plus one result per sprite group. @public */
export interface SpriteBuildResult {
  mapping: Record<string, string>;
  groups: Record<string, SpriteGroupResult>;
}

/** Builds every sprite group into `publicDir`, content-hashing the emitted sheets when `opts.hash` is set. @public */
export async function buildSprites(sprites: Sprites, publicDir: string, opts?: { hash?: boolean }): Promise<SpriteBuildResult> {
  const mapping: Record<string, string> = {};
  const groups: Record<string, SpriteGroupResult> = {};
  for (const [key, group] of Object.entries(sprites)) {
    const result = await buildSpriteGroup(group, publicDir, opts?.hash ?? false);
    if (result) {
      Object.assign(mapping, result.mapping);
      groups[key] = { spriteKey: result.spriteKey, meta: result.meta, prefix: result.prefix };
    }
  }
  return { mapping, groups };
}

/** Maps each `<symbol>` id in sprite markup to its viewBox. @public */
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
): Promise<{ mapping: Record<string, string>; spriteKey: string; meta: Record<string, string>; prefix: string } | null> {
  const target = safeJoin(publicDir, group.target);
  const spriteDir = dirname(target);
  mkdirSync(spriteDir, { recursive: true });

  const prefix = group.prefix ?? "icon-";
  const symbolMap = new Map<string, string>();

  for (const source of group.sources) {
    const isRemote = source.path.startsWith("http://") || source.path.startsWith("https://");

    for (const rawEntry of source.files) {
      const entry = typeof rawEntry === "string" ? { key: basename(rawEntry, ".svg"), file: rawEntry } : rawEntry;
      let content: string;

      if (isRemote) {
        const cachePath = safeJoin(spriteDir, ".svg-cache", entry.file);
        await fetchURL(`${source.path}${entry.file}`, cachePath);
        content = readFileSync(cachePath, "utf-8");
      } else {
        const filePath = join(source.path, entry.file);
        if (!existsSync(filePath)) {
          console.warn(`[forge-assets] SVG not found, skipping: ${filePath}`);
          continue;
        }
        content = readFileSync(filePath, "utf-8");
      }

      const result = svgToSymbol(content, entry.key, prefix);
      if (result) symbolMap.set(result.id, result.symbol);
    }
  }

  if (symbolMap.size === 0) {
    console.warn(`[forge-assets] No symbols produced for ${group.target}, skipping write`);
    return null;
  }

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${[...symbolMap.values()].join("\n")}\n</svg>`;

  const targetStem = basename(group.target, ".svg");
  try {
    for (const entry of readdirSync(spriteDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".svg") &&
        !entry.name.startsWith(".") &&
        (entry.name === `${targetStem}.svg` || entry.name.startsWith(`${targetStem}.`))
      ) {
        rmSync(join(spriteDir, entry.name));
      }
    }
  } catch {
    /* ignore */
  }

  writeFileSync(target, sprite);

  const viewBoxMeta = extractViewBoxes(sprite);

  if (!shouldHash) {
    return { mapping: { [group.target]: group.target }, spriteKey: group.target, meta: viewBoxMeta, prefix };
  }

  const hash = hashFile(target);
  const ext = ".svg";
  const stem = group.target.slice(0, group.target.lastIndexOf("."));
  const hashedRelative = `${stem}.${hash}${ext}`;

  renameSync(target, safeJoin(publicDir, hashedRelative));

  return { mapping: { [group.target]: hashedRelative }, spriteKey: group.target, meta: viewBoxMeta, prefix };
}

/** Best-effort SVG sanitizer for inline sprite content from trusted sources. */
export function sanitizeSVG(content: string): string {
  let result = content;
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  result = result.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  result = result.replace(/<(?:animate|set)\b[^>]*\battributeName\s*=\s*["'](?:xlink:)?href["'][^>]*(?:\/>|>[\s\S]*?<\/(?:animate|set)>)/gi, "");
  result = result.replace(/\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, (match, val: string) => {
    const normalized = val
      .replace(/^["']|["']$/g, "")
      .toLowerCase()
      .replace(/\s/g, "");
    if (normalized.startsWith("javascript:") || normalized.startsWith("data:text/html")) return "";
    return match;
  });
  result = result.replace(/\s+on[a-zA-Z]+=(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, "");
  return result;
}

const PROPAGATABLE_ATTRS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"] as const;
const SHAPE_ELEMENTS = ["path", "rect", "circle", "line", "ellipse", "polygon", "polyline"];

/** Reads the presentation attributes on a root `<svg>` tag that propagate to its shapes. @internal */
export function extractRootAttrs(svgTag: string): Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>> {
  const attrs: Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>> = {};
  for (const attr of PROPAGATABLE_ATTRS) {
    const match = svgTag.match(new RegExp(`${attr}="([^"]+)"`, "i"));
    if (match?.[1]) attrs[attr] = match[1];
  }
  return attrs;
}

/** Copies root presentation attributes onto the shape elements that do not already set them. @internal */
export function propagateRootAttrs(inner: string, rootAttrs: Partial<Record<string, string>>): string {
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

/** Converts an SVG document into a sanitized `<symbol>` with a zero-origin viewBox, or null when it has no content. @public */
export function svgToSymbol(svgContent: string, key: string, prefix: string): { id: string; symbol: string } | null {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/i);
  const rawViewBox = viewBoxMatch?.[1] ?? "0 0 24 24";

  // `<use>` renders at (0,0), so a non-zero viewBox origin must be zeroed and translated back.
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

  const id = `${prefix}${key}`;
  return { id, symbol: `  <symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>` };
}
