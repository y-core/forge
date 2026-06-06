import { describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSprites, extractViewBoxes, sanitizeSVG, svgToSymbol } from "./sprites";

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

  it("strips unquoted event handler attributes", () => {
    const input = `<circle onload=evil()/>`;
    expect(sanitizeSVG(input)).not.toContain("onload");
  });

  it("strips foreignObject blocks (arbitrary HTML / iframe embedding)", () => {
    const input = `<rect/><foreignObject><iframe src="https://evil.com"/></foreignObject><path/>`;
    const result = sanitizeSVG(input);
    expect(result).not.toContain("foreignObject");
    expect(result).not.toContain("iframe");
    expect(result).toContain("<rect/>");
    expect(result).toContain("<path/>");
  });

  it("strips style blocks (CSS url(javascript:...) / expressions)", () => {
    const input = `<path/><style>path { background: url(javascript:alert(1)) }</style>`;
    const result = sanitizeSVG(input);
    expect(result).not.toContain("<style>");
    expect(result).not.toContain("javascript:");
    expect(result).toContain("<path/>");
  });

  it("strips href with javascript: scheme", () => {
    const input = `<use href="javascript:alert(1)"/>`;
    const result = sanitizeSVG(input);
    expect(result).not.toContain("href=");
    expect(result).not.toContain("javascript:");
  });

  it("strips xlink:href with javascript: scheme", () => {
    const input = `<use xlink:href="javascript:alert(1)"/>`;
    expect(sanitizeSVG(input)).not.toContain("xlink:href=");
  });

  it("strips href with data:text/html scheme", () => {
    const input = `<a href="data:text/html,<script>alert(1)</script>">click</a>`;
    expect(sanitizeSVG(input)).not.toContain(`href=`);
  });

  it("preserves safe href values (symbol references)", () => {
    const input = `<use href="#icon-sun"/>`;
    expect(sanitizeSVG(input)).toBe(input);
  });

  it("strips SMIL animate elements retargeting href", () => {
    const input = `<animate attributeName="href" values="javascript:alert(1)"/>`;
    expect(sanitizeSVG(input)).not.toContain("animate");
  });

  it("strips SMIL set elements retargeting xlink:href", () => {
    const input = `<set attributeName="xlink:href" to="javascript:void(0)"/>`;
    expect(sanitizeSVG(input)).not.toContain("<set");
  });

  it("preserves safe SVG content (exact match)", () => {
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
});

describe("extractViewBoxes()", () => {
  it("extracts viewBox from each symbol by id", () => {
    const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="icon-sun" viewBox="0 0 24 24"><circle/></symbol>
  <symbol id="icon-logo" viewBox="147.9 43 583.1 313"><path/></symbol>
</svg>`;
    const meta = extractViewBoxes(sprite);
    expect(meta["icon-sun"]).toBe("0 0 24 24");
    expect(meta["icon-logo"]).toBe("147.9 43 583.1 313");
  });

  it("returns empty object for sprite with no symbols", () => {
    expect(extractViewBoxes(`<svg></svg>`)).toEqual({});
  });

  it("handles symbols with id before viewBox and viewBox before id", () => {
    const sprite = `<svg>
  <symbol viewBox="0 0 22 22" id="icon-hamburger"><path/></symbol>
</svg>`;
    const meta = extractViewBoxes(sprite);
    expect(meta["icon-hamburger"]).toBe("0 0 22 22");
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

  it("normalizes non-zero-origin viewBox to '0 0 w h' and wraps content in translate", () => {
    const svg = `<svg viewBox="147.9 43 583.1 313"><path d="M577.1 43"/></svg>`;
    const result = svgToSymbol(svg, "logo.svg") ?? "";
    expect(result).toContain(`viewBox="0 0 583.1 313"`);
    expect(result).toContain(`transform="translate(-147.9 -43)"`);
    expect(result).toContain(`d="M577.1 43"`);
  });

  it("does not add translate wrapper for zero-origin viewBox", () => {
    const svg = `<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`;
    const result = svgToSymbol(svg, "icon.svg") ?? "";
    expect(result).toContain(`viewBox="0 0 24 24"`);
    expect(result).not.toContain(`transform=`);
  });
});
