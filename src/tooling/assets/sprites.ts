import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { extractViewBoxes, svgToSymbol } from "../../ui/assets/build/svg-symbols";
import { fetchURL } from "./download";
import { hashFile } from "./hash";
import { safeJoin } from "./paths";
import type { SpriteGroup, Sprites } from "./types";
import type { SpriteBuildResult, SpriteGroupResult } from "./types";

/** Where upstream SVG bytes are cached — deliberately outside `publicDir`, which a build deploys whole. @public */
export const SPRITE_CACHE_DIR = join("node_modules", ".cache", "forge-assets", "sprites");

/** Builds every sprite group into `publicDir`, content-hashing the emitted sheets when `opts.hash` is set. @public */
export async function buildSprites(sprites: Sprites, publicDir: string, opts?: { hash?: boolean; cacheDir?: string }): Promise<SpriteBuildResult> {
  const mapping: Record<string, string> = {};
  const groups: Record<string, SpriteGroupResult> = {};
  for (const [key, group] of Object.entries(sprites)) {
    const result = await buildSpriteGroup(group, publicDir, opts?.hash ?? false, opts?.cacheDir ?? SPRITE_CACHE_DIR);
    Object.assign(mapping, result.mapping);
    groups[key] = { spriteKey: result.spriteKey, meta: result.meta, prefix: result.prefix };
  }
  return { mapping, groups };
}

async function buildSpriteGroup(
  group: SpriteGroup,
  publicDir: string,
  shouldHash: boolean,
  cacheDir: string,
): Promise<{ mapping: Record<string, string>; spriteKey: string; meta: Record<string, string>; prefix: string }> {
  const target = safeJoin(publicDir, group.target);
  const spriteDir = dirname(target);
  mkdirSync(spriteDir, { recursive: true });

  const prefix = group.prefix ?? "icon-";
  const symbolMap = new Map<string, string>();

  for (const source of group.sources) {
    const isRemote = source.path.startsWith("http://") || source.path.startsWith("https://");

    for (const rawEntry of source.files) {
      const entry = typeof rawEntry === "string" ? { key: basename(rawEntry, ".svg"), file: rawEntry, sha256: undefined } : rawEntry;
      let content: string;

      if (isRemote) {
        if (entry.sha256 === undefined) {
          throw new Error(`[forge-assets] remote sprite source ${source.path}${entry.file} needs a sha256`);
        }
        // Named by digest, so two sources cannot collide on a filename and a changed pin is a new file.
        const cachePath = safeJoin(cacheDir, `${entry.sha256}.svg`);
        await fetchURL(`${source.path}${entry.file}`, cachePath, { sha256: entry.sha256 });
        content = readFileSync(cachePath, "utf-8");
      } else {
        const filePath = join(source.path, entry.file);
        // The generated icon-name union is derived from the config, so a skipped source is a name
        // that typechecks and renders a blank `<use>` in production.
        if (!existsSync(filePath)) {
          throw new Error(`[forge-assets] sprite source not found: ${filePath} (group ${group.target}, symbol ${entry.key})`);
        }
        content = readFileSync(filePath, "utf-8");
      }

      const result = svgToSymbol(content, entry.key, prefix);
      if (result) symbolMap.set(result.id, result.symbol);
    }
  }

  if (symbolMap.size === 0) {
    throw new Error(`[forge-assets] no symbols produced for ${group.target} — every source file parsed to nothing`);
  }

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${[...symbolMap.values()].join("\n")}\n</svg>`;

  const targetStem = basename(group.target, ".svg");
  try {
    for (const entry of readdirSync(spriteDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".svg") && (entry.name === `${targetStem}.svg` || entry.name.startsWith(`${targetStem}.`))) {
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
