import { describe, expect, it } from "bun:test";

import { attribute, literal, other, runRule } from "../test-support.ts";
import { colorTokenOnly } from "./color-token-only.ts";

const CORPUS = "(forge-ui-color-token-only — src/ui/design/floor.md)";

const raw = (hit: string): string => `raw colour literal \`${hit}\` in a class string — resolve the colour through a semantic token ${CORPUS}`;

describe("color-token-only", () => {
  it("reports a hex literal in a class string", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("bg-[#fff] flex")))).toEqual([raw("#fff")]);
  });

  it("reports each colour function form", () => {
    for (const hit of ["rgb(", "rgba(", "hsl(", "oklch("]) {
      expect(runRule(colorTokenOnly, attribute("class", literal(`bg-[${hit}0 0 0)]`)))).toEqual([raw(hit)]);
    }
  });

  it("reports each distinct literal once", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("bg-[#fff] text-[#fff] ring-[#000]")))).toEqual([raw("#fff"), raw("#000")]);
  });

  it("leaves a palette utility alone — that pattern is `forge-ui-color-theme-no-raw-utility`", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("bg-red-50 dark:bg-red-950")))).toEqual([]);
  });

  it("leaves a hex outside every class position alone, which is what the line scan could not do", () => {
    expect(runRule(colorTokenOnly, other("JSXAttribute", literal("#163030")))).toEqual([]);
  });

  it("reports a colour utility naming a custom property the theme declares no token for", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("bg-(--brand-ink)")))).toEqual([
      `\`bg-(--brand-ink)\` names a property the theme declares no colour token for ${CORPUS}`,
    ]);
  });

  it("accepts a colour utility naming a token the theme does declare", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("bg-(--color-primary)")))).toEqual([]);
  });

  it("reports a bare palette property, which the theme declares in its `--color-` form only", () => {
    for (const property of ["--red-500", "--zinc-500", "--white"]) {
      expect(runRule(colorTokenOnly, attribute("class", literal(`bg-(${property})`)))).toEqual([
        `\`bg-(${property})\` names a property the theme declares no colour token for ${CORPUS}`,
      ]);
    }
  });

  it("accepts a bare semantic property, which `theme-base.css` does declare", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("bg-(--primary) text-(--muted-foreground)")))).toEqual([]);
  });

  it("leaves a non-colour root's custom property alone", () => {
    expect(runRule(colorTokenOnly, attribute("class", literal("w-(--sidebar-width)")))).toEqual([]);
  });
});
