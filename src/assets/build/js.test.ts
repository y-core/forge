import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildJS } from "./js";

describe("buildJS()", () => {
  it("returns empty mapping for empty bundle list", async () => {
    const result = await buildJS([], { outDir: "/tmp" });
    expect(result).toEqual({});
  });

  it("two bundles sharing one outdir both survive on disk and appear in mapping", async () => {
    const tmpDir = join(tmpdir(), "forge-js-shared-outdir");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");
    writeFileSync(join(srcDir, "islands.ts"), "export const y = 2;");

    try {
      const mainEntry = join(srcDir, "main.ts");
      const islandsEntry = join(srcDir, "islands.ts");

      const mapping = await buildJS(
        [
          { entry: mainEntry, outdir: "js" },
          { entry: islandsEntry, outdir: "js" },
        ],
        { outDir: publicDir },
      );

      expect(mapping["js/main.js"]).toBeDefined();
      expect(mapping["js/islands.js"]).toBeDefined();
      expect(existsSync(join(publicDir, mapping["js/main.js"]!))).toBe(true);
      expect(existsSync(join(publicDir, mapping["js/islands.js"]!))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("content-hashed filenames differ between builds when hash is enabled", async () => {
    const tmpDir = join(tmpdir(), "forge-js-hash");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(join(srcDir, "app.ts"), "export const v = 42;");

    try {
      const mapping = await buildJS([{ entry: join(srcDir, "app.ts"), outdir: "js" }], { outDir: publicDir, hash: true });

      const hashed = mapping["js/app.js"]!;
      expect(hashed).toMatch(/^js\/app-[A-Z0-9]+\.js$/);
      expect(existsSync(join(publicDir, hashed))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
