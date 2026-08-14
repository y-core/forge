import { describe, expect, it } from "bun:test";
import { checkResult } from "./finding";
import { isCheckStep, type Step, selectSteps } from "./steps";

const FIXTURE: readonly Step[] = [
  { label: "alpha", tail: 10, cmd: ["a"] },
  { label: "beta", tail: 10, cmd: ["b"], fix: ["b", "--write"] },
  { label: "gamma", fullOnly: true, tail: 10, cmd: ["c"] },
];

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

describe("isCheckStep()", () => {
  const check: Step = { label: "in-process", run: () => checkResult([], "walked nothing") };

  it("narrows a step carrying a run function", () => {
    expect(isCheckStep(check)).toBe(true);
  });

  it("leaves a command step to the spawning path", () => {
    expect(FIXTURE.every((step) => !isCheckStep(step))).toBe(true);
  });

  it("selects check and command steps alike, since the distinction is how they run, not whether", () => {
    const result = selectSteps([...FIXTURE, check], { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "in-process"]);
  });

  it("holds a check step back to --full when it declares fullOnly, exactly as a command step is", () => {
    const table: readonly Step[] = [{ ...check, fullOnly: true }];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(false);
  });
});

describe("selectSteps() — mode membership", () => {
  it("omits fullOnly steps from a fast run", () => {
    const result = selectSteps(FIXTURE, { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
    expect(result.total).toBe(2);
    expect(result.scoped).toBe(false);
  });

  it("includes them in a full run", () => {
    const result = selectSteps(FIXTURE, { mode: "full" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.total).toBe(3);
  });

  it("makes a full run a superset of a fast one for any table", () => {
    const fast = selectSteps(FIXTURE, { mode: "fast" });
    const full = selectSteps(FIXTURE, { mode: "full" });

    expect(fast.ok && full.ok).toBe(true);
    if (!fast.ok || !full.ok) return;
    expect(labelsOf(fast.steps).every((label) => labelsOf(full.steps).includes(label))).toBe(true);
  });

  it("treats an explicit `fullOnly: false` as an every-mode step", () => {
    const table: readonly Step[] = [{ label: "alpha", fullOnly: false, tail: 10, cmd: ["a"] }];
    const result = selectSteps(table, { mode: "fast" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha"]);
  });
});

describe("selectSteps() — --only filtering", () => {
  it("narrows to the named labels and marks the run scoped", () => {
    const result = selectSteps(FIXTURE, { mode: "full", only: "gamma,alpha" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(true);
    expect(result.total).toBe(3);
  });

  it("preserves table order regardless of the order the labels were given", () => {
    const result = selectSteps(FIXTURE, { mode: "full", only: "gamma,alpha" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "gamma"]);
  });

  it("tolerates surrounding whitespace and empty entries between labels", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: " alpha , , beta " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
  });

  it("is not scoped when --only happens to name every step in the mode", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: "alpha,beta" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(false);
  });
});

describe("selectSteps() — refusals", () => {
  it("rejects an unknown label and names every label the mode knows", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "nope". Known labels for a fast run: alpha, beta');
  });

  it("rejects a fullOnly label in a fast run, pointing at what a fast run does hold", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: "gamma" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "gamma". Known labels for a fast run: alpha, beta');
  });

  it("rejects an --only list that names nothing at all", () => {
    const result = selectSteps(FIXTURE, { mode: "fast", only: " , " });

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

  it("names the full mode in its refusal, so the message says which run was resolved", () => {
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

  it("refuses a machine prerequisite on a step a fast run would reach", () => {
    const table: readonly Step[] = [{ label: "browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } }];
    const result = selectSteps(table, { mode: "full" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      "Machine prerequisite on a step that is not `fullOnly`: browser. A fast run must work on any machine with the repository's dependencies installed.",
    );
  });

  it("allows a prerequisite on a fullOnly step, which is the whole point of the flag", () => {
    const table: readonly Step[] = [
      { label: "unit", tail: 10, cmd: ["bun"] },
      { label: "browser", fullOnly: true, tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } },
    ];

    expect(selectSteps(table, { mode: "full" }).ok).toBe(true);
  });

  it("refuses a malformed table in every mode, not only the one that would reach the bad step", () => {
    const table: readonly Step[] = [{ label: "browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } }];

    expect(selectSteps(table, { mode: "fast" }).ok).toBe(false);
    expect(selectSteps(table, { mode: "full" }).ok).toBe(false);
  });

  it("checks the table before the selection, so --only cannot hide a malformed step", () => {
    const table: readonly Step[] = [
      { label: "lint", tail: 10, cmd: ["a"] },
      { label: "browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } },
    ];
    const result = selectSteps(table, { mode: "fast", only: "lint" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.startsWith("Machine prerequisite")).toBe(true);
  });

  it("holds a check step to both rules, since neither is about how a step runs", () => {
    const table: readonly Step[] = [
      { label: "validate-docs", run: () => checkResult([], "") },
      { label: "validate-docs", run: () => checkResult([], "") },
    ];

    expect(selectSteps(table, { mode: "fast" }).ok).toBe(false);
  });
});
