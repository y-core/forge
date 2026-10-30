import { describe, expect, it } from "bun:test";

import { createColorize } from "../term/color";
import { checkResult, fail, warn } from "./finding";
import {
  formatDuration,
  formatFailureExcerpt,
  formatFindingBlock,
  formatFixSummary,
  formatFullLogPath,
  formatLeftInTemp,
  formatList,
  formatMissingRequirement,
  formatNothingAffected,
  formatReceiptWithheld,
  formatReused,
  formatReuseMiss,
  listLabel,
  formatScopedBanner,
  formatStepLine,
  formatSummary,
  formatUntouched,
} from "./report";
import { GATE_TIERS } from "./types";
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

describe("formatLeftInTemp()", () => {
  it("names every entry, in the order given", () => {
    expect(formatLeftInTemp(["forge-a", "forge-b"])).toBe("left in its TMPDIR: forge-a, forge-b");
  });
});

describe("formatFullLogPath()", () => {
  it("names the path verbatim, indented to sit under the excerpt it rescues", () => {
    expect(formatFullLogPath("/tmp/forge-gate-a1b2/test.log")).toBe("    full log at /tmp/forge-gate-a1b2/test.log");
  });
});

describe("formatSummary()", () => {
  it("names the failing step and its position, which is what makes a verdict machine-readable", () => {
    expect(
      formatSummary({ gate: "check", passed: 2, skipped: 0, selected: 7, total: 7, scoped: false, failedAt: { label: "test", at: 3 }, ms: 4200 }),
    ).toBe("✗ check — failed at `test` (step 3 of 7, 4.2s)");
  });

  it("counts the skipped steps in a failure line too, so the position is read against them", () => {
    expect(
      formatSummary({ gate: "verify", passed: 2, skipped: 2, selected: 7, total: 7, scoped: false, failedAt: { label: "test", at: 5 }, ms: 4200 }),
    ).toBe("✗ verify — failed at `test` (step 5 of 7, 2 skipped, 4.2s)");
  });

  it("builds the green line from the steps that passed, pluralising one step correctly", () => {
    expect(formatSummary({ gate: "check", passed: 7, skipped: 0, selected: 7, total: 7, scoped: false, ms: 4200 })).toBe(
      "✓ check — 7 steps passed (4.2s)",
    );
    expect(formatSummary({ gate: "check", passed: 1, skipped: 0, selected: 1, total: 1, scoped: false, ms: 4200 })).toBe(
      "✓ check — 1 step passed (4.2s)",
    );
  });

  it("refuses a green for a run that skipped a step, since a skip is work the gate did not do", () => {
    expect(formatSummary({ gate: "verify", passed: 5, skipped: 2, selected: 7, total: 7, scoped: false, ms: 4200 })).toBe(
      "○ verify — 5 steps passed, 2 steps skipped (4.2s) — not green: 2 steps never ran; install what each skip line above names",
    );
  });

  it("says the same of a single skip, in the singular", () => {
    expect(formatSummary({ gate: "verify", passed: 5, skipped: 1, selected: 6, total: 6, scoped: false, ms: 4200 })).toBe(
      "○ verify — 5 steps passed, 1 step skipped (4.2s) — not green: 1 step never ran; install what each skip line above names",
    );
  });

  it("refuses a green when every selected step was skipped, as the selection refuses an empty run", () => {
    expect(formatSummary({ gate: "verify", passed: 0, skipped: 3, selected: 3, total: 3, scoped: false, ms: 400 })).toBe(
      "✗ verify — every step skipped (0 of 3 ran, 0.4s) — refusing to report a green gate that ran nothing",
    );
  });

  it("appends the scoped banner to a green, so a scoped line never passes for a gate green", () => {
    expect(formatSummary({ gate: "check", passed: 2, skipped: 0, selected: 2, total: 7, scoped: true, ms: 4200 })).toBe(
      "✓ check — 2 steps passed (4.2s) ⚠ scoped run (2 of 7 steps) — not the gate",
    );
  });

  it("appends the scoped banner to a failure too", () => {
    expect(
      formatSummary({ gate: "check", passed: 0, skipped: 0, selected: 2, total: 7, scoped: true, failedAt: { label: "lint", at: 1 }, ms: 4200 }),
    ).toBe("✗ check — failed at `lint` (step 1 of 2, 4.2s) ⚠ scoped run (2 of 7 steps) — not the gate");
  });

  it("appends the banner when the run was scoped, even with every step selected", () => {
    expect(formatSummary({ gate: "verify --affected", passed: 3, skipped: 0, selected: 3, total: 3, scoped: true, ms: 4200 })).toBe(
      "✓ verify --affected — 3 steps passed (4.2s) ⚠ scoped run (3 of 3 steps) — not the gate",
    );
  });

  it("appends no banner when the run was not scoped", () => {
    expect(formatSummary({ gate: "verify", passed: 3, skipped: 0, selected: 3, total: 3, scoped: false, ms: 4200 })).toBe(
      "✓ verify — 3 steps passed (4.2s)",
    );
  });

  it("uses the gate verb verbatim, so `check` and `verify` stay distinguishable", () => {
    expect(formatSummary({ gate: "verify", passed: 8, skipped: 0, selected: 8, total: 8, scoped: false, ms: 4200 })).toBe(
      "✓ verify — 8 steps passed (4.2s)",
    );
  });
});

describe("listLabel()", () => {
  const conditional: Step = { label: "validate-class-groups", run: () => checkResult([], ""), requires: { tool: "tailwindcss", hint: "x" } };

  it("marks a step with a dependency as conditional below the runtime tier, naming the dependency", () => {
    expect(listLabel(conditional, "static")).toBe("validate-class-groups (conditional — tailwindcss required)");
    expect(listLabel(conditional, "unit")).toBe("validate-class-groups (conditional — tailwindcss required)");
  });

  it("states the dependency as required from the runtime tier up, where its absence is a failure", () => {
    const browser: Step = { label: "test:browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "x" } };

    for (const tier of ["runtime", "release"] as const) expect(listLabel(browser, tier)).toBe("test:browser (requires chromium)");
  });

  it("leaves a step with no dependency its bare label in every tier", () => {
    for (const tier of GATE_TIERS) expect(listLabel({ label: "lint", tail: 10, cmd: ["oxlint"] }, tier)).toBe("lint");
  });

  it("says how a narrowed or untouched step reaches the pending changes, ahead of its dependency", () => {
    const browser: Step = { label: "test:browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "x" } };

    expect(listLabel(browser, "runtime", "narrow")).toBe("test:browser (narrowed to pending changes) (requires chromium)");
    expect(listLabel({ label: "db:lint", tail: 10, cmd: ["forge"] }, "runtime", "untouched")).toBe("db:lint (untouched)");
  });
});

describe("formatList()", () => {
  it("prints one label per line under a count header", () => {
    expect(formatList("check", ["typecheck", "lint"], { total: 2, scoped: false })).toBe("check — 2 steps\n  typecheck\n  lint");
  });

  it("appends the scoped banner on its own line when the selection is scoped", () => {
    expect(formatList("check", ["lint"], { total: 7, scoped: true })).toBe("check — 1 step\n  lint\n⚠ scoped run (1 of 7 steps) — not the gate");
  });

  it("brands a selection scoped even when it holds every step, as an --affected one does", () => {
    expect(formatList("verify --affected", ["lint"], { total: 1, scoped: true })).toBe(
      "verify --affected — 1 step\n  lint\n⚠ scoped run (1 of 1 steps) — not the gate",
    );
  });
});

describe("formatFixSummary()", () => {
  it("ends by pointing at the run that proves something, since a fixer pass proves nothing", () => {
    expect(formatFixSummary({ gate: "verify", fixed: 2, unfixable: 0, skipped: 0 })).toBe("2 fixed — re-run `bun run verify` to confirm.");
  });

  it("counts the steps that had no fixer apart from the ones a missing dependency skipped, and names the skip as unfixed", () => {
    expect(formatFixSummary({ gate: "verify", fixed: 1, unfixable: 5, skipped: 1 })).toBe(
      "1 fixed, 5 without a fixer, 1 step skipped — that step was not fixed; install what each skip line above names, then re-run `bun run verify`.",
    );
  });
});

describe("formatMissingRequirement()", () => {
  it("fails the step from the runtime tier up, naming the absent tool and the remedy verbatim", () => {
    for (const tier of ["runtime", "release"] as const) {
      expect(formatMissingRequirement("test:browser", "Playwright server", "set `PW_TEST_CONNECT_WS_ENDPOINT`", tier)).toBe(
        "✗ test:browser — Playwright server not found; set `PW_TEST_CONNECT_WS_ENDPOINT`",
      );
    }
  });

  it("reports the same event as a skip below the runtime tier, carrying the remedy with it", () => {
    expect(formatMissingRequirement("validate-class-groups", "tailwindcss", "run `bun add -d tailwindcss`", "unit")).toBe(
      "○ validate-class-groups — skipped (tailwindcss not found; run `bun add -d tailwindcss`)",
    );
    expect(formatMissingRequirement("validate-class-groups", "tailwindcss", "run `bun add -d tailwindcss`", "static")).toBe(
      "○ validate-class-groups — skipped (tailwindcss not found; run `bun add -d tailwindcss`)",
    );
  });

  it("prints a multi-route remedy unwrapped, since not every remedy is a single command", () => {
    expect(formatMissingRequirement("validate-class-groups", "tailwindcss", "run `a`, or set `TAILWIND_PATH`", "release")).toBe(
      "✗ validate-class-groups — tailwindcss not found; run `a`, or set `TAILWIND_PATH`",
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
    expect(formatFindingBlock([fail("two subpaths unresolved", { detail: ["./ui/gallery", "./ui/chrome"] })])).toBe(
      ["    FAIL: two subpaths unresolved", "        ./ui/gallery", "        ./ui/chrome"].join("\n"),
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

describe("formatReused()", () => {
  const tree = "0123456789abcdef0123456789abcdef01234567";

  it("names the tier and the full hash of the run it stands on, and says no step ran", () => {
    expect(formatReused("verify", { tree, tier: "release", labels: ["lint"] })).toBe(
      `✓ verify — reused the passing release run of tree ${tree}; no step ran`,
    );
  });
});

describe("formatReuseMiss()", () => {
  it("says the tree has no passing run on record at the requested tier", () => {
    expect(formatReuseMiss({ tree: "abc123", tier: "runtime" })).toBe(
      "○ no passing run of tree abc123 on record at runtime or above; running the gate",
    );
  });

  it("says there is no work tree when the hash is undefined", () => {
    expect(formatReuseMiss({ tree: undefined, tier: "runtime" })).toBe("○ not a git work tree — no receipt to reuse; running the gate");
  });
});

describe("formatUntouched()", () => {
  it("says how many pending changes left the step with nothing to run", () => {
    expect(formatUntouched("test:workerd", 3)).toBe("○ test:workerd — untouched by 3 changes");
    expect(formatUntouched("db:lint", 1)).toBe("○ db:lint — untouched by 1 change");
  });

  it("names the probe that found nothing selected, so the reader can ask it again", () => {
    expect(formatUntouched("test:workerd", 2, undefined, "playwright test --project=workerd --only-changed --list")).toBe(
      "○ test:workerd — untouched by 2 changes: `playwright test --project=workerd --only-changed --list` selects nothing",
    );
  });
});

describe("formatReceiptWithheld()", () => {
  it("says the tree moved under the run, so nothing was recorded", () => {
    expect(formatReceiptWithheld()).toBe("○ the tree changed during the run — no receipt written");
  });
});

describe("formatNothingAffected()", () => {
  it("says a tree with no change ran nothing, under the scoped banner", () => {
    expect(formatNothingAffected("verify --affected", { changed: 0, total: 36 })).toBe(
      "○ verify --affected — no change against HEAD; nothing ran ⚠ scoped run (0 of 36 steps) — not the gate",
    );
  });

  it("says one changed path touches no step, in the singular", () => {
    expect(formatNothingAffected("verify --affected", { changed: 1, total: 36 })).toBe(
      "○ verify --affected — 1 changed path touches no step; nothing ran ⚠ scoped run (0 of 36 steps) — not the gate",
    );
  });

  it("says several changed paths touch no step, in the plural", () => {
    expect(formatNothingAffected("verify --tier release --affected", { changed: 3, total: 40 })).toBe(
      "○ verify --tier release --affected — 3 changed paths touch no step; nothing ran ⚠ scoped run (0 of 40 steps) — not the gate",
    );
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
    expect(formatSummary({ gate: "verify", passed: 1, skipped: 0, selected: 1, total: 15, scoped: true, ms: 100 }, style)).toBe(
      `${style.green("✓")} verify — 1 step passed (0.1s) ${style.yellow("⚠")} scoped run (1 of 15 steps) — not the gate`,
    );
  });

  it("emits nothing but text when no styler is given", () => {
    expect(formatStepLine("lint", true, 700)).toBe("✓ lint (0.7s)");
  });
});
