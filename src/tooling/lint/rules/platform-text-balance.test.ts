import { describe, expect, it } from "bun:test";

import { attribute, call, element, literal, other, runRule } from "../test-support.ts";
import { platformTextBalance } from "./platform-text-balance.ts";

const CORPUS = "(forge-ui-platform-text-balance — src/ui/design/reference/16-platform.md)";

const detail = (size: string): string =>
  `\`${size}\` heading with no \`text-balance\` — balance the line breaks with \`text-wrap: balance\` ${CORPUS}`;

describe("platform-text-balance", () => {
  it("reports a display-sized heading with no `text-balance`", () => {
    expect(runRule(platformTextBalance, element("h1", attribute("class", literal("text-3xl font-semibold"))))).toEqual([detail("text-3xl")]);
  });

  it("reports `text-8xl` and `text-9xl`, the display sizes the enumeration stopped short of", () => {
    for (const size of ["text-8xl", "text-9xl"]) {
      expect(runRule(platformTextBalance, element("h1", attribute("class", literal(`${size} font-semibold`))))).toEqual([detail(size)]);
    }
  });

  it("accepts one that declares it", () => {
    expect(runRule(platformTextBalance, element("h1", attribute("class", literal("text-3xl text-balance"))))).toEqual([]);
  });

  it("reads the `text-balance` out of a sibling `cn()` argument — the whole reason it joins the expression", () => {
    const position = attribute("class", call("cn", literal("text-4xl font-semibold"), literal("text-balance")));

    expect(runRule(platformTextBalance, position)).toEqual([]);
  });

  it("leaves `text-xl` alone, which is below the display sizes the rule governs", () => {
    expect(runRule(platformTextBalance, element("h2", attribute("class", literal("text-xl font-semibold"))))).toEqual([]);
  });

  it("leaves a size named in prose outside every class position alone", () => {
    expect(runRule(platformTextBalance, other("VariableDeclarator", literal("the text-3xl heading in this sentence")))).toEqual([]);
  });

  it("reports once per class position, not once per literal in it", () => {
    expect(runRule(platformTextBalance, attribute("class", call("cn", literal("text-5xl"), literal("font-bold"))))).toHaveLength(1);
  });
});
