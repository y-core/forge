import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NONCE } from "../../security/nonce";
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

  it("keeps a bundle's precache scope through v.parse, each of false, shell and all", () => {
    const parsed = v.parse(AssetsConfigSchema, {
      js: {
        bundles: [
          { entry: "src/admin.ts", outdir: "js", precache: false },
          { entry: "src/main.ts", outdir: "js", precache: "shell" },
          { entry: "src/app.ts", outdir: "js", precache: "all" },
        ],
      },
    });
    expect(parsed.js?.bundles?.map((bundle) => bundle.precache)).toEqual([false, "shell", "all"]);
  });

  const notScopes: unknown[] = [true, "false", "lazy", 0, null];
  for (const precache of notScopes) {
    it(`rejects a bundle whose precache is ${JSON.stringify(precache)}`, () => {
      expect(() => v.parse(AssetsConfigSchema, { js: { bundles: [{ entry: "src/main.ts", outdir: "js", precache }] } })).toThrow();
    });
  }

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

  it("carries a bundle's precache: false through to the resolved bundle", async () => {
    const config = await loadConfig({
      root: appRoot('export default { js: { bundles: [{ entry: "src/admin.ts", outdir: "js", precache: false }] } };'),
    });

    expect(config.js.bundles).toEqual([{ entry: join(config.root, "src", "admin.ts"), outdir: "js", precache: false }]);
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

  it("carries the app's securityHeaders through whole, NONCE symbol included, and defaults them to forge's", async () => {
    const root = appRoot(
      `import { NONCE } from "${join(import.meta.dir, "..", "..", "security", "mod.ts")}";
       export default { securityHeaders: { scriptSrc: ["'self'", NONCE], hsts: false } };`,
    );
    const config = await loadConfig({ root });
    const bare = await loadConfig({ root: appRoot("export default {};") });

    expect(config.securityHeaders).toEqual({ scriptSrc: ["'self'", NONCE], hsts: false });
    expect(bare.securityHeaders).toEqual({});
  });

  const iconsUnder = (prefix: string, assetsPrefix = "/assets") =>
    appRoot(
      `export default { paths: { publicPrefix: ${JSON.stringify(assetsPrefix)} }, icons: { src: "icon.svg", outDir: "public", publicPrefix: ${JSON.stringify(prefix)}, lightColor: "#000", outputs: [{ kind: "ico", file: "favicon.ico", sizes: [16], root: true }, { kind: "svg", file: "favicon.svg" }] } };`,
    );

  it("refuses an icon prefix equal to or inside the asset prefix, naming both", async () => {
    await expect(loadConfig({ root: iconsUnder("/assets/icons") })).rejects.toThrow(
      '[forge-assets] icon "/assets/icons/favicon.svg" (icons.publicPrefix "/assets/icons") is inside paths.publicPrefix "/assets" — move the icons out of the asset prefix',
    );
    await expect(loadConfig({ root: iconsUnder("assets/") })).rejects.toThrow(
      'icon "/assets/favicon.svg" (icons.publicPrefix "assets/") is inside paths.publicPrefix "/assets"',
    );
  });

  it('refuses a root icon output when the asset prefix is "/", whose rule covers every path', async () => {
    await expect(loadConfig({ root: iconsUnder("/static", "/") })).rejects.toThrow(
      'icon "/favicon.ico" (icons.publicPrefix "/static") is inside paths.publicPrefix "/"',
    );
  });

  it("accepts an icon prefix beside the asset prefix, one sharing its name, and a root icon output under a non-root asset prefix", async () => {
    for (const prefix of ["/static", "/assets-icons", "/"]) {
      const config = await loadConfig({ root: iconsUnder(prefix) });
      expect(config.icons?.publicPrefix).toBe(prefix);
    }
  });

  it("refuses a securityHeaders that is not an options object", async () => {
    const root = appRoot('export default { securityHeaders: "strict" };');
    await expect(loadConfig({ root })).rejects.toThrow("securityHeaders must be the SecurityHeadersOptions the app passes its middleware");
  });

  it("resolves the service-worker entry and its defines, and answers null when none is declared", async () => {
    const root = appRoot(
      `import { env } from "${join(import.meta.dir, "config.ts")}";
       export default { js: { serviceWorker: { entry: "src/client/sw.ts", conditions: ["worker"], define: { VERSION: env("VERSION") } } } };`,
    );
    const config = await loadConfig({ root, env: { VERSION: "v7" } });
    const bare = await loadConfig({ root: appRoot("export default {};") });

    expect(config.js.serviceWorker).toEqual({ entry: join(root, "src", "client", "sw.ts"), conditions: ["worker"], define: { VERSION: '"v7"' } });
    expect(bare.js.serviceWorker).toBeNull();
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
        marks: [{ from: "brand/logo.svg", to: "marks/letterhead.json" }],
      };`,
    );
    const config = await loadConfig({ root });

    expect(config.css[0]?.output).toBe("css/main.css");
    expect(config.js.bundles[0]?.outdir).toBe("js");
    expect(config.copy[0]?.to).toBe("css/lib.css");
    expect(config.rasters[0]?.to).toBe("img/logo.png");
    expect(config.sprites.ui?.target).toBe("sprites/ui.svg");
    expect(config.fonts.downloads[0]?.to).toBe("fonts/f.woff2");
    expect(config.marks[0]).toEqual({ from: "brand/logo.svg", to: "marks/letterhead.json" });
  });
});
