import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
