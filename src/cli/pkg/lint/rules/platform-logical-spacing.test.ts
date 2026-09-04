import { describe, expect, it } from "bun:test";

import { attribute, call, literal, other, runRule } from "../test-support.ts";
import { logicalUtility, platformLogicalSpacing } from "./platform-logical-spacing.ts";

const CORPUS = "(forge-ui-platform-logical-spacing — src/ui/design/reference/16-platform.md)";

const detail = (physical: string, logical: string): string => `physical utility \`${physical}\` — use \`${logical}\` ${CORPUS}`;

describe("logicalUtility()", () => {
  const swaps: [string, string][] = [
    ["ml-2", "ms-2"],
    ["mr-2", "me-2"],
    ["pl-4", "ps-4"],
    ["pr-10", "pe-10"],
    ["border-l", "border-s"],
    ["border-r-2", "border-e-2"],
    ["rounded-l-md", "rounded-s-md"],
    ["rounded-r", "rounded-e"],
    ["text-left", "text-start"],
    ["text-right", "text-end"],
    ["first:md:rounded-l-md", "first:md:rounded-s-md"],
    ["-ml-4", "-ms-4"],
    ["hover:-mr-2", "hover:-me-2"],
  ];

  for (const [physical, logical] of swaps) {
    it(`maps ${physical} to ${logical}`, () => {
      expect(logicalUtility(physical)).toBe(logical);
    });
  }
});

describe("platform-logical-spacing", () => {
  it("reports a physical utility in a class literal", () => {
    expect(runRule(platformLogicalSpacing, attribute("class", literal("flex items-center pr-10")))).toEqual([detail("pr-10", "pe-10")]);
  });

  it("keeps the variant prefix in both spellings", () => {
    expect(runRule(platformLogicalSpacing, attribute("class", literal("flex first:rounded-l-md")))).toEqual([
      detail("first:rounded-l-md", "first:rounded-s-md"),
    ]);
  });

  it("reports a fractional value, which no anchor test accepts", () => {
    expect(runRule(platformLogicalSpacing, attribute("class", literal("ml-0.5 text-destructive")))).toEqual([detail("ml-0.5", "ms-0.5")]);
  });

  it("reports a negative inline margin, which matched at no offset before", () => {
    expect(runRule(platformLogicalSpacing, attribute("class", literal("flex -ml-4 hover:-mr-2")))).toEqual([
      detail("-ml-4", "-ms-4"),
      detail("hover:-mr-2", "hover:-me-2"),
    ]);
  });

  it("reaches a guarded argument of a wrapped `cn()` call", () => {
    const position = attribute("class", call("cn", literal("relative flex w-full"), other("LogicalExpression", literal("pr-10"))));

    expect(runRule(platformLogicalSpacing, position)).toEqual([detail("pr-10", "pe-10")]);
  });

  it("reports each distinct utility in one literal once", () => {
    expect(runRule(platformLogicalSpacing, attribute("class", literal("pl-2 pl-2 mr-1")))).toEqual([
      detail("pl-2", "ps-2"),
      detail("mr-1", "me-1"),
    ]);
  });

  it("leaves `rounded-lg` alone, which is a radius and not a side", () => {
    expect(runRule(platformLogicalSpacing, attribute("class", literal("flex rounded-lg border-lime-500")))).toEqual([]);
  });

  it("leaves prose that merely contains a utility-shaped word alone", () => {
    expect(runRule(platformLogicalSpacing, other("VariableDeclarator", literal("the pr-10 in this sentence is prose")))).toEqual([]);
  });

  it("leaves a string outside every class position alone — the anchor heuristic the line scan needed is gone", () => {
    expect(runRule(platformLogicalSpacing, other("VariableDeclarator", literal("flex items-center pr-10")))).toEqual([]);
  });
});
