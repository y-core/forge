import { describe, expect, it } from "bun:test";
import { type Step, selectSteps } from "./steps";

// selectSteps is pure, so the logic is proven against a fixture table rather than any real one —
// a step added to a project's table must never break an assertion about how selection behaves.
const FIXTURE: readonly Step[] = [
  { label: "alpha", gates: ["check", "verify"], tail: 10, cmd: ["a"] },
  { label: "beta", gates: ["check", "verify"], tail: 10, cmd: ["b"], fix: ["b", "--write"] },
  { label: "gamma", gates: ["verify"], tail: 10, cmd: ["c"] },
];

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

describe("selectSteps() — gate membership", () => {
  it("selects only the steps whose gates include the requested gate", () => {
    const result = selectSteps(FIXTURE, { gate: "check" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
    expect(result.total).toBe(2);
    expect(result.scoped).toBe(false);
  });

  it("includes verify-only steps when the gate is verify", () => {
    const result = selectSteps(FIXTURE, { gate: "verify" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.total).toBe(3);
  });
});

describe("selectSteps() — --only filtering", () => {
  it("narrows to the named labels and marks the run scoped", () => {
    const result = selectSteps(FIXTURE, { gate: "verify", only: "gamma,alpha" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(true);
    expect(result.total).toBe(3);
  });

  it("preserves table order regardless of the order the labels were given", () => {
    const result = selectSteps(FIXTURE, { gate: "verify", only: "gamma,alpha" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "gamma"]);
  });

  it("tolerates surrounding whitespace and empty entries between labels", () => {
    const result = selectSteps(FIXTURE, { gate: "check", only: " alpha , , beta " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
  });

  it("is not scoped when --only happens to name every step in the gate", () => {
    const result = selectSteps(FIXTURE, { gate: "check", only: "alpha,beta" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(false);
  });
});

describe("selectSteps() — refusals", () => {
  it("rejects an unknown label and names every label the gate knows", () => {
    const result = selectSteps(FIXTURE, { gate: "check", only: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "nope". Known labels for check: alpha, beta');
  });

  it("rejects a label that exists but belongs to another gate", () => {
    const result = selectSteps(FIXTURE, { gate: "check", only: "gamma" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "gamma". Known labels for check: alpha, beta');
  });

  it("rejects an --only list that names nothing at all", () => {
    const result = selectSteps(FIXTURE, { gate: "check", only: " , " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('No steps selected for check from --only " , " — refusing to report a green gate that ran nothing.');
  });

  it("rejects a gate with no steps rather than reporting an empty run green", () => {
    const result = selectSteps([], { gate: "check" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for check — refusing to report a green gate that ran nothing.");
  });
});
