import { v } from "../validation/mod";

/** A deferred read of a build-environment variable, resolved when a bundle's defines are resolved. @internal */
export type EnvRef = { readonly __env: string };
/** A deferred read of a build-environment variable coerced to a boolean. @internal */
export type FlagRef = { readonly __flag: string };
/** A constant substituted into a JS bundle at build time. @public */
export type DefineValue = string | number | boolean | null | EnvRef | FlagRef;

const DefineValueSchema = v.union([
  v.string(),
  v.number(),
  v.boolean(),
  v.null_(),
  v.object({ __env: v.string() }),
  v.object({ __flag: v.string() }),
]);

const JsBundleSchema = v.object({
  entry: v.string(),
  outdir: v.string(),
  splitting: v.optional(v.boolean()),
  format: v.optional(v.picklist(["esm", "cjs", "iife"] as const)),
  minify: v.optional(v.boolean()),
  define: v.optional(v.record(v.string(), DefineValueSchema)),
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
  app: v.optional(v.object({ name: v.string(), shortName: v.string(), backgroundColor: v.string() })),
  outputs: v.array(IconOutputSchema),
});

const CssBuildSchema = v.object({ tool: v.literal("tailwindcss"), input: v.string(), output: v.string() });

const CopyEntrySchema = v.object({ from: v.string(), to: v.string() });

const SpriteFileEntrySchema = v.union([v.string(), v.object({ key: v.string(), file: v.string() })]);

const SpriteSourceSchema = v.object({ path: v.string(), files: v.array(SpriteFileEntrySchema) });

const SpriteGroupSchema = v.object({ target: v.string(), sources: v.array(SpriteSourceSchema), prefix: v.optional(v.string()) });

const TemplateRefSchema = v.object({ path: v.string(), file: v.string() });

const CursorSourceSchema = v.object({ path: v.string(), files: v.array(SpriteFileEntrySchema), template: TemplateRefSchema });

const CursorsConfigSchema = v.object({
  target: v.string(),
  css: v.optional(v.string()),
  themes: v.record(v.string(), v.string()),
  sources: v.array(CursorSourceSchema),
  vars: v.optional(v.record(v.string(), v.union([v.string(), v.record(v.string(), v.string())]))),
});

const FontDownloadSchema = v.object({ url: v.string(), to: v.string() });

const PathsConfigSchema = v.object({ sourceDir: v.optional(v.string()), publicDir: v.optional(v.string()), publicPrefix: v.optional(v.string()) });

export const AssetsConfigSchema = v.object({
  paths: v.optional(PathsConfigSchema),
  js: v.optional(v.object({ bundles: v.optional(v.array(JsBundleSchema)) })),
  css: v.optional(v.array(CssBuildSchema)),
  copy: v.optional(v.array(CopyEntrySchema)),
  sprites: v.optional(v.record(v.string(), SpriteGroupSchema)),
  fonts: v.optional(v.object({ downloads: v.optional(v.array(FontDownloadSchema)) })),
  icons: v.optional(IconsConfigSchema),
  cursors: v.optional(CursorsConfigSchema),
});

export type JsBundle = v.InferOutput<typeof JsBundleSchema>;
/** A `JsBundle` whose defines have been resolved to JavaScript source literals. @public */
export type ResolvedJsBundle = Omit<JsBundle, "define"> & { define?: Record<string, string> };
export type CssBuild = v.InferOutput<typeof CssBuildSchema>;
export type CopyEntry = v.InferOutput<typeof CopyEntrySchema>;
/** One sprite source file, as a bare filename whose symbol key is its basename or an explicit key/file pair. @internal */
export type SpriteFileEntry = v.InferOutput<typeof SpriteFileEntrySchema>;
export type SpriteSource = v.InferOutput<typeof SpriteSourceSchema>;
export type SpriteGroup = v.InferOutput<typeof SpriteGroupSchema>;
export type Sprites = Record<string, SpriteGroup>;
export type FontDownload = v.InferOutput<typeof FontDownloadSchema>;
export type PathsConfig = v.InferOutput<typeof PathsConfigSchema>;
export type IconOutput = v.InferOutput<typeof IconOutputSchema>;
export type IconsConfig = v.InferOutput<typeof IconsConfigSchema>;
export type CursorSource = v.InferOutput<typeof CursorSourceSchema>;
export type CursorsConfig = v.InferOutput<typeof CursorsConfigSchema>;
export type AssetsConfig = v.InferInput<typeof AssetsConfigSchema>;

export interface ResolvedPaths {
  sourceDir: string;
  publicDir: string;
  publicPrefix: string;
}

export interface ResolvedConfig {
  paths: ResolvedPaths;
  js: { bundles: ResolvedJsBundle[] };
  css: CssBuild[];
  copy: CopyEntry[];
  sprites: Sprites;
  fonts: { downloads: FontDownload[] };
  icons: IconsConfig | null;
  cursors: CursorsConfig | null;
}
