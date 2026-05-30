import { resolve } from "node:path";
import * as v from "valibot";
import type { AssetsConfig, ResolvedConfig } from "./types";
import { AssetsConfigSchema } from "./types";

export function defineAssetsConfig(config: AssetsConfig): AssetsConfig {
  return config;
}

export async function loadConfig(configPath?: string): Promise<ResolvedConfig> {
  const resolvedPath = resolve(configPath ?? "assets.config.ts");
  // Dynamic import handles both .ts (Bun) and pre-compiled .js
  // biome-ignore lint/suspicious/noExplicitAny: dynamic module has unknown shape
  const mod = (await import(resolvedPath)) as any;
  const raw: unknown = mod.default ?? mod;
  const parsed = v.parse(AssetsConfigSchema, raw);
  return {
    paths: {
      sourceDir: parsed.paths?.sourceDir ?? "src/static",
      publicDir: parsed.paths?.publicDir ?? "public/assets",
      publicPrefix: parsed.paths?.publicPrefix ?? "/assets",
    },
    js: {
      bundles: parsed.js?.bundles ?? [],
    },
    css: parsed.css ?? [],
    copy: parsed.copy ?? [],
    sprites: parsed.sprites ?? {},
    fonts: {
      downloads: parsed.fonts?.downloads ?? [],
    },
    icons: parsed.icons ?? null,
  };
}
