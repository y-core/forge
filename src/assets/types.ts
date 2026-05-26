import * as v from "valibot";

const JsBundleSchema = v.object({
  entry: v.string(),
  outdir: v.string(),
  splitting: v.optional(v.boolean()),
  format: v.optional(v.picklist(["esm", "cjs", "iife"] as const)),
  minify: v.optional(v.boolean()),
});

const CssBuildSchema = v.object({
  tool: v.literal("tailwindcss"),
  input: v.string(),
  output: v.string(),
});

const CopyEntrySchema = v.object({
  from: v.string(),
  to: v.string(),
});

const SpriteSourceSchema = v.object({
  path: v.string(),
  files: v.array(v.string()),
});

const SpriteGroupSchema = v.object({
  target: v.string(),
  sources: v.array(SpriteSourceSchema),
});

const FontDownloadSchema = v.object({
  url: v.string(),
  to: v.string(),
});

const PathsConfigSchema = v.object({
  sourceDir: v.optional(v.string()),
  publicDir: v.optional(v.string()),
  publicPrefix: v.optional(v.string()),
});

export const AssetsConfigSchema = v.object({
  paths: v.optional(PathsConfigSchema),
  js: v.optional(
    v.object({
      bundles: v.optional(v.array(JsBundleSchema)),
    }),
  ),
  css: v.optional(v.array(CssBuildSchema)),
  copy: v.optional(v.array(CopyEntrySchema)),
  sprites: v.optional(v.record(v.string(), SpriteGroupSchema)),
  fonts: v.optional(
    v.object({
      downloads: v.optional(v.array(FontDownloadSchema)),
    }),
  ),
});

export type JsBundle = v.InferOutput<typeof JsBundleSchema>;
export type CssBuild = v.InferOutput<typeof CssBuildSchema>;
export type CopyEntry = v.InferOutput<typeof CopyEntrySchema>;
export type SpriteSource = v.InferOutput<typeof SpriteSourceSchema>;
export type SpriteGroup = v.InferOutput<typeof SpriteGroupSchema>;
export type Sprites = Record<string, SpriteGroup>;
export type FontDownload = v.InferOutput<typeof FontDownloadSchema>;
export type PathsConfig = v.InferOutput<typeof PathsConfigSchema>;
export type AssetsConfig = v.InferInput<typeof AssetsConfigSchema>;

export interface ResolvedPaths {
  sourceDir: string;
  publicDir: string;
  publicPrefix: string;
}

export interface ResolvedConfig {
  paths: ResolvedPaths;
  js: { bundles: JsBundle[] };
  css: CssBuild[];
  copy: CopyEntry[];
  sprites: Sprites;
  fonts: { downloads: FontDownload[] };
}
