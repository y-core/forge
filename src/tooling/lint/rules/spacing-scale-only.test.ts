import { describe, expect, it } from "bun:test";

import { attribute, literal, other, property, runRule } from "../test-support.ts";
import { spacingScaleOnly } from "./spacing-scale-only.ts";

const CORPUS = "(forge-ui-spacing-scale-only — src/ui/design/floor.md)";

const detail = (written: string, scale: string): string => `arbitrary value \`${written}\` where the scale states \`${scale}\` ${CORPUS}`;

describe("spacing-scale-only", () => {
  it("reports a pixel value the scale already states", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("p-[8px] flex")))).toEqual([detail("p-[8px]", "p-2")]);
  });

  it("reports a rem value the scale already states, converted through `--spacing`", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("mt-[1.5rem]")))).toEqual([detail("mt-[1.5rem]", "mt-6")]);
  });

  it("keeps the sign, so the suggestion is the utility that would be written", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("-ml-[4px]")))).toEqual([detail("-ml-[4px]", "-ml-1")]);
  });

  it("reads the sign of a negative arbitrary value, which Tailwind compiles as the offset", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("mt-[-16px]")))).toEqual([detail("mt-[-16px]", "-mt-4")]);
  });

  it("cancels the two signs, since `-mt-[-16px]` compiles to a positive offset", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("-mt-[-16px]")))).toEqual([detail("-mt-[-16px]", "mt-4")]);
  });

  it("reports through a variant chain, which does not change what the value is", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("md:gap-[12px]")))).toEqual([detail("gap-[12px]", "gap-3")]);
  });

  it("leaves a value the scale has no step for alone — the whole point of deriving the steps", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("text-[11px] p-[3px]")))).toEqual([]);
  });

  it("leaves a root that takes no spacing value alone — `leading-4` does read the scale, `shadow-4` does not", () => {
    expect(runRule(spacingScaleOnly, attribute("class", literal("shadow-[8px] duration-[200px]")))).toEqual([]);
  });

  it("leaves an arbitrary value that is not a length alone", () => {
    for (const text of ["w-[calc(100%-2rem)]", "max-h-[inherit]", "max-h-[60vh]", "[&_svg]:size-4", "data-[slot~=control]:w-full"]) {
      expect(runRule(spacingScaleOnly, attribute("class", literal(text)))).toEqual([]);
    }
  });

  it("reads a `class:` object property, which is how a forge component is handed its classes", () => {
    expect(runRule(spacingScaleOnly, property("class", literal("h-[80px]")))).toEqual([detail("h-[80px]", "h-20")]);
  });

  it("leaves a string outside every class position alone", () => {
    expect(runRule(spacingScaleOnly, other("VariableDeclarator", literal("p-[8px]")))).toEqual([]);
  });
});
