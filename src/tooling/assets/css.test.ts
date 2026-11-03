import { describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpawnOptions, SpawnOutcome } from "../cli/types";
import { buildCSS } from "./css";

const CSS_BUILD = { tool: "tailwindcss", input: "src/app.css", output: "css/app.css" } as const;

function stubTailwind(content = "/* built css */") {
  return mock((_cmd: string, args: string[], _opts: SpawnOptions): SpawnOutcome => {
    const out = args.indexOf("-o");
    if (out !== -1) writeFileSync(args[out + 1] as string, content);
    return { status: 0 };
  });
}

describe("buildCSS()", () => {
  it("invokes tailwindcss and writes the output file (no hashing)", () => {
    const tmpDir = join(tmpdir(), `forge-css-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const spawn = stubTailwind();
    try {
      const manifest = buildCSS(CSS_BUILD, { outDir: tmpDir }, spawn);

      expect(existsSync(join(tmpDir, "css", "app.css"))).toBe(true);
      expect(manifest).toEqual({ "css/app.css": "css/app.css" });
      expect(spawn.mock.calls.map(([cmd, args]) => [cmd, args[0]])).toEqual([
        ["tailwindcss", "--help"],
        ["tailwindcss", "-i"],
      ]);
      const [cmd, args] = spawn.mock.calls[1]!;
      expect(cmd).toBe("tailwindcss");
      expect(args).toEqual(["-i", "src/app.css", "-o", join(tmpDir, "css", "app.css")]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes --minify when minify is enabled", () => {
    const tmpDir = join(tmpdir(), `forge-css-min-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const spawn = stubTailwind();
    try {
      buildCSS(CSS_BUILD, { outDir: tmpDir, minify: true }, spawn);
      const args = spawn.mock.calls[1]![1] as string[];
      expect(args).toEqual(["-i", "src/app.css", "-o", join(tmpDir, "css", "app.css"), "--minify"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("renames output to a content-hashed filename when hash is enabled", () => {
    const tmpDir = join(tmpdir(), `forge-css-hash-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const spawn = stubTailwind("body{color:red}");
    try {
      const manifest = buildCSS(CSS_BUILD, { outDir: tmpDir, hash: true }, spawn);

      const hashed = manifest["css/app.css"]!;
      expect(hashed).toMatch(/^css\/app\.[0-9a-f]{8}\.css$/);
      expect(existsSync(join(tmpDir, hashed))).toBe(true);
      expect(existsSync(join(tmpDir, "css", "app.css"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("purges this entry's own stale .css files before rebuilding", () => {
    const tmpDir = join(tmpdir(), `forge-css-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "css");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "app.oldhash.css"), "stale");
    writeFileSync(join(outDir, "keep.txt"), "not css");
    const spawn = stubTailwind();
    try {
      buildCSS(CSS_BUILD, { outDir: tmpDir }, spawn);

      const remaining = readdirSync(outDir).sort();
      expect(remaining).toEqual(["app.css", "keep.txt"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps a sibling entry's hashed output when both write into one directory", () => {
    const tmpDir = join(tmpdir(), `forge-css-two-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "css");
    mkdirSync(outDir, { recursive: true });
    const spawn = stubTailwind("body{color:red}");
    try {
      const app = buildCSS(CSS_BUILD, { outDir: tmpDir, hash: true }, spawn);
      const print = buildCSS({ tool: "tailwindcss", input: "src/print.css", output: "css/print.css" }, { outDir: tmpDir, hash: true }, spawn);

      const appHashed = app["css/app.css"]!;
      const printHashed = print["css/print.css"]!;
      expect(existsSync(join(tmpDir, appHashed))).toBe(true);
      expect(existsSync(join(tmpDir, printHashed))).toBe(true);
      expect(readdirSync(outDir).sort()).toEqual([appHashed, printHashed].map((p) => p.slice("css/".length)).sort());
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps a sibling entry's unhashed output when both write into one directory", () => {
    const tmpDir = join(tmpdir(), `forge-css-two-plain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "css");
    mkdirSync(outDir, { recursive: true });
    const spawn = stubTailwind();
    try {
      buildCSS(CSS_BUILD, { outDir: tmpDir }, spawn);
      buildCSS({ tool: "tailwindcss", input: "src/print.css", output: "css/print.css" }, { outDir: tmpDir }, spawn);

      expect(readdirSync(outDir).sort()).toEqual(["app.css", "print.css"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("leaves a dotfile in the output directory untouched", () => {
    const tmpDir = join(tmpdir(), `forge-css-dot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const outDir = join(tmpDir, "css");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, ".keep.css"), "hidden");
    const spawn = stubTailwind();
    try {
      buildCSS(CSS_BUILD, { outDir: tmpDir }, spawn);

      expect(readdirSync(outDir).sort()).toEqual([".keep.css", "app.css"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses before building when no tailwindcss binary runs, naming the css entry and @tailwindcss/cli", () => {
    const spawn = mock((_cmd: string, _args: string[], _opts: SpawnOptions): SpawnOutcome => ({
      status: null,
      error: new Error("spawnSync tailwindcss ENOENT"),
    }));
    const error = (() => {
      try {
        buildCSS(CSS_BUILD, { outDir: join(tmpdir(), "forge-css-never-written") }, spawn);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();

    expect(error).toMatchObject({
      kind: "external",
      message:
        '[forge-assets] css entry src/app.css asks for a stylesheet, which needs the `tailwindcss` binary the optional peer "@tailwindcss/cli" ships. Install it: bun add -d @tailwindcss/cli tailwindcss',
    });
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([["--help"]]);
    expect(existsSync(join(tmpdir(), "forge-css-never-written"))).toBe(false);
  });
});
