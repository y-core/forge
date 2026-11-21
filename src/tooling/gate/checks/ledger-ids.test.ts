import { describe, expect, it } from "bun:test";

import { validateCommentBudget } from "./comment-budget-parse";
import { LEDGER_ID } from "./ledger-ids";

// Assembled, so this file carries no id for the scan it tests to find.
const id = (type: string, ordinal = "07"): string => [type, "261121", ordinal].join("-");
const ledgerFindings = (file: string, source: string) =>
  validateCommentBudget(file, source).filter((finding) => finding.message.startsWith("ledger id"));

describe("LEDGER_ID", () => {
  for (const type of ["bug", "feat", "chore", "spike", "decision"]) {
    it(`matches a ${type} id`, () => {
      expect(LEDGER_ID.exec(`see ${id(type)} for why`)?.[0]).toBe(id(type));
    });
  }

  it("matches an ordinal past two digits", () => {
    expect(LEDGER_ID.test(id("bug", "123"))).toBe(true);
  });

  for (const text of ["feat-YYMMDD-NN", "bug-26112-07", "feat-261121-7", "prefeat-261121-07x", "task-261121-07"]) {
    it(`passes ${text}, which is no ledger id`, () => {
      expect(LEDGER_ID.test(text)).toBe(false);
    });
  }
});

describe("the comment budget's ledger-id rule", () => {
  it("fails a line comment carrying an id, naming the rule", () => {
    const findings = ledgerFindings("a.ts", `// Kept for ${id("bug")}.\nexport const a = 1;\n`);
    expect(findings.map((finding) => [finding.line, finding.message])).toEqual([
      [1, `ledger id \`${id("bug")}\` — a comment states the reason, not the ledger row that recorded it`],
    ]);
  });

  it("reports an id on the line of a block comment it sits on", () => {
    const findings = ledgerFindings("a.ts", `export const a = 1;\n/*\n * Why this.\n * Filed as ${id("feat")}.\n */\n`);
    expect(findings.map((finding) => finding.line)).toEqual([4]);
  });

  it("fails an id in a tooling directive, which is exempt from the budget but not from this", () => {
    const findings = ledgerFindings("a.ts", `/*\n-- row-removal-authorised-by: ${id("decision")}\n*/\nexport const a = 1;\n`);
    expect(findings).toHaveLength(1);
  });

  it("passes the placeholder spelling that documents the format", () => {
    expect(ledgerFindings("a.ts", "// A task id reads feat-YYMMDD-NN.\nexport const a = 1;\n")).toEqual([]);
  });

  it("passes an id inside a string literal, which is data rather than a comment", () => {
    expect(ledgerFindings("a.ts", `export const fixture = "${id("chore")}";\n`)).toEqual([]);
  });
});
