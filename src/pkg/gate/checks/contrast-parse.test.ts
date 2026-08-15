import { describe, expect, it } from "bun:test";
import { checkDarkHoldsOnlySteps, parseThemeDeclarations, resolveStep, splitLightDark } from "./contrast-parse";

describe("splitLightDark", () => {
  it("splits the two branches of a plain value", () => {
    expect(splitLightDark("light-dark(oklch(88.53% 0 0), oklch(34.85% 0 0))")).toEqual(["oklch(88.53% 0 0)", "oklch(34.85% 0 0)"]);
  });

  it("splits on the top-level comma, not the one inside a function", () => {
    expect(splitLightDark("light-dark(rgba(0, 0, 0, 0.4), rgba(255, 255, 255, 0.4))")).toEqual(["rgba(0, 0, 0, 0.4)", "rgba(255, 255, 255, 0.4)"]);
  });

  it("splits a pair of var() references, which is what a contrast step is", () => {
    expect(splitLightDark("light-dark(var(--gray-1), var(--gray-12))")).toEqual(["var(--gray-1)", "var(--gray-12)"]);
  });

  it("returns undefined for a value that is not a light-dark() at all", () => {
    expect(splitLightDark("oklch(88.53% 0 0)")).toBeUndefined();
    expect(splitLightDark("var(--gray-6)")).toBeUndefined();
    expect(splitLightDark("#d9d9d9")).toBeUndefined();
  });

  it("returns undefined for a light-dark() carrying no top-level comma", () => {
    expect(splitLightDark("light-dark(var(--gray-1))")).toBeUndefined();
  });
});

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
