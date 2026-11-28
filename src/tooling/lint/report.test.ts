import { describe, expect, it } from "bun:test";

import { defineLintRule } from "./report.ts";
import type { RuleContext, SourceLocation } from "./types.ts";

const LOC: SourceLocation = { start: { line: 7, column: 2 }, end: { line: 7, column: 9 } };

function capture(): { context: RuleContext; reported: { message: string; loc?: SourceLocation; node?: unknown }[] } {
  const reported: { message: string; loc?: SourceLocation; node?: unknown }[] = [];
  return {
    reported,
    context: { report: (diagnostic) => reported.push(diagnostic), sourceCode: { getDisableDirectives: () => ({ directives: [] }) } },
  };
}

describe("defineLintRule()", () => {
  it("prints `[id] detail` at the location, and neither plugin nor key — oxlint prints those", () => {
    const { context, reported } = capture();
    const rule = defineLintRule("forge-ui-spacing-scale-only", {
      create: (_context, report) => ({ Program: () => report("arbitrary value `p-[3px]` where a scale value exists", LOC) }),
    });

    rule.create(context).Program?.({ type: "Program", loc: LOC });

    expect(reported).toEqual([{ message: "[forge-ui-spacing-scale-only] arbitrary value `p-[3px]` where a scale value exists", loc: LOC }]);
  });

  it("reports at a node when handed one rather than a location", () => {
    const { context, reported } = capture();
    const node = { kind: "directive" };
    const rule = defineLintRule("forge-suppression-needs-reason", {
      create: (_context, report) => ({ Program: () => report("detail", { node }) }),
    });

    rule.create(context).Program?.({ type: "Program", loc: LOC });

    expect(reported).toEqual([{ message: "[forge-suppression-needs-reason] detail", node }]);
  });

  it("carries the id and the spec's meta, and hands the spec the linter's context", () => {
    const { context } = capture();
    const meta = { type: "problem", docs: { description: "d" } } as const;
    let handed: unknown;
    const rule = defineLintRule("forge-x-y", {
      meta,
      create: (given) => {
        handed = given;
        return {};
      },
    });

    rule.create(context);

    expect({ id: rule.id, meta: rule.meta, handed: handed === context }).toEqual({ id: "forge-x-y", meta, handed: true });
  });

  it("adds no `meta` key when the spec states none", () => {
    expect("meta" in defineLintRule("forge-x-y", { create: () => ({}) })).toBe(false);
  });
});
