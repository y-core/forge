import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAll } from "./pipeline";

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
