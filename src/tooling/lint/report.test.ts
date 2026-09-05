import { describe, expect, it } from "bun:test";

import { reporter } from "./report.ts";
import type { RuleContext, SourceLocation } from "./types.ts";

const LOC: SourceLocation = { start: { line: 7, column: 2 }, end: { line: 7, column: 9 } };

function capture(): { context: RuleContext; reported: { message: string; loc?: SourceLocation }[] } {
  const reported: { message: string; loc?: SourceLocation }[] = [];
  return {
    reported,
    context: {
      report: (diagnostic) => reported.push({ message: diagnostic.message, ...(diagnostic.loc ? { loc: diagnostic.loc } : {}) }),
      sourceCode: { getDisableDirectives: () => ({ directives: [] }) },
    },
  };
}

describe("reporter()", () => {
  it("cites the corpus id and the file that states it, and neither plugin nor key — oxlint prints those", () => {
    const { context, reported } = capture();

    reporter(context, "forge-ui-spacing-scale-only")("arbitrary value `p-[3px]` where a scale value exists", LOC);

    expect(reported).toEqual([
      { message: "arbitrary value `p-[3px]` where a scale value exists (forge-ui-spacing-scale-only — src/ui/design/floor.md)", loc: LOC },
    ]);
  });

  it("routes each id to its own corpus file", () => {
    const { context, reported } = capture();

    reporter(context, "forge-ui-a11y-heading-size-by-class")("detail", LOC);

    expect(reported[0]?.message).toBe("detail (forge-ui-a11y-heading-size-by-class — src/ui/design/reference/10-accessibility.md)");
  });
});
