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
