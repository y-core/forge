import * as v from "valibot";

const JsBundleSchema = v.object({
  entry: v.string(),
  outdir: v.string(),
  splitting: v.optional(v.boolean()),
  format: v.optional(v.picklist(["esm", "cjs", "iife"] as const)),
  minify: v.optional(v.boolean()),
});

const IconOutputSchema = v.union([
  v.object({ kind: v.literal("svg"), file: v.string() }),
  v.object({ kind: v.literal("png"), file: v.string(), size: v.number(), manifest: v.optional(v.boolean()) }),
  v.object({ kind: v.literal("ico"), file: v.string(), sizes: v.array(v.number()) }),
  v.object({ kind: v.literal("manifest"), file: v.string() }),
]);

const IconsConfigSchema = v.object({
  src: v.string(),
  outDir: v.string(),
  lightColor: v.string(),
  darkColor: v.optional(v.string()),
  app: v.optional(v.object({
    name: v.string(),
    shortName: v.string(),
    backgroundColor: v.string(),
  })),
  outputs: v.array(IconOutputSchema),
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
  icons: v.optional(IconsConfigSchema),
});

export type JsBundle = v.InferOutput<typeof JsBundleSchema>;
export type CssBuild = v.InferOutput<typeof CssBuildSchema>;
export type CopyEntry = v.InferOutput<typeof CopyEntrySchema>;
export type SpriteSource = v.InferOutput<typeof SpriteSourceSchema>;
export type SpriteGroup = v.InferOutput<typeof SpriteGroupSchema>;
export type Sprites = Record<string, SpriteGroup>;
export type FontDownload = v.InferOutput<typeof FontDownloadSchema>;
export type PathsConfig = v.InferOutput<typeof PathsConfigSchema>;
export type IconOutput = v.InferOutput<typeof IconOutputSchema>;
export type IconsConfig = v.InferOutput<typeof IconsConfigSchema>;
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
  icons: IconsConfig | null;
}
