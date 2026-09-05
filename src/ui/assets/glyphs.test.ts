import { describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FORGE_UI_ICON_NAMES, FORGE_UI_SPRITE_FILES, loadSpriteGlyphs, parseSpriteGlyphs } from "./glyphs";

describe("FORGE_UI_ICON_NAMES", () => {
  it("is every name in every group, in declaration order", () => {
    expect(FORGE_UI_ICON_NAMES).toEqual([
      "spinner",
      "chevron-down",
      "chevron-left",
      "chevron-right",
      "hamburger",
      "close",
      "panel-open",
      "panel-close",
      "upload",
      "sun",
      "moon",
      "monitor",
    ]);
  });

  it("names exactly the groups the sprite files are filed under", () => {
    expect(Object.keys(FORGE_UI_SPRITE_FILES)).toEqual(["core", "theme"]);
  });

  // The whole point of declaring them here: `sprites.ts` reaches `node:path` at module scope, and
  // `esbuild --platform=neutral` resolves before it tree-shakes, so a consumer bundling only the
  // names could not build. A node import creeping back into this module reintroduces that.
  it("is reachable from a module that imports nothing from node", () => {
    expect(/from "node:/.test(readFileSync(fileURLToPath(new URL("./glyphs.ts", import.meta.url)), "utf-8"))).toBe(false);
  });
});

describe("parseSpriteGlyphs()", () => {
  it("extracts key, viewBox, and markup with default icon- prefix", () => {
    const svg = `<svg><symbol id="icon-sun" viewBox="0 0 24 24"><circle r="10"/></symbol></svg>`;
    const result = parseSpriteGlyphs(svg);
    expect(result.sun).toEqual({ viewBox: "0 0 24 24", markup: '<circle r="10"/>' });
  });

  it("extracts multiple symbols", () => {
    const svg = `<svg>
  <symbol id="icon-sun" viewBox="0 0 24 24"><circle/></symbol>
  <symbol id="icon-moon" viewBox="0 0 24 24"><path d="M20 12"/></symbol>
</svg>`;
    const result = parseSpriteGlyphs(svg);
    expect(result.sun).toBeDefined();
    expect(result.moon).toBeDefined();
  });

  it("uses custom prefix to strip from id", () => {
    const svg = `<svg><symbol id="cursor-orbit" viewBox="0 0 32 32"><path d="M0 0"/></symbol></svg>`;
    const result = parseSpriteGlyphs(svg, "cursor-");
    expect(result.orbit).toBeDefined();
    expect(result.orbit?.viewBox).toBe("0 0 32 32");
  });

  it("does not match symbols whose prefix differs from requested prefix", () => {
    const svg = `<svg><symbol id="cursor-orbit" viewBox="0 0 32 32"><path/></symbol></svg>`;
    const result = parseSpriteGlyphs(svg, "icon-");
    expect(result).toEqual({});
  });

  it("returns empty object for empty input", () => {
    expect(parseSpriteGlyphs("")).toEqual({});
  });

  it("returns empty object for non-SVG text", () => {
    expect(parseSpriteGlyphs("not svg at all")).toEqual({});
  });

  it("handles multi-line symbol inner content", () => {
    const svg = `<svg>
  <symbol id="icon-complex" viewBox="0 0 24 24">
    <path d="M12 2"/>
    <circle r="5"/>
  </symbol>
</svg>`;
    const result = parseSpriteGlyphs(svg);
    expect(result.complex).toBeDefined();
    expect(result.complex?.markup).toContain("<path");
    expect(result.complex?.markup).toContain("<circle");
  });
});

describe("loadSpriteGlyphs()", () => {
  it("fetches URL and parses sprite with default prefix", async () => {
    const svg = `<svg><symbol id="icon-sun" viewBox="0 0 24 24"><circle/></symbol></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(svg, { status: 200 }));
    try {
      const result = await loadSpriteGlyphs("https://example.com/sprite.svg");
      expect(result.sun).toBeDefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses custom prefix when provided", async () => {
    const svg = `<svg><symbol id="cursor-orbit" viewBox="0 0 32 32"><path/></symbol></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(svg, { status: 200 }));
    try {
      const result = await loadSpriteGlyphs("https://example.com/cursors.svg", "cursor-");
      expect(result.orbit).toBeDefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("returns empty object on network failure", async () => {
    const rejected = Promise.reject(new Error("network error"));
    rejected.catch(() => {});
    const fetchSpy = spyOn(globalThis, "fetch").mockReturnValueOnce(rejected as unknown as Promise<Response>);
    try {
      const result = await loadSpriteGlyphs("https://example.com/sprite.svg");
      expect(result).toEqual({});
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("returns empty object on non-ok response", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));
    try {
      const result = await loadSpriteGlyphs("https://example.com/sprite.svg");
      expect(result).toEqual({});
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
