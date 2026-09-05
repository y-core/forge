import { describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSprites } from "./sprites";

describe("buildSprites()", () => {
  it("caches remote SVGs and skips fetch on second build", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`, { status: 200 }),
    );
    try {
      const sprites = { icons: { target: "svg/sprite.svg", sources: [{ path: "https://example.com/icons/", files: ["arrow.svg"] }] } };

      await buildSprites(sprites, tmpDir);

      const cacheFile = join(tmpDir, "svg", ".svg-cache", "arrow.svg");
      expect(existsSync(cacheFile)).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await buildSprites(sprites, tmpDir);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips write when no symbols are produced", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const emptySourceDir = join(tmpDir, "svg-src");
      const spriteOut = join(tmpDir, "svg", "sprite.svg");
      await buildSprites({ icons: { target: "svg/sprite.svg", sources: [{ path: emptySourceDir, files: ["icon.svg"] }] } }, tmpDir);
      const spriteExists = existsSync(spriteOut);
      expect(spriteExists).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns groups keyed by config key with correct spriteKey and meta for two groups", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-twogroup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const svgA = `<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`;
    const svgB = `<svg viewBox="0 0 32 32"><circle r="16"/></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(svgA, { status: 200 }))
      .mockResolvedValueOnce(new Response(svgB, { status: 200 }));
    try {
      const sprites = {
        core: { target: "svg/sprite.svg", sources: [{ path: "https://example.com/a/", files: ["a.svg"] }] },
        "brand-icons": { target: "svg/brand.svg", sources: [{ path: "https://example.com/b/", files: ["b.svg"] }] },
      };
      const result = await buildSprites(sprites, tmpDir);
      expect(Object.keys(result.groups)).toEqual(["core", "brand-icons"]);
      expect(result.groups.core!.spriteKey).toBe("svg/sprite.svg");
      expect(result.groups["brand-icons"]!.spriteKey).toBe("svg/brand.svg");
      expect(result.groups.core!.meta["icon-a"]).toBe("0 0 24 24");
      expect(result.groups["brand-icons"]!.meta["icon-b"]).toBe("0 0 32 32");
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("{ key, file } entry uses key as symbol id, not filename stem", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-keyfile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const svg = `<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(svg, { status: 200 }));
    try {
      const sprites = {
        icons: { target: "svg/sprite.svg", sources: [{ path: "https://example.com/", files: [{ key: "mouse-pointer-2", file: "select.svg" }] }] },
      };
      const result = await buildSprites(sprites, tmpDir);
      expect(result.groups.icons!.meta["icon-mouse-pointer-2"]).toBe("0 0 24 24");
      expect(result.groups.icons!.meta["icon-select"]).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("custom prefix is used for symbol ids and stored in SpriteGroupResult", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-prefix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const svg = `<svg viewBox="0 0 32 32"><path d="M0 0"/></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(svg, { status: 200 }));
    try {
      const sprites = {
        cursors: { target: "svg/cursors.svg", prefix: "cursor-", sources: [{ path: "https://example.com/", files: ["orbit.svg"] }] },
      };
      const result = await buildSprites(sprites, tmpDir);
      expect(result.groups.cursors!.prefix).toBe("cursor-");
      expect(result.groups.cursors!.meta["cursor-orbit"]).toBe("0 0 32 32");
      expect(result.groups.cursors!.meta["icon-orbit"]).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("sibling groups sharing an output directory both survive (coexistence)", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-sibling-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const srcDir = join(tmpDir, "svg-src");
    mkdirSync(srcDir, { recursive: true });
    const svgContent = `<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`;
    writeFileSync(join(srcDir, "arrow.svg"), svgContent);
    writeFileSync(join(srcDir, "orbit.svg"), svgContent);
    try {
      const sprites = {
        icons: { target: "sprite/icons.svg", sources: [{ path: srcDir, files: ["arrow.svg"] }] },
        cursors: { target: "sprite/cursors.svg", sources: [{ path: srcDir, files: ["orbit.svg"] }] },
      };
      await buildSprites(sprites, tmpDir);
      expect(existsSync(join(tmpDir, "sprite", "icons.svg"))).toBe(true);
      expect(existsSync(join(tmpDir, "sprite", "cursors.svg"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("last-wins dedup: later source with same key overrides earlier symbol", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-dedup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const svgFirst = `<svg viewBox="0 0 24 24"><circle r="12"/></svg>`;
    const svgLast = `<svg viewBox="0 0 32 32"><path d="M0 0"/></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(svgFirst, { status: 200 }))
      .mockResolvedValueOnce(new Response(svgLast, { status: 200 }));
    try {
      const sprites = {
        icons: {
          target: "svg/sprite.svg",
          sources: [
            { path: "https://example.com/base/", files: [{ key: "select", file: "a.svg" }] },
            { path: "https://example.com/override/", files: [{ key: "select", file: "b.svg" }] },
          ],
        },
      };
      const result = await buildSprites(sprites, tmpDir);
      expect(result.groups.icons!.meta["icon-select"]).toBe("0 0 32 32");
      const { readFileSync: readFile } = await import("node:fs");
      const spriteContent = readFile(join(tmpDir, "svg", "sprite.svg"), "utf-8");
      const matches = [...spriteContent.matchAll(/id="icon-select"/g)];
      expect(matches).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
