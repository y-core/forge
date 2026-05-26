import { describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSprites, sanitizeSVG, svgToSymbol } from "./sprites";

describe("sanitizeSVG()", () => {
  it("strips inline script tags", () => {
    const input = `<svg><circle/><script>alert(1)</script></svg>`;
    const result = sanitizeSVG(input);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("strips multi-line script tags", () => {
    const input = `<svg><script>\nconst x = 1;\n</script><path/></svg>`;
    expect(sanitizeSVG(input)).not.toContain("<script>");
  });

  it("strips double-quoted event handlers", () => {
    const input = `<svg><circle onclick="evil()" onmouseover="bad()"/></svg>`;
    const result = sanitizeSVG(input);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onmouseover");
  });

  it("strips single-quoted event handlers", () => {
    const input = `<svg><circle onclick='evil()'/></svg>`;
    expect(sanitizeSVG(input)).not.toContain("onclick");
  });

  it("preserves safe SVG content", () => {
    const input = `<path d="M12 12" stroke="#163030" fill="none"/>`;
    expect(sanitizeSVG(input)).toBe(input);
  });
});

describe("buildSprites()", () => {
  it("caches remote SVGs and skips fetch on second build", async () => {
    const tmpDir = join(tmpdir(), `forge-sprites-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`, { status: 200 }),
    );
    try {
      const sprites = {
        icons: {
          target: "svg/sprite.svg",
          sources: [{ path: "https://example.com/icons/", files: ["arrow.svg"] }],
        },
      };

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
      console.log("DIAGNOSTIC before:", { tmpDir, emptySourceDir, spriteOut, sourceExists: existsSync(emptySourceDir), spriteExists: existsSync(spriteOut) });
      await buildSprites(
        {
          icons: {
            target: "svg/sprite.svg",
            sources: [{ path: emptySourceDir, files: ["icon.svg"] }],
          },
        },
        tmpDir,
      );
      const spriteExists = existsSync(spriteOut);
      console.log("DIAGNOSTIC after:", { spriteExists });
      expect(spriteExists).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("svgToSymbol()", () => {
  it("wraps inner content in a symbol with the filename as id", () => {
    const svg = `<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`;
    const result = svgToSymbol(svg, "sun.svg");
    expect(result).toContain(`id="icon-sun"`);
    expect(result).toContain(`viewBox="0 0 24 24"`);
    expect(result).toContain(`d="M12 12"`);
  });

  it("uses default viewBox when missing", () => {
    const svg = `<svg><circle r="10"/></svg>`;
    const result = svgToSymbol(svg, "circle.svg");
    expect(result).toContain(`viewBox="0 0 24 24"`);
  });

  it("returns null for malformed SVG", () => {
    expect(svgToSymbol("not svg at all", "bad.svg")).toBeNull();
  });

  it("strips event handlers from symbol content", () => {
    const svg = `<svg viewBox="0 0 24 24"><path onclick="evil()"/></svg>`;
    const result = svgToSymbol(svg, "bad.svg");
    expect(result).not.toContain("onclick");
  });

  it("propagates root fill and stroke to child shape elements", () => {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/></svg>`;
    const result = svgToSymbol(svg, "sun.svg") ?? "";
    expect(result).toContain(`fill="none"`);
    expect(result).toContain(`stroke="currentColor"`);
    expect(result).toContain(`stroke-width="2"`);
    expect(result).toContain(`stroke-linecap="round"`);
    expect(result).toContain(`stroke-linejoin="round"`);
  });

  it("does not overwrite existing child attributes during propagation", () => {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 12" fill="red"/></svg>`;
    const result = svgToSymbol(svg, "icon.svg") ?? "";
    expect(result).toContain(`fill="red"`);
    expect(result).not.toContain(`fill="none"`);
    expect(result).toContain(`stroke="currentColor"`);
  });

  it("skips propagation when root has no presentational attributes", () => {
    const svg = `<svg viewBox="23 122 314 95"><path d="M70 217" fill="#366" fill-rule="nonzero"/></svg>`;
    const result = svgToSymbol(svg, "logo.svg") ?? "";
    expect(result).not.toContain(`stroke=`);
    expect(result).toContain(`fill="#366"`);
    expect(result).toContain(`fill-rule="nonzero"`);
  });
});
