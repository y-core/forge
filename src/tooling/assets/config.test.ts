import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { v } from "../../validation/mod";
import { defineAssetsConfig, loadConfig } from "./config";
import type { AssetsConfig } from "./types";
import { AssetsConfigSchema } from "./types";

describe("defineAssetsConfig()", () => {
  it("returns config as-is (identity function)", () => {
    const config: AssetsConfig = { css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }] };
    expect(defineAssetsConfig(config)).toBe(config);
  });

  it("accepts minimal empty config", () => {
    const config: AssetsConfig = {};
    expect(defineAssetsConfig(config)).toBe(config);
  });

  it("accepts full config shape", () => {
    const config: AssetsConfig = {
      paths: { publicDir: "public/assets", publicPrefix: "/assets" },
      css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }],
      js: { bundles: [{ entry: "src/client/main.ts", outdir: "js", format: "esm" }] },
      copy: [{ from: "vendor/lib.css", to: "css/lib.css" }],
    };
    expect(defineAssetsConfig(config)).toBe(config);
  });
});

describe("AssetsConfigSchema", () => {
  it("preserves bundle define containing a flag ref through v.parse (regression: valibot strip)", () => {
    const raw = { js: { bundles: [{ entry: "src/main.ts", outdir: "js", define: { __E2E__: { __flag: "E2E" } } }] } };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.js?.bundles?.[0]?.define?.__E2E__).toEqual({ __flag: "E2E" });
  });

  it("preserves bundle define containing an env ref through v.parse", () => {
    const raw = { js: { bundles: [{ entry: "src/main.ts", outdir: "js", define: { APP_VERSION: { __env: "VERSION" } } }] } };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.js?.bundles?.[0]?.define?.APP_VERSION).toEqual({ __env: "VERSION" });
  });

  it("preserves bundle define containing literal primitives through v.parse", () => {
    const raw = { js: { bundles: [{ entry: "src/main.ts", outdir: "js", define: { DEBUG: false, RETRIES: 3, NAME: "app" } }] } };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.js?.bundles?.[0]?.define?.DEBUG).toBe(false);
    expect(parsed.js?.bundles?.[0]?.define?.RETRIES).toBe(3);
    expect(parsed.js?.bundles?.[0]?.define?.NAME).toBe("app");
  });

  it("preserves per-source cursor templates through v.parse", () => {
    const raw = {
      cursors: {
        target: "css/cursors.css",
        themes: { light: ":root", dark: ".dark" },
        sources: [
          { path: "src/svg/cursors", files: ["select.svg"], template: { path: "src/svg", file: "template.svg" } },
          { path: "src/svg/snaps", files: ["snap.svg"], template: { path: "src/svg", file: "snap-template.svg" } },
        ],
      },
    };
    const parsed = v.parse(AssetsConfigSchema, raw);
    const sources = parsed.cursors?.sources;
    expect(sources?.[0]?.template).toEqual({ path: "src/svg", file: "template.svg" });
    expect(sources?.[1]?.template).toEqual({ path: "src/svg", file: "snap-template.svg" });
  });

  it("rejects a cursor source without a template", () => {
    const raw = {
      cursors: { target: "css/cursors.css", themes: { light: ":root" }, sources: [{ path: "src/svg/cursors", files: ["select.svg"] }] },
    };
    expect(() => v.parse(AssetsConfigSchema, raw)).toThrow();
  });

  it("rejects a raster entry with neither width nor height", () => {
    expect(() => v.parse(AssetsConfigSchema, { rasters: [{ from: "a.svg", to: "a.png" }] })).toThrow();
  });

  it("accepts a width-only raster entry", () => {
    const parsed = v.parse(AssetsConfigSchema, { rasters: [{ from: "a.svg", to: "a.png", width: 360 }] });
    expect(parsed.rasters?.[0]).toEqual({ from: "a.svg", to: "a.png", width: 360 });
  });

  it("preserves cursors vars (flat and per-theme) through v.parse", () => {
    const raw = {
      cursors: {
        target: "css/cursors.css",
        themes: { light: ":root", dark: ".dark" },
        sources: [{ path: "src/svg/cursors", files: ["select.svg"], template: { path: "src/svg", file: "template.svg" } }],
        vars: { "--cursor-shadow": "#000000", "--cursor-accent": { light: "#0000ff", dark: "#00ff00" } },
      },
    };
    const parsed = v.parse(AssetsConfigSchema, raw);
    expect(parsed.cursors?.vars?.["--cursor-shadow"]).toBe("#000000");
    expect(parsed.cursors?.vars?.["--cursor-accent"]).toEqual({ light: "#0000ff", dark: "#00ff00" });
  });
});

describe("loadConfig()", () => {
  const roots: string[] = [];

  function appRoot(source: string): string {
    const root = mkdtempSync(join(tmpdir(), "forge-assets-config-"));
    roots.push(root);
    writeFileSync(join(root, "assets.config.ts"), source, "utf-8");
    return root;
  }

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  // The root is a temp directory and the test runs from the repository, so an output path resolved
  // against the working directory would not land under it.
  it("defaults every path under the root rather than the working directory", async () => {
    const root = appRoot("export default {};");
    const config = await loadConfig({ root });

    expect(config.root).toBe(root);
    expect(config.paths.publicDir).toBe(join(root, "public", "assets"));
    expect(config.paths.sourceDir).toBe(join(root, "src", "static"));
  });

  it("resolves a stated output path against the root too, for the asset tree, the icons and the site", async () => {
    const root = appRoot(
      `export default { paths: { publicDir: "dist/assets" }, icons: { src: "brand/icon.svg", outDir: "dist/assets", lightColor: "#000", outputs: [] }, site: { outDir: "dist", config: { origin: "https://example.com", pages: ["/"], robots: { rules: [{ userAgent: "*" }] } } } };`,
    );
    const config = await loadConfig({ root });

    expect(config.paths.publicDir).toBe(join(root, "dist", "assets"));
    expect(config.icons?.outDir).toBe(join(root, "dist", "assets"));
    expect(config.icons?.src).toBe(join(root, "brand", "icon.svg"));
    expect(config.site?.outDir).toBe(join(root, "dist"));
  });

  it("resolves every read path against the root — css input, js entry, copy and raster sources", async () => {
    const root = appRoot(
      `export default {
        css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }],
        js: { bundles: [{ entry: "src/client/main.ts", outdir: "js" }] },
        copy: [{ from: "vendor/lib.css", to: "css/lib.css" }],
        rasters: [{ from: "brand/logo.svg", to: "img/logo.png", width: 360 }],
      };`,
    );
    const config = await loadConfig({ root });

    expect(config.css[0]?.input).toBe(join(root, "src", "styles", "main.css"));
    expect(config.js.bundles[0]?.entry).toBe(join(root, "src", "client", "main.ts"));
    expect(config.copy[0]?.from).toBe(join(root, "vendor", "lib.css"));
    expect(config.rasters[0]?.from).toBe(join(root, "brand", "logo.svg"));
  });

  it("resolves a bundle entry alongside its defines rather than instead of them", async () => {
    const root = appRoot(
      `import { flag } from "${join(import.meta.dir, "config.ts")}";
       export default { js: { bundles: [{ entry: "src/client/main.ts", outdir: "js", define: { __E2E__: flag("E2E") } }] } };`,
    );
    const config = await loadConfig({ root, env: { E2E: "true" } });

    expect(config.js.bundles[0]?.entry).toBe(join(root, "src", "client", "main.ts"));
    expect(config.js.bundles[0]?.define?.__E2E__).toBe("true");
  });

  it("resolves a local sprite source against the root and leaves a remote one verbatim", async () => {
    const root = appRoot(
      `export default {
        sprites: {
          local: { target: "sprites/ui.svg", sources: [{ path: "src/svg/ui", files: ["check.svg"] }] },
          remote: {
            target: "sprites/vendor.svg",
            sources: [{ path: "https://cdn.example.com/icons/", files: [{ key: "star", file: "star.svg", sha256: "${"0".repeat(64)}" }] }],
          },
        },
      };`,
    );
    const config = await loadConfig({ root });

    expect(config.sprites.local?.sources[0]?.path).toBe(join(root, "src", "svg", "ui"));
    expect(config.sprites.remote?.sources[0]?.path).toBe("https://cdn.example.com/icons/");
  });

  // `forgeUiSpriteSources()` returns paths inside the installed package, which no application root
  // contains — resolving one against the root would have to leave it alone to keep working.
  it("leaves an already-absolute sprite source path alone", async () => {
    const root = appRoot(
      `export default { sprites: { forge: { target: "sprites/ui.svg", sources: [{ path: "/opt/forge/ui/glyphs", files: ["check.svg"] }] } } };`,
    );
    const config = await loadConfig({ root });

    expect(config.sprites.forge?.sources[0]?.path).toBe("/opt/forge/ui/glyphs");
  });

  it("resolves a cursor source and its template against the root", async () => {
    const root = appRoot(
      `export default {
        cursors: {
          target: "css/cursors.css",
          themes: { light: ":root" },
          sources: [{ path: "src/svg/cursors", files: ["select.svg"], template: { path: "src/svg", file: "template.svg" } }],
        },
      };`,
    );
    const config = await loadConfig({ root });

    expect(config.cursors?.sources[0]?.path).toBe(join(root, "src", "svg", "cursors"));
    expect(config.cursors?.sources[0]?.template).toEqual({ path: join(root, "src", "svg"), file: "template.svg" });
  });

  // A written path is a manifest key that `safeJoin` contains under the asset root at build time, so
  // making it absolute here would both break the key and defeat the containment.
  it("leaves every written path relative", async () => {
    const root = appRoot(
      `export default {
        css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }],
        js: { bundles: [{ entry: "src/client/main.ts", outdir: "js" }] },
        copy: [{ from: "vendor/lib.css", to: "css/lib.css" }],
        rasters: [{ from: "brand/logo.svg", to: "img/logo.png", width: 360 }],
        sprites: { ui: { target: "sprites/ui.svg", sources: [{ path: "src/svg/ui", files: ["check.svg"] }] } },
        fonts: { downloads: [{ url: "https://cdn.example.com/f.woff2", to: "fonts/f.woff2", sha256: "${"0".repeat(64)}" }] },
      };`,
    );
    const config = await loadConfig({ root });

    expect(config.css[0]?.output).toBe("css/main.css");
    expect(config.js.bundles[0]?.outdir).toBe("js");
    expect(config.copy[0]?.to).toBe("css/lib.css");
    expect(config.rasters[0]?.to).toBe("img/logo.png");
    expect(config.sprites.ui?.target).toBe("sprites/ui.svg");
    expect(config.fonts.downloads[0]?.to).toBe("fonts/f.woff2");
  });
});
