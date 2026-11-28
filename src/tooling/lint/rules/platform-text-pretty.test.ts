import { describe, expect, it } from "bun:test";

import { attribute, call, element, literal, other, runRule } from "../lint.fixture.ts";
import { platformTextPretty } from "./platform-text-pretty.ts";

const PREFIX = "[forge-ui-platform-text-pretty] ";

const detail = (hit: string): string => `${PREFIX}\`${hit}\` prose with no \`text-pretty\` — avoid the orphan with \`text-wrap: pretty\``;

describe("platform-text-pretty", () => {
  it("reports prose with no `text-pretty`", () => {
    expect(runRule(platformTextPretty, element("p", attribute("class", literal("max-w-prose text-sm"))))).toEqual([detail("max-w-prose")]);
  });

  it("reports `prose` and `leading-relaxed` too", () => {
    for (const hit of ["prose", "leading-relaxed"]) {
      expect(runRule(platformTextPretty, element("p", attribute("class", literal(`${hit} text-sm`))))).toEqual([detail(hit)]);
    }
  });

  it("accepts prose that declares it", () => {
    expect(runRule(platformTextPretty, element("p", attribute("class", literal("max-w-prose text-pretty"))))).toEqual([]);
  });

  it("reads the `text-pretty` out of a sibling `cn()` argument", () => {
    expect(runRule(platformTextPretty, attribute("class", call("cn", literal("prose"), literal("text-pretty"))))).toEqual([]);
  });

  it("leaves the word `prose` in an ordinary sentence alone — the false positive that dominated the line scan", () => {
    expect(runRule(platformTextPretty, other("CallExpression", literal("the intro prose reads well")))).toEqual([]);
  });
});
