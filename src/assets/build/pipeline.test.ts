import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedConfig } from "../types";
import { buildAll, generateAssetsTypes } from "./pipeline";

/**
 * Reads one emitted object literal back out of the generated module by text, rather than by
 * importing it: the artifact imports `@y-core/forge/ui/core`, and parsing keeps the assertion
 * on the bytes actually written.
 */
function parseEmittedObject(source: string, opening: string): Record<string, string> {
  const start = source.indexOf(opening);
  if (start === -1) throw new Error(`generated module has no \`${opening}\` block`);
  const bodyStart = start + opening.length;
  const body = source.slice(bodyStart, source.indexOf("\n}", bodyStart));

  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),$/);
    if (match?.[1] && match[2]) out[JSON.parse(match[1]) as string] = JSON.parse(match[2]) as string;
  }
  return out;
}

const DATA_BLOCK = "const DATA: Record<string, string> = {";

/** Stubs the `tailwindcss` shell-out, writing deterministic CSS to the `-o` path. */
function stubTailwind() {
  const spy = spyOn(childProcess, "execFileSync").mockImplementation(((_cmd: string, args: string[]) => {
    writeFileSync(args[args.indexOf("-o") + 1] as string, "/* built css */");
    return new Uint8Array();
  }) as never);
  spy.mockClear();
  return spy;
}

describe("buildAll() — emitHeaders", () => {
  it("emits no-cache for unhashed (dev) builds", async () => {
    const tmpDir = join(tmpdir(), "forge-pipeline-emitHeaders-dev");
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });

    try {
      await buildAll(
        {
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [] },
          copy: [],
          sprites: {},
          fonts: { downloads: [] },
          icons: null,
          cursors: null,
        },
        { minify: false },
      );

      const headersPath = join(tmpDir, "public", "_headers");
      expect(existsSync(headersPath)).toBe(true);
      const body = readFileSync(headersPath, "utf-8");
      expect(body).toContain("Cache-Control: no-cache");
      expect(body).not.toContain("immutable");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits immutable for hashed (prod) builds", async () => {
    const tmpDir = join(tmpdir(), "forge-pipeline-emitHeaders-prod");
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });

    try {
      await buildAll(
        {
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [] },
          copy: [],
          sprites: {},
          fonts: { downloads: [] },
          icons: null,
          cursors: null,
        },
        { minify: true },
      );

      const headersPath = join(tmpDir, "public", "_headers");
      expect(existsSync(headersPath)).toBe(true);
      const body = readFileSync(headersPath, "utf-8");
      expect(body).toContain("Cache-Control: public, max-age=31536000, immutable");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildAll() — generated module available to the JS bundle", () => {
  it("bundles a JS entry that imports `@assets` on a clean tree (no pre-existing module)", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-assets-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    const assetsModule = join(tmpDir, ".forge", "assets.ts");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(publicDir, { recursive: true });

    try {
      // esbuild resolves the `@assets` alias via the nearest tsconfig to the entry file. The
      // generated module imports `createManifest` from forge; alias it to source so the bundle
      // resolves outside forge's own node_modules tree.
      const forgeManifest = join(process.cwd(), "src", "assets", "manifest", "mod.ts");
      writeFileSync(
        join(tmpDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@assets": [".forge/assets.ts"], "@y-core/forge/assets/manifest": [forgeManifest] } },
        }),
      );
      // The entry imports the generated module — exactly what breaks if it isn't written first.
      writeFileSync(join(tmpDir, "src", "main.ts"), `import { assets } from "@assets";\nexport const path = assets.path("styles.css");\n`);

      // No `.forge/assets.ts` exists yet — a clean checkout.
      expect(existsSync(assetsModule)).toBe(false);

      await buildAll(
        {
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [{ entry: join(tmpDir, "src", "main.ts"), outdir: "js", format: "esm" }] },
          copy: [],
          sprites: {},
          fonts: { downloads: [] },
          icons: null,
          cursors: null,
        },
        { minify: false, assetsPath: assetsModule },
      );

      // The bundle resolved `@assets` and was emitted, and the module is present for SSR.
      expect(existsSync(assetsModule)).toBe(true);
      expect(existsSync(join(publicDir, "js", "main.js"))).toBe(true);
      // The final module carries the JS bundle's own output path (added after bundling) for SSR.
      expect(readFileSync(assetsModule, "utf-8")).toContain("js/main.js");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("generateAssetsTypes() — no drift from the real build", () => {
  it("emits the same manifest keys and the same icon-name union as buildAll", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-types-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    const svgDir = join(tmpDir, "svg");
    const builtModule = join(tmpDir, "built.ts");
    const typesModule = join(tmpDir, "types.ts");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(svgDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });

    const execSpy = stubTailwind();
    try {
      writeFileSync(join(svgDir, "arrow-right.svg"), `<svg viewBox="0 0 16 16"><path d="M0 0h4v4H0z"/></svg>`);
      writeFileSync(join(svgDir, "x-mark.svg"), `<svg viewBox="0 0 20 20"><path d="M0 0h4v4H0z"/></svg>`);
      writeFileSync(join(tmpDir, "src", "main.ts"), `export const x = 1;\n`);

      // Every shape the two derivations could disagree on: a bare-string sprite entry (key from
      // the basename) and an object entry (explicit key), under a default prefix and an override.
      const config = {
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
        css: [{ tool: "tailwindcss", input: join(tmpDir, "app.css"), output: "styles.css" }],
        js: { bundles: [{ entry: join(tmpDir, "src", "main.ts"), outdir: "js", format: "esm" }] },
        copy: [],
        sprites: {
          ui: { target: "sprites/ui.svg", sources: [{ path: svgDir, files: ["arrow-right.svg"] }] },
          brand: { target: "sprites/brand.svg", prefix: "glyph-", sources: [{ path: svgDir, files: [{ key: "close", file: "x-mark.svg" }] }] },
        },
        fonts: { downloads: [] },
        icons: null,
        cursors: null,
      } satisfies ResolvedConfig;

      await buildAll(config, { minify: true, assetsPath: builtModule });
      await generateAssetsTypes(config, { assetsPath: typesModule });

      const built = readFileSync(builtModule, "utf-8");
      const types = readFileSync(typesModule, "utf-8");

      const builtData = parseEmittedObject(built, DATA_BLOCK);
      const typesData = parseEmittedObject(types, DATA_BLOCK);
      const builtUi = parseEmittedObject(built, "const UI_META = {");
      const typesUi = parseEmittedObject(types, "const UI_META = {");
      const builtBrand = parseEmittedObject(built, "const BRAND_META = {");
      const typesBrand = parseEmittedObject(types, "const BRAND_META = {");

      // Guard the comparisons below against passing vacuously on two empty sets.
      expect(Object.keys(builtData).sort()).toEqual(["js/main.js", "sprites/brand.svg", "sprites/ui.svg", "styles.css"]);
      expect(Object.keys(builtUi)).toEqual(["icon-arrow-right"]);
      expect(Object.keys(builtBrand)).toEqual(["glyph-close"]);

      // The manifest keys are identical — every logical asset name the build knows about.
      expect(Object.keys(typesData).sort()).toEqual(Object.keys(builtData).sort());
      // The `*_META` keys are identical — this is the icon-name union `createIcon` is typed on,
      // and the only real type safety the artifact carries.
      expect(Object.keys(typesUi).sort()).toEqual(Object.keys(builtUi).sort());
      expect(Object.keys(typesBrand).sort()).toEqual(Object.keys(builtBrand).sort());

      // The *values* are exactly where the two diverge: hashed paths and scraped viewBoxes need
      // a real build; identity paths and empty viewBoxes are what config alone can know.
      expect(builtData["styles.css"]).toMatch(/^styles\.[0-9a-f]{8}\.css$/);
      expect(typesData["styles.css"]).toBe("styles.css");
      expect(builtUi["icon-arrow-right"]).toBe("0 0 16 16");
      expect(typesUi["icon-arrow-right"]).toBe("");
      expect(builtBrand["glyph-close"]).toBe("0 0 20 20");
      expect(typesBrand["glyph-close"]).toBe("");

      // Same emitter, so everything structural — imports, `createIcon` calls, export names,
      // publicPrefix — is byte-identical outside the banner and those values.
      expect(types).toContain(`export const UiIcon = createIcon(assets.path("sprites/ui.svg"), UI_META, "icon-");`);
      expect(types).toContain(`export const BrandIcon = createIcon(assets.path("sprites/brand.svg"), BRAND_META, "glyph-");`);
      expect(types).toContain(`createManifest(DATA, "/assets")`);
      expect(types).toContain("TYPES ONLY");
      expect(built).not.toContain("TYPES ONLY");
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("generateAssetsTypes() — derives from config alone", () => {
  it("emits with no tailwind, no esbuild, no sharp and no network, against sources that do not exist", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-types-only-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    const missing = join(tmpDir, "does-not-exist");
    const typesModule = join(tmpDir, "assets.ts");
    mkdirSync(tmpDir, { recursive: true });

    const execSpy = stubTailwind();
    try {
      // Nothing this config names is on disk, and one sprite source is a URL that would have to
      // be fetched. A build would fail or reach the network; the derivation reads only the config.
      const config = {
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/static" },
        css: [{ tool: "tailwindcss", input: join(missing, "app.css"), output: "styles.css" }],
        js: { bundles: [{ entry: join(missing, "main.ts"), outdir: "js", format: "esm" }] },
        copy: [],
        sprites: {
          ui: {
            target: "sprites/ui.svg",
            sources: [
              { path: "https://example.invalid/icons/", files: ["spinner.svg"] },
              { path: missing, files: ["chevron-down.svg"] },
            ],
          },
        },
        fonts: { downloads: [{ url: "https://example.invalid/inter.woff2", to: "fonts/inter.woff2" }] },
        icons: null,
        cursors: {
          target: "cursors.css",
          themes: { light: ":root", dark: ".dark" },
          sources: [{ path: missing, files: ["pointer.svg"], template: { path: missing, file: "wrapper.svg" } }],
        },
      } satisfies ResolvedConfig;

      await generateAssetsTypes(config, { assetsPath: typesModule });

      const source = readFileSync(typesModule, "utf-8");
      expect(Object.keys(parseEmittedObject(source, DATA_BLOCK)).sort()).toEqual(["js/main.js", "sprites/ui.svg", "styles.css"]);
      // A remote source contributes its icon name like any other — the name is in the config.
      expect(Object.keys(parseEmittedObject(source, "const UI_META = {")).sort()).toEqual(["icon-chevron-down", "icon-spinner"]);
      // `CURSOR_BAKES` exists wherever a real build would export it, keyed cursor × theme.
      expect(source).toContain("export const CURSOR_BAKES");
      expect(source).toContain(`"pointer": {`);
      expect(source).toContain(`"light": "",`);
      expect(source).toContain(`"dark": "",`);

      expect(execSpy).not.toHaveBeenCalled();
      // No build ran, so nothing was written outside the module itself.
      expect(existsSync(publicDir)).toBe(false);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
