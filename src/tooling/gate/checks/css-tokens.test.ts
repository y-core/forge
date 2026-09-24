import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { deriveClassGroups } from "./class-groups-parse";
import { checkCssTokens, findThemeTokens, overloadedRoots } from "./css-tokens";
import { loadDesignSystem } from "./design-system";
import type { CssTokensCheckConfig } from "./types";

const ROOT = resolve(import.meta.dir, "../../../..");
const CONFIG: CssTokensCheckConfig = { root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", cssDir: "src/ui/assets/css" };

/** A stylesheet directory holding one file, for the check to read. */
function fixture(css: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-css-tokens-"));
  writeFileSync(resolve(dir, "theme.css"), css, "utf-8");
  return dir;
}

describe("findThemeTokens", () => {
  it("reads the properties of an `@theme inline` block and nothing from `:root`", () => {
    const css = ":root {\n  --text-page: red;\n}\n\n@theme inline {\n  --color-card: var(--card);\n  --radius-lg: 1rem;\n}\n";
    expect(findThemeTokens(css)).toEqual([
      { property: "--color-card", line: 6 },
      { property: "--radius-lg", line: 7 },
    ]);
  });

  it("reports the line the token is written on after a multi-line comment, which blanking preserves", () => {
    const css = "/* one\n   two\n   three */\n@theme {\n  --color-a: red;\n}\n";

    expect(findThemeTokens(css)).toEqual([{ property: "--color-a", line: 5 }]);
  });

  it("ignores a property that only appears in a comment", () => {
    expect(findThemeTokens("@theme {\n  /* --text-hero: 3rem; */\n  --color-a: red;\n}\n")).toEqual([{ property: "--color-a", line: 3 }]);
  });

  it("reads a nested block's closing brace without ending the theme early", () => {
    const css = "@theme {\n  --color-a: red;\n  @media (min-width: 40rem) {\n    --color-b: blue;\n  }\n  --color-c: green;\n}\n";
    expect(findThemeTokens(css).map((token) => token.property)).toEqual(["--color-a", "--color-b", "--color-c"]);
  });
});

describe("overloadedRoots", () => {
  it("names `text` — where an enumerated value is a size and every other name is a colour", async () => {
    const roots = overloadedRoots(deriveClassGroups(await loadDesignSystem(resolve(ROOT, CONFIG.stylesheet))));
    expect(roots.get("text")?.has("2xl")).toBe(true);
    expect(roots.get("text")?.has("hero")).toBe(false);
  });

  it("does not name the reserved `text-size` root, which carries one concern", async () => {
    const roots = overloadedRoots(deriveClassGroups(await loadDesignSystem(resolve(ROOT, CONFIG.stylesheet))));
    expect(roots.has("text-size")).toBe(false);
  });
});

describe("checkCssTokens", () => {
  it("passes against forge's own stylesheets", async () => {
    const result = await checkCssTokens(CONFIG);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("fails a font-size step declared as `--text-*`", async () => {
    const dir = fixture("@theme {\n  --text-hero: 3rem;\n}\n");
    const result = await checkCssTokens({ ...CONFIG, cssDir: dir });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.line)).toEqual([2]);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`--text-hero` declares a token in the `text-*` namespace, where `text-hero` reads as the other concern that root carries — so `cn` drops it against a utility it does not actually conflict with",
    ]);
  });

  it("passes the same step declared under the reserved scale namespace", async () => {
    const result = await checkCssTokens({ ...CONFIG, cssDir: fixture("@theme {\n  --text-size-hero: 3rem;\n}\n") });
    expect(result.findings).toEqual([]);
  });

  it("passes a name the design system itself enumerates, and a namespace no utility root claims", async () => {
    const result = await checkCssTokens({
      ...CONFIG,
      cssDir: fixture("@theme {\n  --text-2xl: 3rem;\n  --color-brand: red;\n  --radius: 1rem;\n}\n"),
    });
    expect(result.findings).toEqual([]);
  });

  it("ignores the same declaration outside an `@theme` block, where it creates no utility", async () => {
    const result = await checkCssTokens({ ...CONFIG, cssDir: fixture(":root {\n  --text-hero: 3rem;\n}\n") });
    expect(result.findings).toEqual([]);
  });

  it("refuses a green verdict when the directory holds no stylesheet", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-css-tokens-empty-"));
    const result = await checkCssTokens({ ...CONFIG, cssDir: dir });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      `\`${dir}\` matched no stylesheet — refusing to report a green css-tokens gate that scanned nothing`,
    ]);
  });

  it("refuses a green verdict when the directory does not exist", async () => {
    const dir = resolve(mkdtempSync(resolve(tmpdir(), "forge-css-tokens-gone-")), "missing");
    const result = await checkCssTokens({ ...CONFIG, cssDir: dir });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      `\`${dir}\` matched no stylesheet — refusing to report a green css-tokens gate that scanned nothing`,
    ]);
  });

  it("reads a stylesheet nested below the configured directory", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-css-tokens-nested-"));
    mkdirSync(resolve(dir, "theme"));
    writeFileSync(resolve(dir, "theme/hero.css"), "@theme {\n  --text-hero: 3rem;\n}\n", "utf-8");
    const result = await checkCssTokens({ ...CONFIG, cssDir: dir });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.file)).toEqual([`${dir}/theme/hero.css`]);
  });
});
