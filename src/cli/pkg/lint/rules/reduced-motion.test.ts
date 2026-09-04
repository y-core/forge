import { describe, expect, it } from "bun:test";

import { attribute, call, literal, other, runRule } from "../test-support.ts";
import { reducedMotion } from "./reduced-motion.ts";

const CORPUS = "(forge-ui-reduced-motion — src/ui/design/floor.md)";

const detail = (token: string): string =>
  `\`${token}\` runs whatever the reader has asked for — author it inside \`motion-safe:\` and give \`motion-reduce:\` the settled state ${CORPUS}`;

describe("reduced-motion", () => {
  for (const [text, token] of [
    ["rounded-md bg-muted animate-pulse", "animate-pulse"],
    ["hover:animate-bounce", "hover:animate-bounce"],
    // The union the merge settled on: `design-parse.ts` matched `animate-*` only, so this one was
    // clean under it and reported under `modern-css-source-parse.ts`'s wider set.
    ["max-md:transition-[opacity,visibility]", "max-md:transition-[opacity,visibility]"],
    ["transition-colors duration-200", "transition-colors"],
  ] as const) {
    it(`reports \`${token}\``, () => {
      expect(runRule(reducedMotion, attribute("class", literal(text)))).toEqual([detail(token)]);
    });
  }

  for (const text of [
    "rounded-md bg-muted motion-safe:animate-pulse",
    "motion-reduce:animate-none",
    "animate-none",
    "transition-none",
    // The panel pattern: the motion is ungated on its own token and the settled state sits beside it.
    "max-md:transition-[transform,visibility] motion-reduce:max-md:transition-none",
  ]) {
    it(`leaves \`${text}\` alone`, () => {
      expect(runRule(reducedMotion, attribute("class", literal(text)))).toEqual([]);
    });
  }

  it("reads the gate out of a sibling `cn()` argument, which is why it joins the expression", () => {
    expect(runRule(reducedMotion, call("cn", literal("transition"), literal("motion-reduce:transition-none")))).toEqual([]);
  });

  it("reports each distinct token in one expression once", () => {
    expect(runRule(reducedMotion, attribute("class", literal("animate-spin animate-spin animate-pulse")))).toEqual([
      detail("animate-spin"),
      detail("animate-pulse"),
    ]);
  });

  it("leaves a class name mentioned in prose alone — the false positive that dominated the line scan", () => {
    expect(runRule(reducedMotion, other("VariableDeclarator", literal("animate-pulse is what the skeleton uses")))).toEqual([]);
  });
});
