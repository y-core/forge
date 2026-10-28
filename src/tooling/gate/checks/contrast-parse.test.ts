import { describe, expect, it } from "bun:test";

import { checkDarkHoldsOnlySteps, parseThemeDeclarations, resolveStep } from "./contrast-parse";

describe("parseThemeDeclarations", () => {
  const css = `:root {
  --gray-6: light-dark(oklch(88.53% 0 0), oklch(34.85% 0 0));
  --gray-9: oklch(64.34% 0 0);
  --border: var(--gray-6);
}`;

  it("puts each branch of a light-dark() in its own mode", () => {
    const parsed = parseThemeDeclarations(css);
    expect(parsed.light.get("--gray-6")?.value).toBe("oklch(88.53% 0 0)");
    expect(parsed.dark.get("--gray-6")?.value).toBe("oklch(34.85% 0 0)");
  });

  it("leaves a mode-free step out of the dark map, which resolveStep falls back for", () => {
    const parsed = parseThemeDeclarations(css);
    expect(parsed.dark.has("--gray-9")).toBe(false);
    expect(resolveStep(parsed, "dark", "--gray-9")?.value).toBe("oklch(64.34% 0 0)");
  });

  it("reports both halves of a split on the one line they are written on", () => {
    const parsed = parseThemeDeclarations(css);
    expect(parsed.light.get("--gray-6")?.line).toBe(2);
    expect(parsed.dark.get("--gray-6")?.line).toBe(2);
  });

  it("reads a second :root block, whose declarations the cascade paints over the first", () => {
    const parsed = parseThemeDeclarations(`${css}\n:root {\n  --gray-9: oklch(50% 0 0);\n  --accent: oklch(60% 0.1 250);\n}`);

    expect(parsed.light.get("--gray-9")?.value).toBe("oklch(50% 0 0)");
    expect(parsed.light.get("--gray-9")?.line).toBe(7);
    expect(parsed.light.get("--accent")?.value).toBe("oklch(60% 0.1 250)");
    expect(parsed.light.get("--gray-6")?.value).toBe("oklch(88.53% 0 0)");
  });

  it("drops the dark branch a later mode-free redeclaration replaces", () => {
    const parsed = parseThemeDeclarations(`${css}\n:root { --gray-6: oklch(50% 0 0); }`);

    expect(parsed.dark.has("--gray-6")).toBe(false);
    expect(resolveStep(parsed, "dark", "--gray-6")?.value).toBe("oklch(50% 0 0)");
  });

  it("reads nothing from a .dark block, which is no longer a declaration site", () => {
    const parsed = parseThemeDeclarations(`${css}\n.dark { --gray-6: oklch(11.11% 0 0); --gray-9: oklch(22.22% 0 0); }`);
    expect(parsed.dark.get("--gray-6")?.value).toBe("oklch(34.85% 0 0)");
    expect(parsed.dark.has("--gray-9")).toBe(false);
  });
});

describe("checkDarkHoldsOnlySteps", () => {
  it("passes a role step written per-mode", () => {
    expect(checkDarkHoldsOnlySteps(parseThemeDeclarations(":root { --gray-6: light-dark(#fff, #000); }"), "theme.css")).toEqual([]);
  });

  it("fails a semantic token given two values, which the step below it owns instead", () => {
    const findings = checkDarkHoldsOnlySteps(parseThemeDeclarations(":root { --border: light-dark(#fff, #000); }"), "theme.css");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("`--border` is written with `light-dark()`");
  });
});
