import { describe, expect, it } from "bun:test";
import { fail, warn } from "./finding";
import {
  formatDuration,
  formatFailureExcerpt,
  formatFindingBlock,
  formatFixSummary,
  formatFullLogPath,
  formatList,
  formatMissingRequirement,
  formatStepLine,
  formatSummary,
} from "./report";

describe("formatDuration()", () => {
  it("renders sub-50ms as `<0.1s` rather than a zero that reads as a broken timer", () => {
    expect(formatDuration(0)).toBe("<0.1s");
    expect(formatDuration(49)).toBe("<0.1s");
  });

  it("renders 50ms and above as tenths of a second", () => {
    expect(formatDuration(50)).toBe("0.1s");
    expect(formatDuration(700)).toBe("0.7s");
    expect(formatDuration(12_340)).toBe("12.3s");
  });
});

describe("formatStepLine()", () => {
  it("marks a passing step with ✓ and a failing step with ✗", () => {
    expect(formatStepLine("lint", true, 700)).toBe("✓ lint (0.7s)");
    expect(formatStepLine("lint", false, 700)).toBe("✗ lint (0.7s)");
  });
});

describe("formatFailureExcerpt()", () => {
  it("keeps only the last `tail` lines, indented as evidence", () => {
    const output = ["one", "two", "three", "four"].join("\n");

    expect(formatFailureExcerpt(output, 2)).toBe("    three\n    four");
  });

  it("drops trailing blank lines first, so `tail` counts content rather than whitespace", () => {
    const output = ["one", "two", "three", "", "", ""].join("\n");

    expect(formatFailureExcerpt(output, 2)).toBe("    two\n    three");
  });

  it("reports `(no output)` for a stream with no content at all", () => {
    expect(formatFailureExcerpt("", 40)).toBe("    (no output)");
    expect(formatFailureExcerpt("\n\n\n", 40)).toBe("    (no output)");
  });

  it("returns the whole stream when it is shorter than `tail`", () => {
    expect(formatFailureExcerpt("only", 40)).toBe("    only");
  });

  it("discards an early failure line that later noise pushes out of the window", () => {
    const output = ["(fail) parses a nested spread", ...Array.from({ length: 200 }, (_, i) => `noise ${i}`)].join("\n");

    const excerpt = formatFailureExcerpt(output, 120);

    expect(excerpt.includes("(fail) parses a nested spread")).toBe(false);
    expect(excerpt.split("\n").length).toBe(120);
  });
});

describe("formatFullLogPath()", () => {
  it("names the path verbatim, indented to sit under the excerpt it rescues", () => {
    expect(formatFullLogPath("/tmp/forge-gate-a1b2/test.log")).toBe("    full log at /tmp/forge-gate-a1b2/test.log");
  });
});

describe("formatSummary()", () => {
  it("names the failing step, which is what makes a verdict machine-readable", () => {
    expect(formatSummary({ gate: "check", ran: 3, selected: 7, total: 7, failedAt: "test", ms: 4200 })).toBe(
      "✗ check — failed at `test` (3 of 7 steps run, 4.2s)",
    );
  });

  it("reports a green with the step count and pluralises one step correctly", () => {
    expect(formatSummary({ gate: "check", ran: 7, selected: 7, total: 7, ms: 4200 })).toBe("✓ check — 7 steps passed (4.2s)");
    expect(formatSummary({ gate: "check", ran: 1, selected: 1, total: 1, ms: 4200 })).toBe("✓ check — 1 step passed (4.2s)");
  });

  it("appends the scoped banner to a green, so a scoped line never passes for a gate green", () => {
    expect(formatSummary({ gate: "check", ran: 2, selected: 2, total: 7, ms: 4200 })).toBe(
      "✓ check — 2 steps passed (4.2s) ⚠ scoped run (2 of 7 steps) — not the gate",
    );
  });

  it("appends the scoped banner to a failure too", () => {
    expect(formatSummary({ gate: "check", ran: 1, selected: 2, total: 7, failedAt: "lint", ms: 4200 })).toBe(
      "✗ check — failed at `lint` (1 of 2 steps run, 4.2s) ⚠ scoped run (2 of 7 steps) — not the gate",
    );
  });

  it("uses the gate verb verbatim, so `check` and `verify` stay distinguishable", () => {
    expect(formatSummary({ gate: "verify", ran: 8, selected: 8, total: 8, ms: 4200 })).toBe("✓ verify — 8 steps passed (4.2s)");
  });
});

describe("formatList()", () => {
  it("prints one label per line under a count header", () => {
    expect(formatList("check", ["typecheck", "lint"], 2)).toBe("check — 2 steps\n  typecheck\n  lint");
  });

  it("appends the scoped banner on its own line when the selection is narrower than the gate", () => {
    expect(formatList("check", ["lint"], 7)).toBe("check — 1 step\n  lint\n⚠ scoped run (1 of 7 steps) — not the gate");
  });
});

describe("formatFixSummary()", () => {
  it("ends by pointing at the run that proves something, since a fixer pass proves nothing", () => {
    expect(formatFixSummary("verify", 2, 0)).toBe("2 fixed — re-run `bun run verify` to confirm.");
  });

  it("counts the steps that had no fixer", () => {
    expect(formatFixSummary("verify", 1, 5)).toBe("1 fixed, 5 without a fixer — re-run `bun run verify` to confirm.");
  });
});

describe("formatMissingRequirement()", () => {
  it("names the absent tool and the exact command that installs it", () => {
    expect(formatMissingRequirement("test:browser", "chromium", "bun run test:install")).toBe(
      "✗ test:browser — chromium not found; run `bun run test:install`",
    );
  });
});

describe("formatFindingBlock()", () => {
  it("renders nothing for a check that found nothing, so a clean step stays one line", () => {
    expect(formatFindingBlock([])).toBe("");
  });

  it("indents each finding to the depth a command step's failure excerpt uses", () => {
    expect(formatFindingBlock([fail("barrel omits `parseThing`", { file: "src/pkg/mod.ts", line: 12 })])).toBe(
      "    FAIL src/pkg/mod.ts:12: barrel omits `parseThing`",
    );
  });

  it("indents a finding's evidence lines too, rather than letting them escape the block", () => {
    expect(formatFindingBlock([fail("two subpaths unresolved", { detail: ["./ui/show", "./ui/chrome"] })])).toBe(
      ["    FAIL: two subpaths unresolved", "        ./ui/show", "        ./ui/chrome"].join("\n"),
    );
  });

  it("keeps warnings in the block, since a passing step is the only place they are ever printed", () => {
    expect(formatFindingBlock([warn("622 lines exceeds the 600-line target", { file: "docs/A.md" })])).toBe(
      "    warn docs/A.md: 622 lines exceeds the 600-line target",
    );
  });

  it("renders every finding in order, never truncating to a tail the way captured output is", () => {
    const findings = Array.from({ length: 40 }, (_, index) => fail(`finding ${index}`));

    expect(formatFindingBlock(findings).split("\n")).toHaveLength(40);
  });
});
