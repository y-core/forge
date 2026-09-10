import { describe, expect, it } from "bun:test";

import { createColorize } from "../term/color";
import { checkResult, fail, warn } from "./finding";
import {
  formatDuration,
  formatFailureExcerpt,
  formatFindingBlock,
  formatFixSummary,
  formatFullLogPath,
  formatList,
  formatMissingRequirement,
  listLabel,
  formatScopedBanner,
  formatStepLine,
  formatSummary,
} from "./report";
import type { Step } from "./types";

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
  it("names the failing step and its position, which is what makes a verdict machine-readable", () => {
    expect(formatSummary({ gate: "check", passed: 2, skipped: 0, selected: 7, total: 7, failedAt: { label: "test", at: 3 }, ms: 4200 })).toBe(
      "✗ check — failed at `test` (step 3 of 7, 4.2s)",
    );
  });

  it("counts the skipped steps in a failure line too, so the position is read against them", () => {
    expect(formatSummary({ gate: "verify", passed: 2, skipped: 2, selected: 7, total: 7, failedAt: { label: "test", at: 5 }, ms: 4200 })).toBe(
      "✗ verify — failed at `test` (step 5 of 7, 2 skipped, 4.2s)",
    );
  });

  it("builds the green line from the steps that passed, pluralising one step correctly", () => {
    expect(formatSummary({ gate: "check", passed: 7, skipped: 0, selected: 7, total: 7, ms: 4200 })).toBe("✓ check — 7 steps passed (4.2s)");
    expect(formatSummary({ gate: "check", passed: 1, skipped: 0, selected: 1, total: 1, ms: 4200 })).toBe("✓ check — 1 step passed (4.2s)");
  });

  it("reports the skipped steps beside the passed ones, never folding them into the count", () => {
    expect(formatSummary({ gate: "verify", passed: 5, skipped: 2, selected: 7, total: 7, ms: 4200 })).toBe(
      "✓ verify — 5 steps passed, 2 skipped (4.2s)",
    );
  });

  it("refuses a green when every selected step was skipped, as the selection refuses an empty run", () => {
    expect(formatSummary({ gate: "verify", passed: 0, skipped: 3, selected: 3, total: 3, ms: 400 })).toBe(
      "✗ verify — every step skipped (0 of 3 ran, 0.4s) — refusing to report a green gate that ran nothing",
    );
  });

  it("appends the scoped banner to a green, so a scoped line never passes for a gate green", () => {
    expect(formatSummary({ gate: "check", passed: 2, skipped: 0, selected: 2, total: 7, ms: 4200 })).toBe(
      "✓ check — 2 steps passed (4.2s) ⚠ scoped run (2 of 7 steps) — not the gate",
    );
  });

  it("appends the scoped banner to a failure too", () => {
    expect(formatSummary({ gate: "check", passed: 0, skipped: 0, selected: 2, total: 7, failedAt: { label: "lint", at: 1 }, ms: 4200 })).toBe(
      "✗ check — failed at `lint` (step 1 of 2, 4.2s) ⚠ scoped run (2 of 7 steps) — not the gate",
    );
  });

  it("uses the gate verb verbatim, so `check` and `verify` stay distinguishable", () => {
    expect(formatSummary({ gate: "verify", passed: 8, skipped: 0, selected: 8, total: 8, ms: 4200 })).toBe("✓ verify — 8 steps passed (4.2s)");
  });
});

describe("listLabel()", () => {
  const conditional: Step = { label: "validate-class-groups", run: () => checkResult([], ""), requires: { tool: "tailwindcss", hint: "x" } };

  it("marks a step with a dependency as conditional below the full tier, naming the dependency", () => {
    expect(listLabel(conditional, "fast")).toBe("validate-class-groups (conditional — tailwindcss required)");
    expect(listLabel(conditional, "standard")).toBe("validate-class-groups (conditional — tailwindcss required)");
  });

  it("states the dependency as required in a full run, where its absence is a failure", () => {
    expect(listLabel({ label: "test:browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "x" } }, "full")).toBe(
      "test:browser (requires chromium)",
    );
  });

  it("leaves a step with no dependency its bare label in every mode", () => {
    expect(listLabel({ label: "lint", tail: 10, cmd: ["oxlint"] }, "fast")).toBe("lint");
    expect(listLabel({ label: "lint", tail: 10, cmd: ["oxlint"] }, "standard")).toBe("lint");
    expect(listLabel({ label: "lint", tail: 10, cmd: ["oxlint"] }, "full")).toBe("lint");
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
    expect(formatFixSummary({ gate: "verify", fixed: 2, unfixable: 0, skipped: 0 })).toBe("2 fixed — re-run `bun run verify` to confirm.");
  });

  it("counts the steps that had no fixer apart from the ones a missing dependency skipped", () => {
    expect(formatFixSummary({ gate: "verify", fixed: 1, unfixable: 5, skipped: 1 })).toBe(
      "1 fixed, 5 without a fixer, 1 skipped — re-run `bun run verify` to confirm.",
    );
  });
});

describe("formatMissingRequirement()", () => {
  it("fails the step in a full run, naming the absent tool and the remedy verbatim", () => {
    expect(formatMissingRequirement("test:browser", "chromium", "run `bunx playwright install chromium`", "full")).toBe(
      "✗ test:browser — chromium not found; run `bunx playwright install chromium`",
    );
  });

  it("reports the same event as a skip below the full tier, carrying the remedy with it", () => {
    expect(formatMissingRequirement("validate-class-groups", "tailwindcss", "run `bun add -d tailwindcss`", "standard")).toBe(
      "○ validate-class-groups — skipped (tailwindcss not found; run `bun add -d tailwindcss`)",
    );
    expect(formatMissingRequirement("validate-class-groups", "tailwindcss", "run `bun add -d tailwindcss`", "fast")).toBe(
      "○ validate-class-groups — skipped (tailwindcss not found; run `bun add -d tailwindcss`)",
    );
  });

  it("prints a multi-route remedy unwrapped, since not every remedy is a single command", () => {
    expect(formatMissingRequirement("test:browser", "chromium", "run `a`, or use a devbox container — `devctl up`", "full")).toBe(
      "✗ test:browser — chromium not found; run `a`, or use a devbox container — `devctl up`",
    );
  });
});

describe("formatFindingBlock()", () => {
  it("renders nothing for a check that found nothing, so a clean step stays one line", () => {
    expect(formatFindingBlock([])).toBe("");
  });

  it("indents each finding to the depth a command step's failure excerpt uses", () => {
    expect(formatFindingBlock([fail("barrel omits `parseThing`", { file: "src/tooling/gate/mod.ts", line: 12 })])).toBe(
      "    FAIL src/tooling/gate/mod.ts:12: barrel omits `parseThing`",
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

describe("report colour", () => {
  const style = createColorize(1);

  it("greens the tick on a passing step", () => {
    expect(formatStepLine("lint", true, 700, style)).toBe(`${style.green("✓")} lint (0.7s)`);
  });

  it("reds the cross on a failing step", () => {
    expect(formatStepLine("lint", false, 700, style)).toBe(`${style.red("✗")} lint (0.7s)`);
  });

  it("yellows the scoped-run warning", () => {
    expect(formatScopedBanner(1, 15, style)).toBe(`${style.yellow("⚠")} scoped run (1 of 15 steps) — not the gate`);
  });

  it("carries the styler into the banner a summary appends", () => {
    expect(formatSummary({ gate: "verify", passed: 1, skipped: 0, selected: 1, total: 15, ms: 100 }, style)).toBe(
      `${style.green("✓")} verify — 1 step passed (0.1s) ${style.yellow("⚠")} scoped run (1 of 15 steps) — not the gate`,
    );
  });

  it("emits nothing but text when no styler is given", () => {
    expect(formatStepLine("lint", true, 700)).toBe("✓ lint (0.7s)");
  });
});
