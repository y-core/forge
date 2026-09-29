import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function writeConditionalProject(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-js-conditions-"));
  const pkgDir = join(root, "node_modules", "pkg");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "pkg", exports: { ".": { worker: "./worker.js", browser: "./browser.js" } } }),
  );
  writeFileSync(join(pkgDir, "worker.js"), 'export const marker = "WORKER_ENTRY";');
  writeFileSync(join(pkgDir, "browser.js"), 'export const marker = "BROWSER_ENTRY";');
  for (const name of ["sw", "app"]) {
    writeFileSync(join(root, "src", `${name}.ts`), 'import { marker } from "pkg";\nconsole.log(marker);');
  }
  return root;
}

describe("buildJS() export conditions", () => {
  it("selects a package's worker export for a bundle declaring the worker condition", async () => {
    const root = writeConditionalProject();
    const publicDir = join(root, "public");
    try {
      const mapping = await buildJS([{ entry: join(root, "src", "sw.ts"), outdir: "js", conditions: ["worker"] }], { outDir: publicDir });
      const output = readFileSync(join(publicDir, mapping["js/sw.js"]!), "utf-8");
      expect(output).toContain("WORKER_ENTRY");
      expect(output).not.toContain("BROWSER_ENTRY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the default browser export for a bundle declaring no conditions", async () => {
    const root = writeConditionalProject();
    const publicDir = join(root, "public");
    try {
      const mapping = await buildJS([{ entry: join(root, "src", "app.ts"), outdir: "js" }], { outDir: publicDir });
      const output = readFileSync(join(publicDir, mapping["js/app.js"]!), "utf-8");
      expect(output).toContain("BROWSER_ENTRY");
      expect(output).not.toContain("WORKER_ENTRY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds two bundles differing only in conditions separately, each resolving its own export", async () => {
    const root = writeConditionalProject();
    const publicDir = join(root, "public");
    try {
      const mapping = await buildJS(
        [
          { entry: join(root, "src", "sw.ts"), outdir: "js", conditions: ["worker"] },
          { entry: join(root, "src", "app.ts"), outdir: "js" },
        ],
        { outDir: publicDir },
      );
      const sw = readFileSync(join(publicDir, mapping["js/sw.js"]!), "utf-8");
      const app = readFileSync(join(publicDir, mapping["js/app.js"]!), "utf-8");
      expect(sw).toContain("WORKER_ENTRY");
      expect(sw).not.toContain("BROWSER_ENTRY");
      expect(app).toContain("BROWSER_ENTRY");
      expect(app).not.toContain("WORKER_ENTRY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets one bundle override the build-wide minify, so one build emits a minified and an unminified bundle", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-js-minify-"));
    const publicDir = join(root, "public");
    const source = "export function greet(longParameterName: string) { return longParameterName + '!'; }";
    writeFileSync(join(root, "minified.ts"), source);
    writeFileSync(join(root, "readable.ts"), source);
    try {
      const mapping = await buildJS(
        [
          { entry: join(root, "minified.ts"), outdir: "js" },
          { entry: join(root, "readable.ts"), outdir: "js", minify: false },
        ],
        { outDir: publicDir, minify: true },
      );
      expect(readFileSync(join(publicDir, mapping["js/minified.js"]!), "utf-8")).not.toContain("longParameterName");
      expect(readFileSync(join(publicDir, mapping["js/readable.js"]!), "utf-8")).toContain("longParameterName");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets one bundle opt into minify when the build-wide minify is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-js-minify-optin-"));
    const publicDir = join(root, "public");
    const source = "export function greet(longParameterName: string) { return longParameterName + '!'; }";
    writeFileSync(join(root, "minified.ts"), source);
    writeFileSync(join(root, "readable.ts"), source);
    try {
      const mapping = await buildJS(
        [
          { entry: join(root, "readable.ts"), outdir: "js" },
          { entry: join(root, "minified.ts"), outdir: "js", minify: true },
        ],
        { outDir: publicDir, minify: false },
      );
      expect(readFileSync(join(publicDir, mapping["js/minified.js"]!), "utf-8")).not.toContain("longParameterName");
      expect(readFileSync(join(publicDir, mapping["js/readable.js"]!), "utf-8")).toContain("longParameterName");
      expect(mapping["js/minified.js"]).toBe("js/minified.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
