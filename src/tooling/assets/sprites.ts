import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { extractViewBoxes, svgToSymbol } from "../../ui/assets/build/svg-symbols";
import { fetchURL } from "./download";
import { hashFile } from "./hash";
import { safeJoin } from "./paths";
import type { SpriteGroup, Sprites } from "./types";

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
