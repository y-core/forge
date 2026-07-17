import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAssets } from "./copy";

describe("copyAssets()", () => {
  it("copies a source file to the resolved destination under publicDir", () => {
    const tmpDir = join(tmpdir(), `forge-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const from = join(tmpDir, "logo.svg");
      writeFileSync(from, "<svg>logo</svg>");

      copyAssets([{ from, to: "img/logo.svg" }], publicDir);

      const dest = join(publicDir, "img", "logo.svg");
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf-8")).toBe("<svg>logo</svg>");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates missing intermediate destination directories", () => {
    const tmpDir = join(tmpdir(), `forge-copy-nested-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const from = join(tmpDir, "font.woff2");
      writeFileSync(from, "FONTDATA");

      copyAssets([{ from, to: "assets/fonts/font.woff2" }], publicDir);

      const dest = join(publicDir, "assets", "fonts", "font.woff2");
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf-8")).toBe("FONTDATA");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("copies multiple entries", () => {
    const tmpDir = join(tmpdir(), `forge-copy-multi-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    try {
      const a = join(tmpDir, "a.txt");
      const b = join(tmpDir, "b.txt");
      writeFileSync(a, "AAA");
      writeFileSync(b, "BBB");

      copyAssets(
        [
          { from: a, to: "a.txt" },
          { from: b, to: "nested/b.txt" },
        ],
        publicDir,
      );

      expect(readFileSync(join(publicDir, "a.txt"), "utf-8")).toBe("AAA");
      expect(readFileSync(join(publicDir, "nested", "b.txt"), "utf-8")).toBe("BBB");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when the destination escapes publicDir (safeJoin guard)", () => {
    const tmpDir = join(tmpdir(), `forge-copy-escape-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    try {
      const from = join(tmpDir, "secret.txt");
      writeFileSync(from, "SECRET");

      expect(() => copyAssets([{ from, to: "../escape.txt" }], publicDir)).toThrow(/escapes the asset root/);
      expect(existsSync(join(tmpDir, "escape.txt"))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does nothing for an empty copy list", () => {
    const tmpDir = join(tmpdir(), `forge-copy-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const publicDir = join(tmpDir, "public");
    mkdirSync(tmpDir, { recursive: true });
    try {
      copyAssets([], publicDir);
      expect(existsSync(publicDir)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
