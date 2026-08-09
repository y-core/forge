import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { STEPS, type Step, selectSteps } from "./steps";

/** Repo root, derived from this file rather than `process.cwd()`, so a probe path declared
 *  relative to the root resolves the same way the gate resolves it when it spawns. */
const REPO_ROOT = new URL("../../", import.meta.url);

// selectSteps is pure, so the logic is proven against a fixture table rather than the real one —
// a step added to STEPS must never break an assertion about how selection behaves.
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

describe("STEPS — table invariants", () => {
  it("gives every step a unique label", () => {
    const labels = labelsOf(STEPS);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("places every step in at least one gate", () => {
    expect(STEPS.filter((step) => step.gates.length === 0)).toEqual([]);
  });

  it("runs typecheck first, so its cascading failures surface before lint and test", () => {
    expect(STEPS[0]?.label).toBe("typecheck");
  });

  it("keeps every check step free of a machine prerequisite", () => {
    const gated = STEPS.filter((step) => step.gates.includes("check") && step.requires !== undefined);

    expect(labelsOf(gated)).toEqual([]);
  });

  it("gives the two suite steps a tail wide enough that late console noise cannot bury a failure", () => {
    // bug-260808-33: at 40, output from suites running late in a full `bun test` filled the
    // window and the two failing test names were unrecoverable. Pinned alongside `test:browser`
    // because they are one defect on two steps, not two coincidences.
    expect(STEPS.find((step) => step.label === "test")?.tail).toBe(120);
    expect(STEPS.find((step) => step.label === "test:browser")?.tail).toBe(120);
  });

  it("makes verify a superset of check", () => {
    const check = labelsOf(STEPS.filter((step) => step.gates.includes("check")));
    const verify = labelsOf(STEPS.filter((step) => step.gates.includes("verify")));

    expect(check.every((label) => verify.includes(label))).toBe(true);
    expect(verify.length).toBeGreaterThan(check.length);
  });
});

// The `test:browser` requirement is declared data, and the defect it replaces was a *vacuous*
// probe: `playwright --version` answered for a devDependency that is always installed, so the
// step ran and 358 specs failed inside `browserType.launch()` instead of the gate refusing up
// front with its install hint. Every assertion below pins one half of that fix — the prerequisite
// that is named, and the command that actually answers for it.
describe("STEPS — the test:browser prerequisite", () => {
  const browser = STEPS.find((step) => step.label === "test:browser");

  it("belongs to verify only, because it is the one step carrying a machine prerequisite", () => {
    expect(browser?.gates).toEqual(["verify"]);
  });

  it("names the browser binary as the prerequisite, not the playwright CLI", () => {
    expect(browser?.requires?.tool).toBe("chromium");
  });

  it("carries an explicit probe instead of defaulting to `<tool> --version`", () => {
    expect(browser?.requires?.probe).toEqual(["bun", "run", "scripts/probe-browser.ts"]);
  });

  it("does not answer the prerequisite by running the step's own binary", () => {
    // `playwright --version` is precisely the check that passed while the browser was absent.
    // The length assertion is load-bearing: without it, deleting `probe` makes `probe?.[0]`
    // undefined and every `not.toBe` below passes vacuously — the exact failure mode this
    // whole describe exists to catch.
    const probe = browser?.requires?.probe ?? [];

    expect(probe.length).toBeGreaterThan(0);
    expect(probe[0]).not.toBe(browser?.cmd[0]);
    expect(probe[0]).not.toBe("playwright");
  });

  it("points its probe at a script that is actually on disk", () => {
    // A probe naming a script that does not exist exits non-zero unconditionally, which would
    // block release on a machine that *has* the browser — a rename has to break this test.
    const script = browser?.requires?.probe?.find((arg) => arg.endsWith(".ts"));

    expect(script).toBe("scripts/probe-browser.ts");
    expect(existsSync(new URL(script ?? "", REPO_ROOT))).toBe(true);
  });

  it("hints the exact command that installs the missing browser", () => {
    expect(browser?.requires?.hint).toBe("bun run test:install");
  });

  it("keeps a tail long enough that a wholesale spec failure cannot read as a partial one", () => {
    // At 40 the reporter's summary was cut off and `verify.log` showed 3 failing spec files out
    // of the 31 that actually failed.
    expect(browser?.tail).toBe(120);
  });
});
