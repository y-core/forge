import { describe, expect, it } from "bun:test";
import {
  formatDuration,
  formatFailureExcerpt,
  formatFixSummary,
  formatFullLogPath,
  formatList,
  formatMissingRequirement,
  formatStepLine,
  formatSummary,
} from "./report";

// Every formatter here is pure, so each assertion is an exact-match on the whole string rather
// than a substring probe: a reporting contract asserted by `toContain` cannot catch a line that
// grew a second copy of what it names, which is the class of defect these formatters exist to
// prevent.

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
    // Without this, a step whose stream ends in newlines spends its whole window on nothing.
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

  // bug-260808-33. This is the mechanism itself, asserted rather than described: the excerpt is a
  // blind tail, so a signal that lands early is discarded no matter how large `tail` grows. That
  // is why the full-log path is printed beneath it — a bigger window is a probability reduction,
  // not a fix.
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
    expect(formatFixSummary("check", 2, 0)).toBe("2 fixed — re-run `bun run check` to confirm.");
  });

  it("counts the steps that had no fixer", () => {
    expect(formatFixSummary("check", 1, 5)).toBe("1 fixed, 5 without a fixer — re-run `bun run check` to confirm.");
  });
});

describe("formatMissingRequirement()", () => {
  it("names the absent tool and the exact command that installs it", () => {
    expect(formatMissingRequirement("test:browser", "chromium", "bun run test:install")).toBe(
      "✗ test:browser — chromium not found; run `bun run test:install`",
    );
  });
});
