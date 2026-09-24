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

describe("buildJS() never cleans the asset root", () => {
  it("refuses an outdir that resolves to the asset root, before it removes anything", async () => {
    const tmpDir = join(tmpdir(), "forge-js-root-outdir");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");
    // A sibling group's output, sitting where an unscoped clean of the root would find it.
    writeFileSync(join(publicDir, "styles.css"), "body{}");

    try {
      await expect(buildJS([{ entry: join(srcDir, "main.ts"), outdir: "." }], { outDir: publicDir })).rejects.toThrow(/resolves to the asset root/);
      expect(existsSync(join(publicDir, "styles.css"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses an empty outdir for the same reason", async () => {
    const tmpDir = join(tmpdir(), "forge-js-empty-outdir");
    const srcDir = join(tmpDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");

    try {
      await expect(buildJS([{ entry: join(srcDir, "main.ts"), outdir: "" }], { outDir: join(tmpDir, "public") })).rejects.toThrow(
        /resolves to the asset root/,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // The clean is scoped to the group's own stems, so an unrelated file a different producer wrote
  // into the same directory survives a rebuild.
  it("leaves a file it did not write in the outdir alone", async () => {
    const tmpDir = join(tmpdir(), "forge-js-scoped-clean");
    const srcDir = join(tmpDir, "src");
    const publicDir = join(tmpDir, "public");
    const outdir = join(publicDir, "js");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(outdir, { recursive: true });
    writeFileSync(join(srcDir, "main.ts"), "export const x = 1;");
    writeFileSync(join(outdir, "vendor.js"), "// written by something else");
    writeFileSync(join(outdir, "main-STALE1.js"), "// a previous hashed build of this very entry");

    try {
      await buildJS([{ entry: join(srcDir, "main.ts"), outdir: "js" }], { outDir: publicDir, hash: true });

      expect(existsSync(join(outdir, "vendor.js"))).toBe(true);
      expect(existsSync(join(outdir, "main-STALE1.js"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
