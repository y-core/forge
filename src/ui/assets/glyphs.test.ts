import { describe, expect, it, spyOn } from "bun:test";
import { loadSpriteGlyphs, parseSpriteGlyphs } from "./glyphs";

describe("parseSpriteGlyphs()", () => {
  it("extracts key, viewBox, and markup with default icon- prefix", () => {
    const svg = `<svg><symbol id="icon-sun" viewBox="0 0 24 24"><circle r="10"/></symbol></svg>`;
    const result = parseSpriteGlyphs(svg);
    expect(result["sun"]).toEqual({ viewBox: "0 0 24 24", markup: '<circle r="10"/>' });
  });

  it("extracts multiple symbols", () => {
    const svg = `<svg>
  <symbol id="icon-sun" viewBox="0 0 24 24"><circle/></symbol>
  <symbol id="icon-moon" viewBox="0 0 24 24"><path d="M20 12"/></symbol>
</svg>`;
    const result = parseSpriteGlyphs(svg);
    expect(result["sun"]).toBeDefined();
    expect(result["moon"]).toBeDefined();
  });

  it("uses custom prefix to strip from id", () => {
    const svg = `<svg><symbol id="cursor-orbit" viewBox="0 0 32 32"><path d="M0 0"/></symbol></svg>`;
    const result = parseSpriteGlyphs(svg, "cursor-");
    expect(result["orbit"]).toBeDefined();
    expect(result["orbit"]?.viewBox).toBe("0 0 32 32");
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
    expect(result["complex"]).toBeDefined();
    expect(result["complex"]?.markup).toContain("<path");
    expect(result["complex"]?.markup).toContain("<circle");
  });
});

describe("loadSpriteGlyphs()", () => {
  it("fetches URL and parses sprite with default prefix", async () => {
    const svg = `<svg><symbol id="icon-sun" viewBox="0 0 24 24"><circle/></symbol></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(svg, { status: 200 }));
    try {
      const result = await loadSpriteGlyphs("https://example.com/sprite.svg");
      expect(result["sun"]).toBeDefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses custom prefix when provided", async () => {
    const svg = `<svg><symbol id="cursor-orbit" viewBox="0 0 32 32"><path/></symbol></svg>`;
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(svg, { status: 200 }));
    try {
      const result = await loadSpriteGlyphs("https://example.com/cursors.svg", "cursor-");
      expect(result["orbit"]).toBeDefined();
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
