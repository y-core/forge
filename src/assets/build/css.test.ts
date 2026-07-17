import { describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCSS } from "./css";

const CSS_BUILD = { tool: "tailwindcss", input: "src/app.css", output: "css/app.css" } as const;

// Stubs `execFileSync("tailwindcss", …)` so no real Tailwind binary is invoked;
// the stub writes deterministic CSS to the `-o` output path so downstream FS
// steps (hash / rename / return mapping) have a real file to operate on.
function stubTailwind(content = "/* built css */") {
  const spy = spyOn(childProcess, "execFileSync").mockImplementation(((_cmd: string, args: string[]) => {
    const outPath = args[args.indexOf("-o") + 1] as string;
    writeFileSync(outPath, content);
    return new Uint8Array();
  }) as never);
  // A sibling test (`pkg/git.test.ts`) installs a persistent `mock.module("node:child_process")`
  // that Bun does not auto-restore, so the spied `execFileSync` may carry prior call history when
  // that file runs first. Clear it so this test only counts its own calls.
  spy.mockClear();
  return spy;
}

describe("buildCSS()", () => {
  it("invokes tailwindcss and writes the output file (no hashing)", () => {
    const tmpDir = join(tmpdir(), `forge-css-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const execSpy = stubTailwind();
    try {
      const manifest = buildCSS(CSS_BUILD, { outDir: tmpDir });

      expect(existsSync(join(tmpDir, "css", "app.css"))).toBe(true);
      expect(manifest).toEqual({ "css/app.css": "css/app.css" });
      expect(execSpy).toHaveBeenCalledTimes(1);
      const [cmd, args] = execSpy.mock.calls[0]!;
      expect(cmd).toBe("tailwindcss");
      expect(args).toEqual(["-i", "src/app.css", "-o", join(tmpDir, "css", "app.css")]);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes --minify when minify is enabled", () => {
    const tmpDir = join(tmpdir(), `forge-css-min-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const execSpy = stubTailwind();
    try {
      buildCSS(CSS_BUILD, { outDir: tmpDir, minify: true });
      const args = execSpy.mock.calls[0]![1] as string[];
      expect(args).toEqual(["-i", "src/app.css", "-o", join(tmpDir, "css", "app.css"), "--minify"]);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("renames output to a content-hashed filename when hash is enabled", () => {
    const tmpDir = join(tmpdir(), `forge-css-hash-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const execSpy = stubTailwind("body{color:red}");
    try {
      const manifest = buildCSS(CSS_BUILD, { outDir: tmpDir, hash: true });

      const hashed = manifest["css/app.css"]!;
      expect(hashed).toMatch(/^css\/app\.[0-9a-f]{8}\.css$/);
      expect(existsSync(join(tmpDir, hashed))).toBe(true);
      // The un-hashed output must have been renamed away.
      expect(existsSync(join(tmpDir, "css", "app.css"))).toBe(false);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("purges stale .css files in the output directory before rebuilding", () => {
    const tmpDir = join(tmpdir(), `forge-css-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "css");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "app.oldhash.css"), "stale");
    writeFileSync(join(outDir, "keep.txt"), "not css");
    const execSpy = stubTailwind();
    try {
      buildCSS(CSS_BUILD, { outDir: tmpDir });

      const remaining = readdirSync(outDir).sort();
      // Stale hashed CSS removed; the freshly built app.css and the non-css file remain.
      expect(remaining).toEqual(["app.css", "keep.txt"]);
    } finally {
      execSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
