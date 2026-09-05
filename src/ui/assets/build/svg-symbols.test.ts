import { describe, expect, it } from "bun:test";

import { extractViewBoxes, sanitizeSVG, svgToSymbol } from "./svg-symbols";

describe("sanitizeSVG()", () => {
  it("strips inline script tags", () => {
    const input = `<svg><circle/><script>alert(1)</script></svg>`;
    expect(sanitizeSVG(input)).toBe(`<svg><circle/></svg>`);
  });

  it("strips multi-line script tags", () => {
    const input = `<svg><script>\nconst x = 1;\n</script><path/></svg>`;
    expect(sanitizeSVG(input)).toBe(`<svg><path/></svg>`);
  });

  it("strips double-quoted event handlers", () => {
    const input = `<svg><circle onclick="evil()" onmouseover="bad()"/></svg>`;
    expect(sanitizeSVG(input)).toBe(`<svg><circle/></svg>`);
  });

  it("strips single-quoted event handlers", () => {
    const input = `<svg><circle onclick='evil()'/></svg>`;
    expect(sanitizeSVG(input)).toBe(`<svg><circle/></svg>`);
  });

  it("strips unquoted event handler attributes", () => {
    const input = `<circle onload=evil()/>`;
    expect(sanitizeSVG(input)).toBe(`<circle>`);
  });

  it("strips an event handler written with whitespace around its `=`", () => {
    expect(sanitizeSVG(`<circle onclick = "evil()" r="1"/>`)).toBe(`<circle r="1"/>`);
    expect(sanitizeSVG(`<circle onclick = evil() r="1"/>`)).toBe(`<circle r="1"/>`);
  });

  // Adversarial fixture: a mixed-case handler, which HTML lowercases straight back into a live one.
  it("strips uppercase event handler attributes", () => {
    const input = `<svg><path d="M0 0" ONMOUSEOVER="alert(1)"/></svg>`;
    expect(sanitizeSVG(input)).toBe(`<svg><path d="M0 0"/></svg>`);
  });

  it("strips mixed-case event handler attributes", () => {
    const input = `<svg><circle OnClick='evil()'/></svg>`;
    expect(sanitizeSVG(input)).toBe(`<svg><circle/></svg>`);
  });

  it("strips an uppercase unquoted event handler attribute", () => {
    const input = `<circle ONLOAD=evil()/>`;
    expect(sanitizeSVG(input)).toBe(`<circle>`);
  });

  it("leaves a non-handler attribute whose name merely starts with `on` untouched", () => {
    // `only` is not an event handler; the `on[a-zA-Z]+=` pattern must not eat it.
    const input = `<svg><path only-child="1"/></svg>`;
    expect(sanitizeSVG(input)).toBe(input);
  });

  it("strips foreignObject blocks (arbitrary HTML / iframe embedding)", () => {
    const input = `<rect/><foreignObject><iframe src="https://evil.com"/></foreignObject><path/>`;
    expect(sanitizeSVG(input)).toBe(`<rect/><path/>`);
  });

  it("strips style blocks (CSS url(javascript:...) / expressions)", () => {
    const input = `<path/><style>path { background: url(javascript:alert(1)) }</style>`;
    expect(sanitizeSVG(input)).toBe(`<path/>`);
  });

  it("strips href with javascript: scheme", () => {
    const input = `<use href="javascript:alert(1)"/>`;
    expect(sanitizeSVG(input)).toBe(`<use/>`);
  });

  it("strips xlink:href with javascript: scheme", () => {
    const input = `<use xlink:href="javascript:alert(1)"/>`;
    expect(sanitizeSVG(input)).toBe(`<use/>`);
  });

  it("strips href with data:text/html scheme", () => {
    const input = `<a href="data:text/html,<script>alert(1)</script>">click</a>`;
    expect(sanitizeSVG(input)).toBe(`<a>click</a>`);
  });

  it("preserves safe href values (symbol references)", () => {
    const input = `<use href="#icon-sun"/>`;
    expect(sanitizeSVG(input)).toBe(input);
  });

  it("strips SMIL animate elements retargeting href", () => {
    const input = `<animate attributeName="href" values="javascript:alert(1)"/>`;
    expect(sanitizeSVG(input)).toBe("");
  });

  it("strips SMIL set elements retargeting xlink:href", () => {
    const input = `<set attributeName="xlink:href" to="javascript:void(0)"/>`;
    expect(sanitizeSVG(input)).toBe("");
  });

  it("preserves safe SVG content (exact match)", () => {
    const input = `<path d="M12 12" stroke="#163030" fill="none"/>`;
    expect(sanitizeSVG(input)).toBe(input);
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
  it("wraps inner content in a symbol with the given key and prefix", () => {
    const svg = `<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`;
    const result = svgToSymbol(svg, "sun", "icon-");
    expect(result?.id).toBe("icon-sun");
    expect(result?.symbol).toBe(`  <symbol id="icon-sun" viewBox="0 0 24 24"><path d="M12 12"/></symbol>`);
  });

  it("uses the key directly — no basename stripping", () => {
    const svg = `<svg viewBox="0 0 24 24"><circle r="10"/></svg>`;
    const result = svgToSymbol(svg, "mouse-pointer-2", "icon-");
    expect(result?.id).toBe("icon-mouse-pointer-2");
    expect(result?.symbol).toBe(`  <symbol id="icon-mouse-pointer-2" viewBox="0 0 24 24"><circle r="10"/></symbol>`);
  });

  it("uses a custom prefix in the symbol id", () => {
    const svg = `<svg viewBox="0 0 32 32"><path d="M0 0"/></svg>`;
    const result = svgToSymbol(svg, "orbit", "cursor-");
    expect(result?.id).toBe("cursor-orbit");
    expect(result?.symbol).toBe(`  <symbol id="cursor-orbit" viewBox="0 0 32 32"><path d="M0 0"/></symbol>`);
  });

  it("uses default viewBox when missing", () => {
    const svg = `<svg><circle r="10"/></svg>`;
    expect(svgToSymbol(svg, "circle", "icon-")?.symbol).toBe(`  <symbol id="icon-circle" viewBox="0 0 24 24"><circle r="10"/></symbol>`);
  });

  it("returns null for malformed SVG", () => {
    expect(svgToSymbol("not svg at all", "bad", "icon-")).toBeNull();
  });

  it("strips event handlers from symbol content", () => {
    const svg = `<svg viewBox="0 0 24 24"><path onclick="evil()"/></svg>`;
    expect(svgToSymbol(svg, "bad", "icon-")?.symbol).toBe(`  <symbol id="icon-bad" viewBox="0 0 24 24"><path/></symbol>`);
  });

  it("carries root presentation attributes on a wrapping group", () => {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/></svg>`;
    expect(svgToSymbol(svg, "sun", "icon-")?.symbol).toBe(
      `  <symbol id="icon-sun" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/></g></symbol>`,
    );
  });

  it("lets a child's own fill win over the root fill by inheritance", () => {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 12" fill="red"/></svg>`;
    expect(svgToSymbol(svg, "icon", "icon-")?.symbol).toBe(
      `  <symbol id="icon-icon" viewBox="0 0 24 24"><g fill="none" stroke="currentColor"><path d="M12 12" fill="red"/></g></symbol>`,
    );
  });

  it("lets a nested group's fill win over the root fill", () => {
    const svg = `<svg viewBox="0 0 24 24" fill="none"><g fill="red"><path d="M12 12"/></g></svg>`;
    expect(svgToSymbol(svg, "group", "icon-")?.symbol).toBe(
      `  <symbol id="icon-group" viewBox="0 0 24 24"><g fill="none"><g fill="red"><path d="M12 12"/></g></g></symbol>`,
    );
  });

  it("does not read a data- attribute as a root presentation attribute", () => {
    const svg = `<svg viewBox="0 0 24 24" data-stroke="red"><path d="M1 1"/></svg>`;
    expect(svgToSymbol(svg, "ds", "icon-")?.symbol).toBe(`  <symbol id="icon-ds" viewBox="0 0 24 24"><path d="M1 1"/></symbol>`);
  });

  it("leaves an element whose name merely starts with a shape name untouched", () => {
    const svg = `<svg viewBox="0 0 24 24" stroke="currentColor"><linearGradient id="g"><stop/></linearGradient><path d="M1 1"/></svg>`;
    expect(svgToSymbol(svg, "grad", "icon-")?.symbol).toBe(
      `  <symbol id="icon-grad" viewBox="0 0 24 24"><g stroke="currentColor"><linearGradient id="g"><stop/></linearGradient><path d="M1 1"/></g></symbol>`,
    );
  });

  it("emits no wrapper when the root has no presentational attributes", () => {
    const svg = `<svg viewBox="0 0 314 95"><path d="M70 217" fill="#366" fill-rule="nonzero"/></svg>`;
    expect(svgToSymbol(svg, "logo", "icon-")?.symbol).toBe(
      `  <symbol id="icon-logo" viewBox="0 0 314 95"><path d="M70 217" fill="#366" fill-rule="nonzero"/></symbol>`,
    );
  });

  it("normalizes non-zero-origin viewBox to '0 0 w h' and wraps content in translate", () => {
    const svg = `<svg viewBox="147.9 43 583.1 313"><path d="M577.1 43"/></svg>`;
    expect(svgToSymbol(svg, "logo", "icon-")?.symbol).toBe(
      `  <symbol id="icon-logo" viewBox="0 0 583.1 313"><g transform="translate(-147.9 -43)"><path d="M577.1 43"/></g></symbol>`,
    );
  });

  it("carries the translate and the root attributes on one wrapper", () => {
    const svg = `<svg viewBox="147.9 43 583.1 313" fill="none" stroke="currentColor"><path d="M577.1 43"/></svg>`;
    expect(svgToSymbol(svg, "both", "icon-")?.symbol).toBe(
      `  <symbol id="icon-both" viewBox="0 0 583.1 313"><g transform="translate(-147.9 -43)" fill="none" stroke="currentColor"><path d="M577.1 43"/></g></symbol>`,
    );
  });

  it("does not add translate wrapper for zero-origin viewBox", () => {
    const svg = `<svg viewBox="0 0 24 24"><path d="M12 12"/></svg>`;
    expect(svgToSymbol(svg, "icon", "icon-")?.symbol).toBe(`  <symbol id="icon-icon" viewBox="0 0 24 24"><path d="M12 12"/></symbol>`);
  });
});
