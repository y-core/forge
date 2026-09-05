import { describe, expect, it } from "bun:test";

import { other, traverse } from "../test-support.ts";
import type { DisableDirective, RuleContext } from "../types.ts";
import { suppressionNeedsReason } from "./suppression-needs-reason.ts";

const directive = (type: string, value: string, justification: string): DisableDirective => ({
  type,
  value,
  justification,
  node: { directive: `${type} ${value}` },
});

interface Report {
  message: string;
  node: unknown;
}

function run(...directives: DisableDirective[]): Report[] {
  const reported: Report[] = [];
  const context: RuleContext = {
    report: ({ message, node }) => reported.push({ message, node }),
    sourceCode: { getDisableDirectives: () => ({ directives }) },
  };
  traverse(suppressionNeedsReason.create(context), other("Program"));
  return reported;
}

const messages = (...directives: DisableDirective[]): string[] => run(...directives).map((r) => r.message);

const detail = (type: string, named: string): string =>
  `\`oxlint-${type}\` for ${named} with no reason — append \` -- <why>\`, so the next reader can judge the suppression rather than only count it.`;

describe("suppression-needs-reason — meta", () => {
  it("is a problem, and says what the rule is for", () => {
    expect(suppressionNeedsReason.meta).toEqual({
      type: "problem",
      docs: { description: "Every `oxlint-disable` directive states why, so a suppression can be judged rather than only counted." },
    });
  });

  it("listens on Program alone, so the directives are read once per file", () => {
    const visitor = suppressionNeedsReason.create({ report: () => undefined, sourceCode: { getDisableDirectives: () => ({ directives: [] }) } });
    expect(Object.keys(visitor)).toEqual(["Program"]);
  });
});

describe("suppression-needs-reason — reports", () => {
  it("reports a rule-scoped suppression with no reason, naming the rule", () => {
    expect(messages(directive("disable-next-line", "no-console", ""))).toEqual([detail("disable-next-line", "`no-console`")]);
  });

  it("reports a blanket suppression as covering every rule", () => {
    expect(messages(directive("disable", "", ""))).toEqual([detail("disable", "every rule")]);
  });

  // A justification of spaces alone: the `--` was written and nothing followed it.
  it("reports a justification that is only whitespace", () => {
    expect(messages(directive("disable-line", "no-explicit-any", "   \t "))).toEqual([detail("disable-line", "`no-explicit-any`")]);
  });

  it("names a multi-rule value verbatim", () => {
    expect(messages(directive("disable", "no-console, no-debugger", ""))).toEqual([detail("disable", "`no-console, no-debugger`")]);
  });

  for (const type of ["disable", "disable-line", "disable-next-line", "enable"]) {
    it(`names the ${type} form in its own message`, () => {
      expect(messages(directive(type, "no-console", ""))).toEqual([detail(type, "`no-console`")]);
    });
  }

  it("hands back the directive's own node, so the report lands on the comment", () => {
    const unjustified = directive("disable", "no-console", "");
    expect(run(unjustified)[0]?.node).toBe(unjustified.node);
  });
});

describe("suppression-needs-reason — leaves alone", () => {
  it("accepts a suppression that states why", () => {
    expect(messages(directive("disable-next-line", "no-console", " the CLI writes to stdout by design"))).toEqual([]);
  });

  it("accepts a blanket suppression that states why", () => {
    expect(messages(directive("disable", "", "generated file"))).toEqual([]);
  });

  it("reports nothing for a file with no directives at all", () => {
    expect(messages()).toEqual([]);
  });
});

describe("suppression-needs-reason — several directives", () => {
  it("reports only the unjustified ones, in the order the file wrote them", () => {
    expect(
      messages(
        directive("disable", "no-console", "the CLI writes to stdout"),
        directive("disable-line", "no-explicit-any", ""),
        directive("disable-next-line", "", ""),
        directive("enable", "no-console", "restored"),
      ),
    ).toEqual([detail("disable-line", "`no-explicit-any`"), detail("disable-next-line", "every rule")]);
  });

  it("reports every one of them when none states a reason", () => {
    expect(messages(directive("disable", "a", ""), directive("disable", "b", ""), directive("disable", "c", ""))).toEqual([
      detail("disable", "`a`"),
      detail("disable", "`b`"),
      detail("disable", "`c`"),
    ]);
  });
});
