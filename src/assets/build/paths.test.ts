import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAssets } from "./copy";
import { buildFonts } from "./fonts";
import { safeJoin } from "./paths";
import { buildSprites } from "./sprites";

describe("safeJoin()", () => {
  it("returns the resolved path for in-root inputs", () => {
    expect(safeJoin("/public", "assets/main.css")).toBe("/public/assets/main.css");
  });

  it("returns the base itself when called with no segments", () => {
    expect(safeJoin("/public")).toBe("/public");
  });

  it("throws for a single '..' segment", () => {
    expect(() => safeJoin("/public", "..")).toThrow("[forge-assets]");
  });

  it("throws for a relative traversal escaping the root", () => {
    expect(() => safeJoin("/public", "../escaped.txt")).toThrow("[forge-assets]");
  });

  it("throws for nested traversal escaping the root", () => {
    expect(() => safeJoin("/public", "a/../../b")).toThrow("[forge-assets]");
  });

  it("throws for an absolute path segment that would escape the root", () => {
    expect(() => safeJoin("/public", "/etc/passwd")).toThrow("[forge-assets]");
  });

  it("allows deep nested paths that stay inside the root", () => {
    expect(safeJoin("/public", "a/b/c/d.js")).toBe("/public/a/b/c/d.js");
  });
});

describe("copyAssets() path containment", () => {
  it("throws when destination escapes the public directory", () => {
    const tmpDir = join(tmpdir(), `forge-copy-traversal-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      expect(() => copyAssets([{ from: tmpDir, to: "../escaped.txt" }], tmpDir)).toThrow("[forge-assets]");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildSprites() path containment", () => {
  it("throws when sprite target escapes the public directory", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-traversal-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      await expect(buildSprites({ icons: { target: "../escaped.svg", sources: [] } }, tmpDir)).rejects.toThrow("[forge-assets]");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildFonts() path containment", () => {
  it("throws when font download destination escapes the public directory", async () => {
    const tmpDir = join(tmpdir(), `forge-font-traversal-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      await expect(buildFonts({ downloads: [{ url: "https://example.com/font.woff2", to: "../f.woff2" }] }, tmpDir)).rejects.toThrow(
        "[forge-assets]",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
