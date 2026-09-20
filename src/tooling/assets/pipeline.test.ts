import { describe, expect, it, mock, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createPdfFontSet, readPdfFontPack } from "../../output/pdf/fonts/mod";
import type { PdfFontPackData } from "../../output/pdf/fonts/types";
import { createPdfRenderer } from "../../output/pdf/mod";
import type { PdfArtwork, PdfLetterhead } from "../../output/pdf/types";
import { buildAll, generateAssetsTypes, readEmittedManifest, structuralSignature } from "./pipeline";
import type { ResolvedConfig } from "./types";

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

function extractUnionLine(source: string, typeName: string): string {
  const line = source.split("\n").find((candidate) => candidate.startsWith(`export type ${typeName} = `));
  if (line === undefined) throw new Error(`generated module has no \`${typeName}\` union`);
  return line;
}

const DATA_BLOCK = "const DATA: Record<string, string> = {";

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
          root: tmpDir,
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [] },
          copy: [],
          rasters: [],
          sprites: {},
          fonts: { downloads: [], subsets: [], emit: null },
          marks: [],
          icons: null,
          cursors: null,
          site: null,
        },
        { minify: false, assetsPath: join(tmpDir, ".forge", "assets.ts") },
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

  it("gives each icon its own rule, and the manifest a revalidating one", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-headers-icons-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });

    try {
      const srcPath = join(tmpDir, "logo.svg");
      writeFileSync(srcPath, `<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>`);

      await buildAll(
        {
          root: tmpDir,
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [] },
          copy: [],
          rasters: [],
          sprites: {},
          fonts: { downloads: [], subsets: [], emit: null },
          marks: [],
          icons: {
            src: srcPath,
            outDir: join(tmpDir, "public"),
            publicPrefix: "/static",
            lightColor: "#000",
            app: { name: "Demo", shortName: "Demo", backgroundColor: "#fff" },
            outputs: [
              { kind: "svg", file: "favicon.svg" },
              { kind: "ico", file: "favicon.ico", sizes: [16], root: true },
              { kind: "manifest", file: "site.webmanifest" },
            ],
          },
          cursors: null,
          site: null,
        },
        { minify: true, assetsPath: join(tmpDir, ".forge", "assets.ts") },
      );

      expect(readFileSync(join(tmpDir, "public", "_headers"), "utf-8")).toBe(
        [
          "/assets/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
          "/static/favicon.svg",
          "  Cache-Control: public, max-age=86400, stale-while-revalidate=604800",
          "",
          "/favicon.ico",
          "  Cache-Control: public, max-age=86400, stale-while-revalidate=604800",
          "",
          "/static/site.webmanifest",
          "  Cache-Control: public, max-age=0, must-revalidate",
          "",
        ].join("\n"),
      );
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
          root: tmpDir,
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [] },
          copy: [],
          rasters: [],
          sprites: {},
          fonts: { downloads: [], subsets: [], emit: null },
          marks: [],
          icons: null,
          cursors: null,
          site: null,
        },
        { minify: true, assetsPath: join(tmpDir, ".forge", "assets.ts") },
      );

      const headersPath = join(tmpDir, "public", "_headers");
      expect(existsSync(headersPath)).toBe(true);
      const body = readFileSync(headersPath, "utf-8");
      expect(body).toContain("Cache-Control: public, max-age=31536000, immutable");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes the cache rule for a non-default publicPrefix", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-emitHeaders-prefix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });

    try {
      await buildAll(
        {
          root: tmpDir,
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/static" },
          css: [],
          js: { bundles: [] },
          copy: [],
          rasters: [],
          sprites: {},
          fonts: { downloads: [], subsets: [], emit: null },
          marks: [],
          icons: null,
          cursors: null,
          site: null,
        },
        { minify: true, assetsPath: join(tmpDir, ".forge", "assets.ts") },
      );

      expect(readFileSync(join(tmpDir, "public", "_headers"), "utf-8")).toBe("/static/*\n  Cache-Control: public, max-age=31536000, immutable\n");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildAll() — rasters", () => {
  it("writes a configured raster under publicDir and still emits the immutable header on a hashed build", async () => {
    // `sharp` is an optional peer, so a test that loads it for real passes or fails on the platform.
    const resizes: Record<string, number>[] = [];
    await mock.module("sharp", () => ({
      default: () => ({
        resize: (resize: Record<string, number>) => ({
          png: () => ({
            toFile: async (dest: string) => {
              resizes.push(resize);
              writeFileSync(dest, "PNG");
            },
            toBuffer: async () => new TextEncoder().encode("PNG"),
          }),
        }),
      }),
    }));
    const tmpDir = join(tmpdir(), `forge-pipeline-rasters-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });

    try {
      const from = join(tmpDir, "logo.svg");
      writeFileSync(
        from,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 315 95" width="315" height="95"><rect width="315" height="95"/></svg>`,
      );

      await buildAll(
        {
          root: tmpDir,
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [] },
          copy: [],
          rasters: [{ from, to: "email/logo@2x.png", width: 360 }],
          sprites: {},
          fonts: { downloads: [], subsets: [], emit: null },
          marks: [],
          icons: null,
          cursors: null,
          site: null,
        },
        { minify: true, assetsPath: join(tmpDir, ".forge", "assets.ts") },
      );

      const dest = join(publicDir, "email", "logo@2x.png");
      expect(existsSync(dest)).toBe(true);
      expect(resizes).toEqual([{ width: 360 }]);

      expect(readFileSync(join(tmpDir, "public", "_headers"), "utf-8")).toBe("/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
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
      const forgeManifest = join(process.cwd(), "src", "assets", "mod.ts");
      writeFileSync(
        join(tmpDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@assets": [".forge/assets.ts"], "@y-core/forge/assets": [forgeManifest] } } }),
      );
      writeFileSync(join(tmpDir, "src", "main.ts"), `import { assets } from "@assets";\nexport const path = assets.path("styles.css");\n`);

      expect(existsSync(assetsModule)).toBe(false);

      await buildAll(
        {
          root: tmpDir,
          paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
          css: [],
          js: { bundles: [{ entry: join(tmpDir, "src", "main.ts"), outdir: "js", format: "esm" }] },
          copy: [],
          rasters: [],
          sprites: {},
          fonts: { downloads: [], subsets: [], emit: null },
          marks: [],
          icons: null,
          cursors: null,
          site: null,
        },
        { minify: false, assetsPath: assetsModule },
      );

      expect(existsSync(assetsModule)).toBe(true);
      expect(existsSync(join(publicDir, "js", "main.js"))).toBe(true);
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

      const config = {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
        css: [{ tool: "tailwindcss", input: join(tmpDir, "app.css"), output: "styles.css" }],
        js: { bundles: [{ entry: join(tmpDir, "src", "main.ts"), outdir: "js", format: "esm" }] },
        copy: [],
        rasters: [],
        sprites: {
          ui: { target: "sprites/ui.svg", sources: [{ path: svgDir, files: ["arrow-right.svg"] }] },
          brand: { target: "sprites/brand.svg", prefix: "glyph-", sources: [{ path: svgDir, files: [{ key: "close", file: "x-mark.svg" }] }] },
        },
        fonts: { downloads: [], subsets: [], emit: null },
        marks: [],
        icons: null,
        cursors: null,
        site: null,
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

      expect(Object.keys(builtData).sort()).toEqual(["js/main.js", "sprites/brand.svg", "sprites/ui.svg", "styles.css"]);
      expect(Object.keys(builtUi)).toEqual(["icon-arrow-right"]);
      expect(Object.keys(builtBrand)).toEqual(["glyph-close"]);

      expect(Object.keys(typesData).sort()).toEqual(Object.keys(builtData).sort());
      expect(Object.keys(typesUi).sort()).toEqual(Object.keys(builtUi).sort());
      expect(Object.keys(typesBrand).sort()).toEqual(Object.keys(builtBrand).sort());

      expect(builtData["styles.css"]).toMatch(/^styles\.[0-9a-f]{8}\.css$/);
      expect(typesData["styles.css"]).toBe("styles.css");
      expect(builtUi["icon-arrow-right"]).toBe("0 0 16 16");
      expect(typesUi["icon-arrow-right"]).toBe("");
      expect(builtBrand["glyph-close"]).toBe("0 0 20 20");
      expect(typesBrand["glyph-close"]).toBe("");

      expect(extractUnionLine(built, "UiIconName")).toBe(`export type UiIconName = "arrow-right";`);
      expect(extractUnionLine(built, "BrandIconName")).toBe(`export type BrandIconName = "close";`);
      expect(extractUnionLine(types, "UiIconName")).toBe(extractUnionLine(built, "UiIconName"));
      expect(extractUnionLine(types, "BrandIconName")).toBe(extractUnionLine(built, "BrandIconName"));

      expect(types).toContain(`export const UiIcon = createIcon(assets.path("sprites/ui.svg"), UI_META, "icon-");`);
      expect(types).toContain(`export const BrandIcon = createIcon(assets.path("sprites/brand.svg"), BRAND_META, "glyph-");`);
      expect(types).toContain(`createManifest(DATA, "/assets")`);
      expect(types).toContain("TYPES ONLY");
      expect(built).not.toContain("TYPES ONLY");
      expect(structuralSignature(built)).toBe(structuralSignature(types));
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("generateAssetsTypes() — never clobbers a build artifact", () => {
  function scaffold(label: string): { tmpDir: string; config: ResolvedConfig; assetsPath: string } {
    const tmpDir = join(tmpdir(), `forge-pipeline-guard-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    const svgDir = join(tmpDir, "svg");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(svgDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });

    writeFileSync(join(svgDir, "arrow-right.svg"), `<svg viewBox="0 0 16 16"><path d="M0 0h4v4H0z"/></svg>`);
    writeFileSync(join(tmpDir, "src", "main.ts"), `export const x = 1;\n`);

    return {
      tmpDir,
      assetsPath: join(tmpDir, ".forge", "assets.ts"),
      config: {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
        css: [{ tool: "tailwindcss", input: join(tmpDir, "app.css"), output: "styles.css" }],
        js: { bundles: [{ entry: join(tmpDir, "src", "main.ts"), outdir: "js", format: "esm" }] },
        copy: [],
        rasters: [],
        sprites: { ui: { target: "sprites/ui.svg", sources: [{ path: svgDir, files: ["arrow-right.svg"] }] } },
        fonts: { downloads: [], subsets: [], emit: null },
        marks: [],
        icons: null,
        cursors: null,
        site: null,
      },
    };
  }

  it("keeps the hashed build artifact byte-for-byte when both commands share one path", async () => {
    const { tmpDir, config, assetsPath } = scaffold("hashed");
    const execSpy = stubTailwind();
    try {
      await buildAll(config, { minify: true, assetsPath });
      const built = readFileSync(assetsPath, "utf-8");
      expect(parseEmittedObject(built, DATA_BLOCK)["js/main.js"]).toMatch(/^js\/main-[A-Z0-9]+\.js$/);

      expect(await generateAssetsTypes(config, { assetsPath })).toBe("kept-build-artifact");
      expect(readFileSync(assetsPath, "utf-8")).toBe(built);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps an unhashed build artifact too", async () => {
    const { tmpDir, config, assetsPath } = scaffold("unhashed");
    const execSpy = stubTailwind();
    try {
      await buildAll(config, { minify: false, assetsPath });
      const built = readFileSync(assetsPath, "utf-8");

      expect(await generateAssetsTypes(config, { assetsPath })).toBe("kept-build-artifact");
      expect(readFileSync(assetsPath, "utf-8")).toBe(built);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rewrites a build artifact whose shape no longer fits the config", async () => {
    const { tmpDir, config, assetsPath } = scaffold("stale");
    const execSpy = stubTailwind();
    try {
      await buildAll(config, { minify: true, assetsPath });
      writeFileSync(join(tmpDir, "src", "admin.ts"), `export const y = 2;\n`);
      const grown: ResolvedConfig = {
        ...config,
        js: { bundles: [...config.js.bundles, { entry: join(tmpDir, "src", "admin.ts"), outdir: "js", format: "esm" }] },
      };

      expect(await generateAssetsTypes(grown, { assetsPath })).toBe("written");
      const rewritten = readFileSync(assetsPath, "utf-8");
      expect(rewritten.startsWith("// AUTO-GENERATED by `forge assets gen types`")).toBe(true);
      expect(parseEmittedObject(rewritten, DATA_BLOCK)["js/admin.js"]).toBe("js/admin.js");
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes when no module exists, and rewrites an existing types artifact", async () => {
    const { tmpDir, config, assetsPath } = scaffold("absent");
    try {
      expect(existsSync(assetsPath)).toBe(false);
      expect(await generateAssetsTypes(config, { assetsPath })).toBe("written");
      expect(await generateAssetsTypes(config, { assetsPath })).toBe("written");
      expect(readFileSync(assetsPath, "utf-8")).toContain("TYPES ONLY");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("structuralSignature()", () => {
  const module = [
    "// AUTO-GENERATED by @y-core/forge assets build — do not edit.",
    `import { createManifest } from "@y-core/forge/assets";`,
    "",
    "const DATA: Record<string, string> = {",
    `  "styles.css": "styles.abc12345.css",`,
    "};",
    "",
    `export const assets = createManifest(DATA, "/assets");`,
    "",
  ].join("\n");

  it("ignores values and the header, so a hashed and an identity module agree", () => {
    const types = module
      .replace("// AUTO-GENERATED by @y-core/forge assets build — do not edit.", "// a\n// b\n// c")
      .replace("styles.abc12345.css", "styles.css");
    expect(structuralSignature(types)).toBe(structuralSignature(module));
  });

  it("differs when a manifest key is added", () => {
    const grown = module.replace(
      `  "styles.css": "styles.abc12345.css",\n`,
      `  "styles.css": "styles.abc12345.css",\n  "js/main.js": "js/main.js",\n`,
    );
    expect(structuralSignature(grown)).not.toBe(structuralSignature(module));
  });

  it("differs when the public prefix changes", () => {
    expect(structuralSignature(module.replace(`"/assets"`, `"/static"`))).not.toBe(structuralSignature(module));
  });

  it("differs when a glyph is added", () => {
    const withGlyph = `${module}\nconst UI_META = {\n  "icon-a": "0 0 16 16",\n} as const;\n`;
    const withTwo = `${module}\nconst UI_META = {\n  "icon-a": "0 0 16 16",\n  "icon-b": "0 0 16 16",\n} as const;\n`;
    expect(structuralSignature(withTwo)).not.toBe(structuralSignature(withGlyph));
  });
});

describe("readEmittedManifest()", () => {
  function scaffold(label: string): { tmpDir: string; config: ResolvedConfig; assetsPath: string } {
    const tmpDir = join(tmpdir(), `forge-pipeline-read-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(join(tmpDir, "public", "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "main.ts"), `export const x = 1;\n`);

    return {
      tmpDir,
      assetsPath: join(tmpDir, ".forge", "assets.ts"),
      config: {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir: join(tmpDir, "public", "assets"), publicPrefix: "/assets" },
        css: [{ tool: "tailwindcss", input: join(tmpDir, "app.css"), output: "styles.css" }],
        js: { bundles: [{ entry: join(tmpDir, "src", "main.ts"), outdir: "js", format: "esm" }] },
        copy: [],
        rasters: [],
        sprites: {},
        fonts: { downloads: [], subsets: [], emit: null },
        marks: [],
        icons: null,
        cursors: null,
        site: null,
      },
    };
  }

  it("reports a build artifact as not types-only, with its hashed values", async () => {
    const { tmpDir, config, assetsPath } = scaffold("build");
    const execSpy = stubTailwind();
    try {
      await buildAll(config, { minify: true, assetsPath });
      const read = readEmittedManifest(readFileSync(assetsPath, "utf-8"));

      expect(read.typesOnly).toBe(false);
      expect(read.data?.["js/main.js"]).toMatch(/^js\/main-[A-Z0-9]+\.js$/);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports a types artifact as types-only, with identity values", async () => {
    const { tmpDir, config, assetsPath } = scaffold("types");
    try {
      await generateAssetsTypes(config, { assetsPath });
      const read = readEmittedManifest(readFileSync(assetsPath, "utf-8"));

      expect(read.typesOnly).toBe(true);
      expect(read.data).toEqual({ "styles.css": "styles.css", "js/main.js": "js/main.js" });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("tells a module with no DATA block apart from one whose block is empty", () => {
    expect(readEmittedManifest(`export const assets = {};\n`).data).toBeNull();
    expect(readEmittedManifest(`const DATA: Record<string, string> = {\n\n};\n`).data).toEqual({});
  });
});

describe("generateAssetsTypes() — glyph-name union", () => {
  function typesConfig(tmpDir: string, sprites: ResolvedConfig["sprites"]): ResolvedConfig {
    return {
      root: tmpDir,
      paths: { sourceDir: tmpDir, publicDir: join(tmpDir, "public", "assets"), publicPrefix: "/assets" },
      css: [],
      js: { bundles: [] },
      copy: [],
      rasters: [],
      sprites,
      fonts: { downloads: [], subsets: [], emit: null },
      marks: [],
      icons: null,
      cursors: null,
      site: null,
    };
  }

  async function emitTypes(label: string, sprites: ResolvedConfig["sprites"], assert: (source: string) => void): Promise<void> {
    const tmpDir = join(tmpdir(), `forge-pipeline-union-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const typesModule = join(tmpDir, "assets.ts");
    mkdirSync(tmpDir, { recursive: true });
    try {
      await generateAssetsTypes(typesConfig(tmpDir, sprites), { assetsPath: typesModule });
      assert(readFileSync(typesModule, "utf-8"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it("emits one member per glyph in config order with the default `icon-` prefix stripped", async () => {
    await emitTypes(
      "default-prefix",
      { ui: { target: "sprites/ui.svg", sources: [{ path: "svg", files: ["spinner.svg", "chevron-down.svg"] }] } },
      (source) => {
        expect(extractUnionLine(source, "UiIconName")).toBe(`export type UiIconName = "spinner" | "chevron-down";`);
      },
    );
  });

  it("strips a custom prefix rather than the default", async () => {
    await emitTypes(
      "custom-prefix",
      {
        brand: {
          target: "sprites/brand.svg",
          prefix: "glyph-",
          sources: [{ path: "svg", files: [{ key: "close", file: "x-mark.svg" }, "icon-badge.svg"] }],
        },
      },
      (source) => {
        expect(extractUnionLine(source, "BrandIconName")).toBe(`export type BrandIconName = "close" | "icon-badge";`);
      },
    );
  });

  it("emits `never` for a group whose sources contribute no glyph", async () => {
    await emitTypes("empty-meta", { ui: { target: "sprites/ui.svg", sources: [] } }, (source) => {
      expect(extractUnionLine(source, "UiIconName")).toBe("export type UiIconName = never;");
    });
  });
});

describe("generateAssetsTypes() — ICON_LINKS", () => {
  it("emits the head links from the icons config, with no sharp and no icon files on disk", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-icon-links-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const typesModule = join(tmpDir, "assets.ts");
    mkdirSync(tmpDir, { recursive: true });

    try {
      const config = {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir: join(tmpDir, "public", "assets"), publicPrefix: "/assets" },
        css: [],
        js: { bundles: [] },
        copy: [],
        rasters: [],
        sprites: {},
        fonts: { downloads: [], subsets: [], emit: null },
        marks: [],
        icons: {
          src: join(tmpDir, "logo.svg"),
          outDir: join(tmpDir, "public"),
          publicPrefix: "/static",
          lightColor: "#000",
          outputs: [
            { kind: "ico", file: "favicon.ico", sizes: [16, 32, 48], root: true },
            { kind: "svg", file: "favicon.svg" },
            { kind: "manifest", file: "site.webmanifest" },
          ],
        },
        site: null,
        cursors: null,
      } satisfies ResolvedConfig;

      await generateAssetsTypes(config, { assetsPath: typesModule });

      const source = readFileSync(typesModule, "utf-8");
      expect(source).toContain(`import type { IconLink } from "@y-core/forge/assets";`);
      expect(source).toContain(`export const ICON_LINKS: ReadonlyArray<IconLink> = [`);
      expect(source).toContain(`{"rel":"icon","href":"/favicon.ico","sizes":"16x16 32x32 48x48"},`);
      expect(source).toContain(`{"rel":"icon","href":"/static/favicon.svg","type":"image/svg+xml"},`);
      expect(source).toContain(`{"rel":"manifest","href":"/static/site.webmanifest"},`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits no ICON_LINKS block and no IconLink import when the config declares no icons", async () => {
    const tmpDir = join(tmpdir(), `forge-pipeline-no-icons-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const typesModule = join(tmpDir, "assets.ts");
    mkdirSync(tmpDir, { recursive: true });

    try {
      const config = {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir: join(tmpDir, "public", "assets"), publicPrefix: "/assets" },
        css: [],
        js: { bundles: [] },
        copy: [],
        rasters: [],
        sprites: {},
        fonts: { downloads: [], subsets: [], emit: null },
        marks: [],
        icons: null,
        site: null,
        cursors: null,
      } satisfies ResolvedConfig;

      await generateAssetsTypes(config, { assetsPath: typesModule });

      const source = readFileSync(typesModule, "utf-8");
      expect(source).not.toContain("ICON_LINKS");
      expect(source).not.toContain("IconLink");
    } finally {
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
      const config = {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/static" },
        css: [{ tool: "tailwindcss", input: join(missing, "app.css"), output: "styles.css" }],
        js: { bundles: [{ entry: join(missing, "main.ts"), outdir: "js", format: "esm" }] },
        copy: [],
        rasters: [],
        sprites: {
          ui: {
            target: "sprites/ui.svg",
            sources: [
              { path: "https://example.invalid/icons/", files: [{ key: "spinner", file: "spinner.svg", sha256: "a".repeat(64) }] },
              { path: missing, files: ["chevron-down.svg"] },
            ],
          },
        },
        fonts: {
          downloads: [{ url: "https://example.invalid/inter.woff2", to: "fonts/inter.woff2", sha256: "a".repeat(64) }],
          subsets: [],
          emit: null,
        },
        marks: [],
        icons: null,
        site: null,
        cursors: {
          target: "cursors.css",
          themes: { light: ":root", dark: ".dark" },
          sources: [{ path: missing, files: ["pointer.svg"], template: { path: missing, file: "wrapper.svg" } }],
        },
      } satisfies ResolvedConfig;

      await generateAssetsTypes(config, { assetsPath: typesModule });

      const source = readFileSync(typesModule, "utf-8");
      expect(Object.keys(parseEmittedObject(source, DATA_BLOCK)).sort()).toEqual(["js/main.js", "sprites/ui.svg", "styles.css"]);
      expect(Object.keys(parseEmittedObject(source, "const UI_META = {")).sort()).toEqual(["icon-chevron-down", "icon-spinner"]);
      expect(source).toContain("export const CURSOR_BAKES");
      expect(source).toContain(`"pointer": {`);
      expect(source).toContain(`"light": "",`);
      expect(source).toContain(`"dark": "",`);

      expect(execSpy).not.toHaveBeenCalled();
      expect(existsSync(publicDir)).toBe(false);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildAll() — the mark conversion stage", () => {
  const REPO = resolve(import.meta.dir, "../../..");

  async function build(marks: ResolvedConfig["marks"]): Promise<string> {
    const tmpDir = join(tmpdir(), `forge-pipeline-marks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });
    await buildAll(
      {
        root: REPO,
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
        css: [],
        js: { bundles: [] },
        copy: [],
        rasters: [],
        sprites: {},
        fonts: { downloads: [], subsets: [], emit: null },
        marks,
        icons: null,
        cursors: null,
        site: null,
      },
      { minify: false, assetsPath: join(tmpDir, ".forge", "assets.ts") },
    );
    return publicDir;
  }

  const CONFIGURED: ResolvedConfig["marks"] = [{ from: "tests/fixtures/mark/mark.svg", to: "marks/letterhead.json" }];

  it("writes the artifact when a mark is configured", async () => {
    const publicDir = await build(CONFIGURED);
    try {
      expect(existsSync(join(publicDir, "marks", "letterhead.json"))).toBe(true);
    } finally {
      rmSync(join(publicDir, "..", ".."), { recursive: true, force: true });
    }
  });

  it("writes nothing when no mark is configured, so the stage is the guard it looks like", async () => {
    const publicDir = await build([]);
    try {
      expect(existsSync(join(publicDir, "marks"))).toBe(false);
    } finally {
      rmSync(join(publicDir, "..", ".."), { recursive: true, force: true });
    }
  });

  // The join, with no hand-written fixture on the path: what the build wrote is what the engine draws.
  it("produces an artifact the engine renders as a letterhead's mark", async () => {
    const publicDir = await build(CONFIGURED);
    try {
      const mark = JSON.parse(readFileSync(join(publicDir, "marks", "letterhead.json"), "utf-8")) as PdfArtwork;
      const plain = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143" };
      const fills = async (letterhead: PdfLetterhead): Promise<number> => {
        const rendered = await createPdfRenderer({ compress: false }).render({ title: "Declaration", letterhead, content: [] });
        if (!rendered.ok) throw new Error(rendered.error.message);
        return [...new TextDecoder("latin1").decode(rendered.data).matchAll(/ f\n/g)].length;
      };
      // Each shape the SVG declares is one more filled path on the page than the same letterhead
      // draws without it, which is the artifact reaching the renderer rather than merely parsing.
      expect(mark.paths.length).toBeGreaterThan(0);
      expect((await fills({ ...plain, mark })) - (await fills(plain))).toBe(mark.paths.length);
    } finally {
      rmSync(join(publicDir, "..", ".."), { recursive: true, force: true });
    }
  });
});

describe("buildAll() — the font subset stage", () => {
  const SOURCE = "node_modules/@expo-google-fonts/oswald/400Regular/Oswald_400Regular.ttf";

  async function build(subsets: ResolvedConfig["fonts"]["subsets"]): Promise<string> {
    const tmpDir = join(tmpdir(), `forge-pipeline-fonts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public", "assets");
    mkdirSync(publicDir, { recursive: true });
    await buildAll(
      {
        root: tmpDir,
        paths: { sourceDir: tmpDir, publicDir, publicPrefix: "/assets" },
        css: [],
        js: { bundles: [] },
        copy: [],
        rasters: [],
        sprites: {},
        fonts: { downloads: [], subsets, emit: null },
        marks: [],
        icons: null,
        cursors: null,
        site: null,
      },
      { minify: false, assetsPath: join(tmpDir, ".forge", "assets.ts") },
    );
    return publicDir;
  }

  it("writes the subset face and packs.json when a subset is configured", async () => {
    const publicDir = await build([
      { family: "Oswald", from: SOURCE, to: "fonts/oswald-400.ttf", covering: "Declaration of interest", weight: 400 },
    ]);
    try {
      expect(existsSync(join(publicDir, "fonts", "oswald-400.ttf"))).toBe(true);
      const packs = join(publicDir, "fonts", "packs.json");
      expect(existsSync(packs)).toBe(true);
      expect(readFileSync(packs, "utf-8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(join(publicDir, "..", ".."), { recursive: true, force: true });
    }
  });

  it("writes neither when no subset is configured, so the stage is the guard it looks like", async () => {
    const publicDir = await build([]);
    try {
      expect(existsSync(join(publicDir, "fonts", "packs.json"))).toBe(false);
    } finally {
      rmSync(join(publicDir, "..", ".."), { recursive: true, force: true });
    }
  });

  // The join, with no hand-written fixture on the path: what the build wrote is what the engine reads.
  it("produces a packs.json the engine resolves a face from", async () => {
    const publicDir = await build([
      { family: "Oswald", from: SOURCE, to: "fonts/oswald-400.ttf", covering: "Declaration", weight: 400 },
      { family: "Oswald", from: SOURCE, to: "fonts/oswald-700.ttf", covering: "Declaration", weight: 700 },
    ]);
    try {
      const written = JSON.parse(readFileSync(join(publicDir, "fonts", "packs.json"), "utf-8")) as PdfFontPackData[];
      const set = createPdfFontSet(written.map((pack) => readPdfFontPack(pack, (path) => new Uint8Array(readFileSync(join(publicDir, path))))));
      expect(set.families).toEqual(["Oswald"]);
      const bold = set.match({ family: "Oswald", weight: 700 });
      expect(bold.ok).toBe(true);
      if (!bold.ok) return;
      expect(bold.data.weight).toBe(700);
      expect(bold.data.metrics.advances.get("D".codePointAt(0) ?? 0)).toBeGreaterThan(0);
      expect(bold.data.sfnt?.length).toBeGreaterThan(0);
    } finally {
      rmSync(join(publicDir, "..", ".."), { recursive: true, force: true });
    }
  });
});

describe("buildAll() / generateAssetsTypes() — the emitted faces module", () => {
  const REGULAR = "node_modules/@expo-google-fonts/oswald/400Regular/Oswald_400Regular.ttf";
  const BOLD = "node_modules/@expo-google-fonts/oswald/700Bold/Oswald_700Bold.ttf";

  function configOf(root: string): ResolvedConfig {
    return {
      root,
      paths: { sourceDir: root, publicDir: join(root, "public", "assets"), publicPrefix: "/assets" },
      css: [],
      js: { bundles: [] },
      copy: [],
      rasters: [],
      sprites: {},
      fonts: {
        downloads: [],
        subsets: [
          { family: "Oswald", from: REGULAR, to: "fonts/oswald-400.ttf", covering: "Declaration", weight: 400 },
          { family: "Oswald", from: BOLD, to: "fonts/oswald-700.ttf", covering: "Declaration", weight: 700 },
        ],
        emit: {
          to: ".forge/faces.ts",
          faces: { Oswald: { "400": "oswald", "700": "oswald-bold" } },
          defaults: { regular: "oswald", bold: "oswald-bold" },
        },
      },
      marks: [],
      icons: null,
      cursors: null,
      site: null,
    };
  }

  function tmpRoot(): string {
    const root = join(tmpdir(), `forge-pipeline-faces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, "public", "assets"), { recursive: true });
    return root;
  }

  // A face has no content hash to blank and no dependency on the built tree, so `gen types` emits
  // the real module rather than a placeholder — which is what lets a clean checkout test against it.
  it("emits byte-identical modules from a build and from `gen types`", async () => {
    const built = tmpRoot();
    const typed = tmpRoot();
    try {
      await buildAll(configOf(built), { minify: false, assetsPath: join(built, ".forge", "assets.ts") });
      await generateAssetsTypes(configOf(typed), { assetsPath: join(typed, ".forge", "assets.ts") });

      const fromBuild = readFileSync(join(built, ".forge", "faces.ts"), "utf-8");
      expect(readFileSync(join(typed, ".forge", "faces.ts"), "utf-8")).toBe(fromBuild);
      expect(fromBuild).toContain(`postScriptName: "Oswald-Bold",`);
      expect(fromBuild).toContain(`export const DEFAULT_FACES: PdfDefaultFaces`);
    } finally {
      rmSync(built, { recursive: true, force: true });
      rmSync(typed, { recursive: true, force: true });
    }
  });

  it("writes no faces module when the config emits none", async () => {
    const root = tmpRoot();
    const config = configOf(root);
    try {
      await buildAll({ ...config, fonts: { ...config.fonts, emit: null } }, { minify: false, assetsPath: join(root, ".forge", "assets.ts") });
      expect(existsSync(join(root, ".forge", "faces.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
