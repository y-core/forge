import { describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSprites } from "./sprites";

/** The pin a caller would write into config for `content`. */
function pin(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Every file under `dir`, relative to it, so a test can assert on a whole tree at once. */
function walk(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

describe("buildSprites()", () => {
  it("caches remote SVGs outside publicDir and skips the fetch on a second build", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const cacheDir = join(tmpDir, "cache");
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    const svg = `<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(svg, { status: 200 }));
    try {
      const sprites = {
        icons: {
          target: "svg/sprite.svg",
          sources: [{ path: "https://example.com/icons/", files: [{ key: "arrow", file: "arrow.svg", sha256: pin(svg) }] }],
        },
      };

      await buildSprites(sprites, publicDir, { cacheDir });

      // The upstream bytes are unsanitized, so nothing under `publicDir` may hold them: `_headers`
      // serves that tree `immutable` for a year under a guessable URL.
      expect(walk(publicDir)).toEqual(["svg/sprite.svg"]);
      expect(walk(cacheDir)).toEqual([`${pin(svg)}.svg`]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await buildSprites(sprites, publicDir, { cacheDir });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(walk(publicDir)).toEqual(["svg/sprite.svg"]);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses a remote source entry that pins no digest", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-unpinned-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(`<svg viewBox="0 0 24 24"><path/></svg>`, { status: 200 }));
    try {
      const sprites = { icons: { target: "svg/sprite.svg", sources: [{ path: "https://example.com/icons/", files: ["arrow.svg"] }] } };
      await expect(buildSprites(sprites, tmpDir, { cacheDir: join(tmpDir, "cache") })).rejects.toThrow(/needs a sha256/);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails the build when an upstream SVG no longer matches its pin", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-tampered-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const expected = `<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>`, { status: 200 }),
    );
    try {
      const sprites = {
        icons: {
          target: "svg/sprite.svg",
          sources: [{ path: "https://example.com/icons/", files: [{ key: "arrow", file: "arrow.svg", sha256: pin(expected) }] }],
        },
      };
      await expect(buildSprites(sprites, tmpDir, { cacheDir: join(tmpDir, "cache") })).rejects.toThrow(/sha256 mismatch/);
      expect(existsSync(join(tmpDir, "svg", "sprite.svg"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // The generated name union comes from the config, so a source skipped here typechecks and renders
  // a blank `<use>` in production.
  it("refuses a missing source file rather than warning and building a sprite without it", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const emptySourceDir = join(tmpDir, "svg-src");
      const spriteOut = join(tmpDir, "svg", "sprite.svg");
      await expect(
        buildSprites({ icons: { target: "svg/sprite.svg", sources: [{ path: emptySourceDir, files: ["icon.svg"] }] } }, tmpDir),
      ).rejects.toThrow(`sprite source not found: ${join(emptySourceDir, "icon.svg")} (group svg/sprite.svg, symbol icon)`);
      expect(existsSync(spriteOut)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses a group whose sources are present but parse to no symbol at all", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const sourceDir = join(tmpDir, "svg-src");
    mkdirSync(sourceDir, { recursive: true });
    try {
      writeFileSync(join(sourceDir, "icon.svg"), "not an svg at all");
      await expect(
        buildSprites({ icons: { target: "svg/sprite.svg", sources: [{ path: sourceDir, files: ["icon.svg"] }] } }, tmpDir),
      ).rejects.toThrow("no symbols produced for svg/sprite.svg — every source file parsed to nothing");
      expect(existsSync(join(tmpDir, "svg", "sprite.svg"))).toBe(false);
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
        core: { target: "svg/sprite.svg", sources: [{ path: "https://example.com/a/", files: [{ key: "a", file: "a.svg", sha256: pin(svgA) }] }] },
        "brand-icons": {
          target: "svg/brand.svg",
          sources: [{ path: "https://example.com/b/", files: [{ key: "b", file: "b.svg", sha256: pin(svgB) }] }],
        },
      };
      const result = await buildSprites(sprites, tmpDir, { cacheDir: join(tmpDir, "cache") });
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
        icons: {
          target: "svg/sprite.svg",
          sources: [{ path: "https://example.com/", files: [{ key: "mouse-pointer-2", file: "select.svg", sha256: pin(svg) }] }],
        },
      };
      const result = await buildSprites(sprites, tmpDir, { cacheDir: join(tmpDir, "cache") });
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
        cursors: {
          target: "svg/cursors.svg",
          prefix: "cursor-",
          sources: [{ path: "https://example.com/", files: [{ key: "orbit", file: "orbit.svg", sha256: pin(svg) }] }],
        },
      };
      const result = await buildSprites(sprites, tmpDir, { cacheDir: join(tmpDir, "cache") });
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
            { path: "https://example.com/base/", files: [{ key: "select", file: "a.svg", sha256: pin(svgFirst) }] },
            { path: "https://example.com/override/", files: [{ key: "select", file: "b.svg", sha256: pin(svgLast) }] },
          ],
        },
      };
      const result = await buildSprites(sprites, tmpDir, { cacheDir: join(tmpDir, "cache") });
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
