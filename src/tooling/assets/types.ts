import { SiteConfigSchema } from "../../site/types";
import { v } from "../../validation/mod";

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

// A bundle's output directory is cleaned before it is written, so it has to be a directory of this
// group's own beneath the asset root — never the root itself, and never a path that leaves it.
const JsOutdirSchema = v.pipe(
  v.string(),
  v.regex(
    /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/,
    "not a bundle outdir — one or more path segments below the asset root, and never `.`, `..` or absolute",
  ),
);

const JsBundleSchema = v.object({
  entry: v.string(),
  outdir: JsOutdirSchema,
  splitting: v.optional(v.boolean()),
  format: v.optional(v.picklist(["esm", "cjs", "iife"] as const)),
  minify: v.optional(v.boolean()),
  define: v.optional(v.record(v.string(), DefineValueSchema)),
});

// `root: true` pins an output to the asset root, where a browser with no HTML head to read probes
// for it — a PDF, image, JSON or platform error-page tab, and every unfurler that never parses HTML.
const IconOutputSchema = v.union([
  v.object({ kind: v.literal("svg"), file: v.string(), root: v.optional(v.boolean()) }),
  v.object({
    kind: v.literal("png"),
    file: v.string(),
    size: v.number(),
    manifest: v.optional(v.boolean()),
    rel: v.optional(v.string()),
    root: v.optional(v.boolean()),
  }),
  v.object({ kind: v.literal("ico"), file: v.string(), sizes: v.array(v.number()), root: v.optional(v.boolean()) }),
  v.object({ kind: v.literal("manifest"), file: v.string(), root: v.optional(v.boolean()) }),
]);

// An icon colour is interpolated into a `<style>` block and into the manifest, so a value carrying
// `}` or `<` would close the element and continue as markup the browser executes.
const CssColorSchema = v.pipe(
  v.string(),
  v.regex(
    /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]+|(?:rgb|rgba|hsl|hsla)\([0-9.,%/\s+-]*\))$/,
    "not a CSS colour — a hex value, a colour keyword, or an rgb()/hsl() function",
  ),
);

const IconsConfigSchema = v.object({
  src: v.string(),
  outDir: v.string(),
  publicPrefix: v.optional(v.string()),
  lightColor: CssColorSchema,
  darkColor: v.optional(CssColorSchema),
  app: v.optional(v.object({ name: v.string(), shortName: v.string(), backgroundColor: v.string() })),
  outputs: v.array(IconOutputSchema),
});

const RasterEntrySchema = v.pipe(
  v.object({ from: v.string(), to: v.string(), width: v.optional(v.number()), height: v.optional(v.number()) }),
  v.check((e) => e.width !== undefined || e.height !== undefined, "raster entry needs width or height"),
);

const CssBuildSchema = v.object({ tool: v.literal("tailwindcss"), input: v.string(), output: v.string() });

const CopyEntrySchema = v.object({ from: v.string(), to: v.string() });

const SpriteFileEntrySchema = v.union([v.string(), v.object({ key: v.string(), file: v.string(), sha256: v.optional(v.string()) })]);

// A remote source is a supply-chain edge into the deploy directory, so each of its files pins the
// bytes it expects; a local one reads from the repository, where the review already happened.
const SpriteSourceSchema = v.pipe(
  v.object({ path: v.string(), files: v.array(SpriteFileEntrySchema) }),
  v.check(
    (source) => !/^https?:\/\//i.test(source.path) || source.files.every((file) => typeof file !== "string" && file.sha256 !== undefined),
    "a remote sprite source needs a { key, file, sha256 } entry for every file",
  ),
);

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

const FontDownloadSchema = v.object({ url: v.string(), to: v.string(), sha256: v.string() });

const PathsConfigSchema = v.object({ sourceDir: v.optional(v.string()), publicDir: v.optional(v.string()), publicPrefix: v.optional(v.string()) });

// `outDir` is the asset-tree root, not `paths.publicDir` — `robots.txt` and `sitemap.xml` are only
// meaningful at the root of the origin. This mirrors `icons`, the one other block allowed there.
const SiteBuildConfigSchema = v.object({ outDir: v.string(), config: SiteConfigSchema });

/** The files a configured `site` block writes into its `outDir`. @public */
export const SITE_OUTPUTS: readonly string[] = ["robots.txt", "sitemap.xml"];

export const AssetsConfigSchema = v.object({
  paths: v.optional(PathsConfigSchema),
  js: v.optional(v.object({ bundles: v.optional(v.array(JsBundleSchema)) })),
  css: v.optional(v.array(CssBuildSchema)),
  copy: v.optional(v.array(CopyEntrySchema)),
  rasters: v.optional(v.array(RasterEntrySchema)),
  sprites: v.optional(v.record(v.string(), SpriteGroupSchema)),
  fonts: v.optional(v.object({ downloads: v.optional(v.array(FontDownloadSchema)) })),
  icons: v.optional(IconsConfigSchema),
  cursors: v.optional(CursorsConfigSchema),
  site: v.optional(SiteBuildConfigSchema),
});

export type JsBundle = v.InferOutput<typeof JsBundleSchema>;
/** A `JsBundle` whose defines have been resolved to JavaScript source literals. @public */
export type ResolvedJsBundle = Omit<JsBundle, "define"> & { define?: Record<string, string> };
export type CssBuild = v.InferOutput<typeof CssBuildSchema>;
export type CopyEntry = v.InferOutput<typeof CopyEntrySchema>;
/** One SVG-to-PNG rasterization; the unset dimension is derived from the source's intrinsic ratio. @public */
export type RasterEntry = v.InferOutput<typeof RasterEntrySchema>;
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
/** Where the generated `robots.txt` and `sitemap.xml` are written, and the site config they render from. @public */
export type SiteBuildConfig = v.InferOutput<typeof SiteBuildConfigSchema>;
export type AssetsConfig = v.InferInput<typeof AssetsConfigSchema>;

export interface ResolvedPaths {
  sourceDir: string;
  publicDir: string;
  publicPrefix: string;
}

export interface ResolvedConfig {
  /** The application root every path below was resolved against. */
  root: string;
  paths: ResolvedPaths;
  js: { bundles: ResolvedJsBundle[] };
  css: CssBuild[];
  copy: CopyEntry[];
  rasters: RasterEntry[];
  sprites: Sprites;
  fonts: { downloads: FontDownload[] };
  icons: IconsConfig | null;
  cursors: CursorsConfig | null;
  site: SiteBuildConfig | null;
}

/** What `loadConfig` needs to find and normalise a config file. @public */
export interface LoadConfigOptions {
  root: string;
  configPath?: string;
  env?: Record<string, string | undefined>;
}

export interface BuildOptions {
  minify?: boolean;
  assetsPath?: string;
}

/** What `generateAssetsTypes` did to the module on disk. @public */
export type AssetsTypesOutcome = "written" | "kept-build-artifact";

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

/** A map from build key to the content hash last emitted for it. @public */
export type BuildState = Record<string, string>;
