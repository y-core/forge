import { resolve } from "node:path";
import { env as processEnv } from "node:process";
import { v } from "../validation/mod";
import type { AssetsConfig, DefineValue, EnvRef, FlagRef, ResolvedConfig, ResolvedJsBundle } from "./types";
import { AssetsConfigSchema } from "./types";

export function defineAssetsConfig(config: AssetsConfig): AssetsConfig {
  return config;
}

export function env(name: string): EnvRef {
  return { __env: name };
}

export function flag(name: string): FlagRef {
  return { __flag: name };
}

export function resolveDefine(value: DefineValue, source: Record<string, string | undefined>): string {
  if (value !== null && typeof value === "object") {
    if ("__flag" in value) return JSON.stringify(source[value.__flag] === "true" || source[value.__flag] === "1");
    if ("__env" in value) {
      const raw = source[value.__env];
      return raw === undefined ? "undefined" : JSON.stringify(raw);
    }
  }
  return JSON.stringify(value);
}

export async function loadConfig(configPath?: string): Promise<ResolvedConfig> {
  const resolvedPath = resolve(configPath ?? "assets.config.ts");
  // Dynamic import handles both .ts (Bun) and pre-compiled .js
  // biome-ignore lint/suspicious/noExplicitAny: dynamic module has unknown shape
  const mod = (await import(resolvedPath)) as any;
  const raw: unknown = mod.default ?? mod;
  const parsed = v.parse(AssetsConfigSchema, raw);

  const bundles: ResolvedJsBundle[] = (parsed.js?.bundles ?? []).map((bundle) => {
    const { define: rawDefine, ...rest } = bundle;
    if (!rawDefine) return rest;
    return { ...rest, define: Object.fromEntries(Object.entries(rawDefine).map(([k, val]) => [k, resolveDefine(val, processEnv)])) };
  });

  return {
    paths: {
      sourceDir: parsed.paths?.sourceDir ?? "src/static",
      publicDir: parsed.paths?.publicDir ?? "public/assets",
      publicPrefix: parsed.paths?.publicPrefix ?? "/assets",
    },
    js: { bundles },
    css: parsed.css ?? [],
    copy: parsed.copy ?? [],
    sprites: parsed.sprites ?? {},
    fonts: { downloads: parsed.fonts?.downloads ?? [] },
    icons: parsed.icons ?? null,
  };
}
