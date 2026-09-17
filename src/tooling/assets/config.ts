import { resolve } from "node:path";

import { v } from "../../validation/mod";
import type { AssetsConfig, DefineValue, EnvRef, FlagRef, ResolvedConfig, ResolvedJsBundle } from "./types";
import { AssetsConfigSchema } from "./types";
import type { LoadConfigOptions } from "./types";

/** Types the default export of an `assets.config.ts`. @public */
export function defineAssetsConfig(config: AssetsConfig): AssetsConfig {
  return config;
}

/** Defers a bundle define to the named build-environment variable. @public */
export function env(name: string): EnvRef {
  return { __env: name };
}

/** Defers a bundle define to the named build-environment variable, coerced to a boolean. @public */
export function flag(name: string): FlagRef {
  return { __flag: name };
}

/** Resolves a define against `source` into the JavaScript literal esbuild substitutes. @internal */
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

// A remote sprite source is concatenated with its filename rather than joined, so `resolve` would
// fold the scheme's `//` away and turn the URL into a path under the root.
const REMOTE_SOURCE = /^https?:\/\//i;

function resolveSource(root: string, path: string): string {
  return REMOTE_SOURCE.test(path) ? path : resolve(root, path);
}

/** Imports, validates and normalises the asset config. @public */
export async function loadConfig(options: LoadConfigOptions): Promise<ResolvedConfig> {
  const { root, configPath = "assets.config.ts", env: envVars = {} } = options;
  const resolvedPath = resolve(root, configPath);
  // oxlint-disable-next-line typescript/no-explicit-any -- dynamic module has unknown shape
  const mod = (await import(resolvedPath)) as any;
  const raw: unknown = mod.default ?? mod;
  const parsed = v.parse(AssetsConfigSchema, raw);

  const bundles: ResolvedJsBundle[] = (parsed.js?.bundles ?? []).map((bundle) => {
    const { define: rawDefine, ...rest } = bundle;
    const entry = resolve(root, bundle.entry);
    if (!rawDefine) return { ...rest, entry };
    return { ...rest, entry, define: Object.fromEntries(Object.entries(rawDefine).map(([k, val]) => [k, resolveDefine(val, envVars)])) };
  });

  // A read path resolves against the root, so a run from a subdirectory reads where `--root` says. A
  // written one stays relative: it is the manifest key, and `safeJoin` contains it at build time.
  const icons = parsed.icons ?? null;
  const cursors = parsed.cursors ?? null;

  return {
    root,
    paths: {
      sourceDir: resolve(root, parsed.paths?.sourceDir ?? "src/static"),
      publicDir: resolve(root, parsed.paths?.publicDir ?? "public/assets"),
      publicPrefix: parsed.paths?.publicPrefix ?? "/assets",
    },
    js: { bundles },
    css: (parsed.css ?? []).map((build) => ({ ...build, input: resolve(root, build.input) })),
    copy: (parsed.copy ?? []).map((entry) => ({ ...entry, from: resolve(root, entry.from) })),
    rasters: (parsed.rasters ?? []).map((entry) => ({ ...entry, from: resolve(root, entry.from) })),
    sprites: Object.fromEntries(
      Object.entries(parsed.sprites ?? {}).map(([key, group]) => [
        key,
        { ...group, sources: group.sources.map((source) => ({ ...source, path: resolveSource(root, source.path) })) },
      ]),
    ),
    fonts: { downloads: parsed.fonts?.downloads ?? [] },
    icons: icons === null ? null : { ...icons, src: resolve(root, icons.src), outDir: resolve(root, icons.outDir) },
    cursors:
      cursors === null
        ? null
        : {
            ...cursors,
            sources: cursors.sources.map((source) => ({
              ...source,
              path: resolve(root, source.path),
              template: { ...source.template, path: resolve(root, source.template.path) },
            })),
          },
    site: parsed.site === undefined ? null : { ...parsed.site, outDir: resolve(root, parsed.site.outDir) },
  };
}
