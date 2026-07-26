import { describe, expect, it } from "bun:test";
import { readThemeTokens, resolveToken } from "./css-tokens";

const CSS = `
:root {
  --color-green: oklch(0.596 0.145 163.225);
  --signal: var(--color-green);
  --background: #ffffff;
}
.dark {
  --background: #000000;
  --signal: oklch(0.765 0.177 163.223);
}
`;

const SELECTORS = { light: ":root", dark: ".dark" };

describe("readThemeTokens() + resolveToken()", () => {
  it("resolves the light signal through the var() chain to its oklch literal", () => {
    const tokens = readThemeTokens(CSS, SELECTORS);
    expect(resolveToken("--signal", tokens.light!)).toBe("oklch(0.596 0.145 163.225)");
  });

  it("resolves the dark signal to its direct override value (not the var chain)", () => {
    const tokens = readThemeTokens(CSS, SELECTORS);
    expect(resolveToken("--signal", tokens.dark!)).toBe("oklch(0.765 0.177 163.223)");
  });

  it("dark background override wins over :root", () => {
    const tokens = readThemeTokens(CSS, SELECTORS);
    expect(resolveToken("--background", tokens.dark!)).toBe("#000000");
  });

  it("light background inherits the :root value", () => {
    const tokens = readThemeTokens(CSS, SELECTORS);
    expect(resolveToken("--background", tokens.light!)).toBe("#ffffff");
  });

  it("returns null for a missing token", () => {
    const tokens = readThemeTokens(CSS, SELECTORS);
    expect(resolveToken("--nonexistent", tokens.light!)).toBeNull();
  });
});

// Minified output as a CSS minifier actually emits it: no whitespace, leading zeros stripped,
// and — the part that matters — no `;` after the last declaration of a block. The palette
// indirection is deliberate: the terminal literal of the light chain sits last in its block,
// which is the exact shape that used to break the cursor bake.
const MINIFIED_CSS = [
  ":root,:host{--color-gray-50:oklch(98.5% .002 247.839);--color-gray-950:oklch(13% .028 261.692)}",
  ":root{--radius:.625rem;--background:var(--palette-100);--foreground:var(--palette-950)}",
  ":root{--palette-100:#f3f4f6;--palette-50:var(--color-gray-50);--palette-950:var(--color-gray-950)}",
  ".dark{--background:var(--palette-900);--foreground:var(--palette-50)}",
  ".dark{--palette-900:#1e2939}",
].join("");

describe("readThemeTokens() over minified CSS", () => {
  it("parses the last declaration of a block despite the missing trailing semicolon", () => {
    const tokens = readThemeTokens(MINIFIED_CSS, SELECTORS);
    expect(tokens.light!.get("--palette-950")).toBe("var(--color-gray-950)");
    expect(tokens.light!.get("--color-gray-950")).toBe("oklch(13% .028 261.692)");
  });

  it("resolves a light chain whose every hop is last-in-block", () => {
    const tokens = readThemeTokens(MINIFIED_CSS, SELECTORS);
    expect(resolveToken("--foreground", tokens.light!)).toBe("oklch(13% .028 261.692)");
  });

  it("resolves the dark override chain", () => {
    const tokens = readThemeTokens(MINIFIED_CSS, SELECTORS);
    expect(resolveToken("--foreground", tokens.dark!)).toBe("oklch(98.5% .002 247.839)");
    expect(resolveToken("--background", tokens.dark!)).toBe("#1e2939");
  });

  it("still reads non-final declarations of a minified block", () => {
    const tokens = readThemeTokens(MINIFIED_CSS, SELECTORS);
    expect(tokens.light!.get("--radius")).toBe(".625rem");
    expect(resolveToken("--background", tokens.light!)).toBe("#f3f4f6");
  });
});
