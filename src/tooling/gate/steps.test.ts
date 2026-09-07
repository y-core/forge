import { describe, expect, it } from "bun:test";

import { checkResult } from "./finding";
import { GATE_MODES, isCheckStep, type Step, selectSteps } from "./steps";

const FIXTURE: readonly Step[] = [
  { label: "alpha", tail: 10, cmd: ["a"] },
  { label: "beta", tail: 10, cmd: ["b"], fix: ["b", "--write"] },
  { label: "delta", tier: "standard", tail: 10, cmd: ["d"] },
  { label: "gamma", tier: "full", tail: 10, cmd: ["c"] },
];

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

describe("GATE_MODES", () => {
  it("is the three tiers in ascending order, which is what the selector ranks against", () => {
    expect([...GATE_MODES]).toEqual(["fast", "standard", "full"]);
  });
});

describe("isCheckStep()", () => {
  const check: Step = { label: "in-process", run: () => checkResult([], "walked nothing") };

  it("narrows a step carrying a run function", () => {
    expect(isCheckStep(check)).toBe(true);
  });

  it("leaves a command step to the spawning path", () => {
    expect(FIXTURE.every((step) => !isCheckStep(step))).toBe(true);
  });

  // A check's fixer is a function and a command's is an argument vector, so the narrowing is what
  // tells the runner which of the two `--fix` is holding.
  it("narrows a check carrying a fixer, whose fixer is a function rather than a command", () => {
    const fixing: Step = { ...check, fix: () => undefined };

    expect(isCheckStep(fixing)).toBe(true);
    expect(typeof fixing.fix).toBe("function");
  });

  it("selects check and command steps alike, since the distinction is how they run, not whether", () => {
    const result = selectSteps([...FIXTURE, check], { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "in-process"]);
  });

  it("holds a check step back to its tier exactly as a command step is", () => {
    const table: readonly Step[] = [{ ...check, tier: "full" }];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(false);
  });
});

describe("selectSteps() — tier membership", () => {
  it("holds a fast run to the steps declaring no tier", () => {
    const result = selectSteps(FIXTURE, { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
    expect(result.total).toBe(2);
    expect(result.scoped).toBe(false);
  });

  it("adds the standard tier to a standard run, and no more", () => {
    const result = selectSteps(FIXTURE, { mode: "standard" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "delta"]);
    expect(result.total).toBe(3);
  });

  it("includes every tier in a full run", () => {
    const result = selectSteps(FIXTURE, { mode: "full" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(result.total).toBe(4);
  });

  it("makes fast ⊆ standard ⊆ full for any table", () => {
    const fast = selectSteps(FIXTURE, { mode: "fast" });
    const standard = selectSteps(FIXTURE, { mode: "standard" });
    const full = selectSteps(FIXTURE, { mode: "full" });

    expect(fast.ok && standard.ok && full.ok).toBe(true);
    if (!fast.ok || !standard.ok || !full.ok) return;
    expect(labelsOf(fast.steps).every((label) => labelsOf(standard.steps).includes(label))).toBe(true);
    expect(labelsOf(standard.steps).every((label) => labelsOf(full.steps).includes(label))).toBe(true);
  });

  it('treats an explicit `tier: "fast"` as the same as declaring none', () => {
    const table: readonly Step[] = [{ label: "alpha", tier: "fast", tail: 10, cmd: ["a"] }];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha"]);
  });
});

describe("selectSteps() — --only filtering", () => {
  it("narrows to the named labels and marks the run scoped", () => {
    const result = selectSteps(FIXTURE, { mode: "full", only: ["gamma", "alpha"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(true);
    expect(result.total).toBe(4);
  });

  it("preserves table order regardless of the order the labels were given", () => {
    const result = selectSteps(FIXTURE, { mode: "full", only: ["gamma", "alpha"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "gamma"]);
  });

  it("tolerates surrounding whitespace and empty entries between labels", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: [" alpha , , beta "] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
  });

  it("is not scoped when --only happens to name every step in the mode", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: ["alpha", "beta"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(false);
  });
});

describe("selectSteps() — refusals", () => {
  it("rejects an unknown label and names every label the mode knows", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: ["nope"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "nope". Known labels for a fast run: alpha, beta');
  });

  it("rejects a higher-tier label in a fast run, pointing at what a fast run does hold", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: ["gamma"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "gamma". Known labels for a fast run: alpha, beta');
  });

  it("rejects an --only list that names nothing at all", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: [" , "] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('No steps selected for a fast run from --only " , " — refusing to report a green gate that ran nothing.');
  });

  it("rejects a mode with no steps rather than reporting an empty run green", () => {
    const result = selectSteps([], { mode: "fast" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a fast run — refusing to report a green gate that ran nothing.");
  });

  it("names the standard mode in its refusal, so the message says which run was resolved", () => {
    const result = selectSteps([], { mode: "standard" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a standard run — refusing to report a green gate that ran nothing.");
  });

  it("names the full mode in its refusal too", () => {
    const result = selectSteps([], { mode: "full" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a full run — refusing to report a green gate that ran nothing.");
  });
});

describe("selectSteps() — table validity", () => {
  it("refuses a duplicated label, which would make --only name two steps at once", () => {
    const table: readonly Step[] = [
      { label: "lint", tail: 10, cmd: ["a"] },
      { label: "lint", tail: 10, cmd: ["b"] },
    ];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      "Duplicate step label: lint. A label is the `--only` token and the name reported on failure, so it must name exactly one step.",
    );
  });

  it("names every duplicated label once, however many times each repeats", () => {
    const table: readonly Step[] = [
      { label: "a", tail: 10, cmd: ["x"] },
      { label: "a", tail: 10, cmd: ["x"] },
      { label: "a", tail: 10, cmd: ["x"] },
      { label: "b", tail: 10, cmd: ["x"] },
      { label: "b", tail: 10, cmd: ["x"] },
    ];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.startsWith("Duplicate step label: a, b.")).toBe(true);
  });

  it("selects a step carrying a dependency in a fast run, where an absent one is skipped rather than failed", () => {
    const table: readonly Step[] = [
      { label: "class-groups", run: () => checkResult([], ""), requires: { tool: "tailwindcss", hint: "install it" } },
    ];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["class-groups"]);
  });

  it("allows a dependency on a full-tier step too, since the mode decides what its absence means", () => {
    const table: readonly Step[] = [
      { label: "unit", tail: 10, cmd: ["bun"] },
      { label: "browser", tier: "full", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } },
    ];

    expect(selectSteps(table, { mode: "full" }).ok).toBe(true);
  });

  it("calls no probe, so selection stays pure and a machine cannot change which steps were chosen", () => {
    const table: readonly Step[] = [
      {
        label: "browser",
        tail: 10,
        cmd: ["playwright"],
        requires: {
          tool: "chromium",
          probe: () => {
            throw new Error("the probe belongs to the runner, not the selection");
          },
          hint: "install it",
        },
      },
    ];

    expect(selectSteps(table, { mode: "fast" }).ok).toBe(true);
  });

  it("holds a check step to the label rule, since it is not about how a step runs", () => {
    const table: readonly Step[] = [
      { label: "validate-docs", run: () => checkResult([], "") },
      { label: "validate-docs", run: () => checkResult([], "") },
    ];

    expect(selectSteps(table, { mode: "fast" }).ok).toBe(false);
  });
});

describe("selectSteps() — the repeatable --only", () => {
  it("takes the array a repeated flag produces", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: ["alpha", "beta"] });
    expect(result.ok && result.steps.map((s) => s.label)).toEqual(["alpha", "beta"]);
  });

  it("splits a comma-joined element of that array, so both spellings name the same steps", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: ["alpha,beta"] });
    expect(result.ok && result.steps.map((s) => s.label)).toEqual(["alpha", "beta"]);
  });

  it("reads an empty array as the flag's absence, not as a request for nothing", () => {
    // What a repeatable flag resolves to when it was never given. Reading it the other way
    // refuses every unscoped run.
    const result = selectSteps(FIXTURE, { mode: "fast", only: [] });
    expect(result.ok && result.scoped).toBe(false);
  });
});
