import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ResolvedConfig } from "../types";
import { copyAssets } from "./copy";
import { buildCSS } from "./css";
import { buildFonts } from "./fonts";
import { hashFile } from "./hash";
import { buildIcons } from "./icons";
import { buildJS } from "./js";
import { buildSprites } from "./sprites";

export interface BuildOptions {
  minify?: boolean;
  manifestPath?: string;
}

export async function buildAll(config: ResolvedConfig, opts?: BuildOptions): Promise<void> {
  const { publicDir } = config.paths;
  mkdirSync(publicDir, { recursive: true });

  for (const css of config.css) {
    buildCSS(css, { outDir: publicDir, minify: opts?.minify });
  }

  for (const bundle of config.js.bundles) {
    await buildJS(bundle, { outDir: publicDir, minify: opts?.minify });
  }

  copyAssets(config.copy, publicDir);

  if (Object.keys(config.sprites).length > 0) {
    await buildSprites(config.sprites, publicDir);
  }

  if (config.fonts.downloads.length > 0) {
    await buildFonts(config.fonts, publicDir);
  }

  if (config.icons) {
    await buildIcons(config.icons);
  }

  await generateManifest(publicDir, opts?.manifestPath ?? ".assets-manifest.json");
}

export async function generateManifest(publicDir: string, manifestPath: string): Promise<void> {
  const manifest: Record<string, string> = {};
  walkDir(publicDir, publicDir, manifest);
  const content = JSON.stringify(manifest, null, 2);
  if (existsSync(manifestPath) && readFileSync(manifestPath, "utf-8") === content) return;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, content);
}

function walkDir(dir: string, baseDir: string, manifest: Record<string, string>): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, baseDir, manifest);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".")) continue;
        const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
        manifest[relPath] = hashFile(fullPath);
      }
    }
  } catch {
    return;
  }
}
