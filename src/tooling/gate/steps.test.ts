import { describe, expect, it } from "bun:test";

import { checkResult } from "./finding";
import { DEFAULT_GATE_INPUTS, GATE_MODES, isCheckStep, selectSteps } from "./steps";
import type { Step } from "./types";

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
    expect([...GATE_MODES]).toEqual(["quality", "standard", "full"]);
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
    const result = selectSteps([...FIXTURE, check], { mode: "quality" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "in-process"]);
  });

  it("holds a check step back to its tier exactly as a command step is", () => {
    const table: readonly Step[] = [{ ...check, tier: "full" }];
    const result = selectSteps(table, { mode: "quality" });

    expect(result.ok).toBe(false);
  });
});

describe("selectSteps() — tier membership", () => {
  it("holds a quality run to the steps declaring no tier", () => {
    const result = selectSteps(FIXTURE, { mode: "quality" });

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

  it("makes quality ⊆ standard ⊆ full for any table", () => {
    const quality = selectSteps(FIXTURE, { mode: "quality" });
    const standard = selectSteps(FIXTURE, { mode: "standard" });
    const full = selectSteps(FIXTURE, { mode: "full" });

    expect(quality.ok && standard.ok && full.ok).toBe(true);
    if (!quality.ok || !standard.ok || !full.ok) return;
    expect(labelsOf(quality.steps).every((label) => labelsOf(standard.steps).includes(label))).toBe(true);
    expect(labelsOf(standard.steps).every((label) => labelsOf(full.steps).includes(label))).toBe(true);
  });

  it('treats an explicit `tier: "quality"` as the same as declaring none', () => {
    const table: readonly Step[] = [{ label: "alpha", tier: "quality", tail: 10, cmd: ["a"] }];
    const result = selectSteps(table, { mode: "quality" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha"]);
  });
});

describe("selectSteps() — tier-stable order", () => {
  // The table a consumer writes is not the order it runs in: a preset emits its full-tier rows where
  // it happens to know about them, and an appended standard row must still run before them.
  const INVERTED: readonly Step[] = [
    { label: "browser", tier: "full", tail: 10, cmd: ["playwright"] },
    { label: "lint:types", tier: "standard", tail: 10, cmd: ["oxlint"] },
    { label: "lint", tail: 10, cmd: ["oxlint"] },
  ];

  it("runs the cheaper tier first, whatever order the table declared", () => {
    const result = selectSteps(INVERTED, { mode: "full" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["lint", "lint:types", "browser"]);
  });

  it("keeps declared order within a tier, so `lint` before `format` survives the sort", () => {
    const table: readonly Step[] = [
      { label: "lint", tail: 10, cmd: ["oxlint"] },
      { label: "format", tail: 10, cmd: ["oxfmt"] },
      { label: "browser", tier: "full", tail: 10, cmd: ["playwright"] },
      { label: "types:assets", tail: 10, cmd: ["forge"] },
    ];
    const result = selectSteps(table, { mode: "full" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["lint", "format", "types:assets", "browser"]);
  });

  it("sorts an --only selection the same way, so a scoped run is a prefix of the same order", () => {
    const result = selectSteps(INVERTED, { mode: "full", only: ["browser", "lint:types"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["lint:types", "browser"]);
  });

  it("leaves the caller's table untouched, since a selection may not reorder what it was handed", () => {
    selectSteps(INVERTED, { mode: "full" });

    expect(labelsOf([...INVERTED])).toEqual(["browser", "lint:types", "lint"]);
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
    const result = selectSteps(FIXTURE, { mode: "quality", only: [" alpha , , beta "] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
  });

  it("is not scoped when --only happens to name every step in the mode", () => {
    const result = selectSteps(FIXTURE, { mode: "quality", only: ["alpha", "beta"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(false);
  });
});

describe("selectSteps() — refusals", () => {
  it("rejects an unknown label and names every label the mode knows", () => {
    const result = selectSteps(FIXTURE, { mode: "quality", only: ["nope"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "nope". Known labels for a quality run: alpha, beta');
  });

  it("rejects a higher-tier label in a quality run, pointing at what a quality run does hold", () => {
    const result = selectSteps(FIXTURE, { mode: "quality", only: ["gamma"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "gamma". Known labels for a quality run: alpha, beta');
  });

  it("rejects an --only list that names nothing at all", () => {
    const result = selectSteps(FIXTURE, { mode: "quality", only: [" , "] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('No steps selected for a quality run from --only " , " — refusing to report a green gate that ran nothing.');
  });

  it("rejects a mode with no steps rather than reporting an empty run green", () => {
    const result = selectSteps([], { mode: "quality" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a quality run — refusing to report a green gate that ran nothing.");
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
    const result = selectSteps(table, { mode: "quality" });

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
    const result = selectSteps(table, { mode: "quality" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.startsWith("Duplicate step label: a, b.")).toBe(true);
  });

  it("selects a step carrying a dependency in a quality run, where an absent one is skipped rather than failed", () => {
    const table: readonly Step[] = [
      { label: "class-groups", run: () => checkResult([], ""), requires: { tool: "tailwindcss", hint: "install it" } },
    ];
    const result = selectSteps(table, { mode: "quality" });

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

    expect(selectSteps(table, { mode: "quality" }).ok).toBe(true);
  });

  it("holds a check step to the label rule, since it is not about how a step runs", () => {
    const table: readonly Step[] = [
      { label: "validate-docs", run: () => checkResult([], "") },
      { label: "validate-docs", run: () => checkResult([], "") },
    ];

    expect(selectSteps(table, { mode: "quality" }).ok).toBe(false);
  });
});

describe("selectSteps() — the repeatable --only", () => {
  it("takes the array a repeated flag produces", () => {
    const result = selectSteps(FIXTURE, { mode: "quality", only: ["alpha", "beta"] });
    expect(result.ok && result.steps.map((s) => s.label)).toEqual(["alpha", "beta"]);
  });

  it("splits a comma-joined element of that array, so both spellings name the same steps", () => {
    const result = selectSteps(FIXTURE, { mode: "quality", only: ["alpha,beta"] });
    expect(result.ok && result.steps.map((s) => s.label)).toEqual(["alpha", "beta"]);
  });

  it("reads an empty array as the flag's absence, not as a request for nothing", () => {
    // What a repeatable flag resolves to when it was never given. Reading it the other way
    // refuses every unscoped run.
    const result = selectSteps(FIXTURE, { mode: "quality", only: [] });
    expect(result.ok && result.scoped).toBe(false);
  });
});

describe("selectSteps() — the paths a change touches", () => {
  const WATCHED: readonly Step[] = [
    { label: "ui", tail: 10, cmd: ["u"], watches: ["src/ui/**"] },
    { label: "docs", tail: 10, cmd: ["d"], watches: ["docs/**/*.md", "README.md"] },
    { label: "everything", tail: 10, cmd: ["e"] },
    { label: "browser", tier: "full", tail: 10, cmd: ["b"], watches: ["src/**"] },
  ];

  function affected(
    changed: readonly string[],
    extra: { mode?: "quality" | "full"; gateInputs?: readonly string[]; only?: readonly string[] } = {},
  ): string[] {
    const result = selectSteps(WATCHED, { mode: extra.mode ?? "full", changed, ...extra });
    return result.ok ? labelsOf(result.steps) : [`refused: ${result.error}`];
  }

  it("selects a step whose glob matches a changed path, keeps an undeclared one, and drops the rest", () => {
    expect(affected(["src/ui/button.tsx"])).toEqual(["ui", "everything", "browser"]);
    expect(affected(["docs/NAMESPACES.md"])).toEqual(["docs", "everything"]);
  });

  it("publishes the default gate-wide inputs", () => {
    expect([...DEFAULT_GATE_INPUTS]).toEqual(["package.json", "bun.lock", "bunfig.toml", "tsconfig*.json", "config/**", "../**"]);
  });

  it("selects every step when a default gate-wide input changes", () => {
    for (const path of ["package.json", "bun.lock", "bunfig.toml", "tsconfig.build.json", "config/x.ts", "../bun.lock"]) {
      expect(affected([path])).toEqual(["ui", "docs", "everything", "browser"]);
    }
  });

  it("selects every step when a path matches a gateInputs extension", () => {
    expect(affected(["tools/gen.ts"], { gateInputs: ["tools/**"] })).toEqual(["ui", "docs", "everything", "browser"]);
  });

  it("selects nothing, and refuses nothing, for an empty change list", () => {
    const result = selectSteps(WATCHED, { mode: "full", changed: [] });

    expect(result).toEqual({ ok: true, steps: [], total: 4, scoped: true });
  });

  it("gives an empty selection when no declared glob matches and every step declares one", () => {
    const declared = WATCHED.filter((step) => step.watches !== undefined);
    const result = selectSteps(declared, { mode: "full", changed: ["scripts/x.sh"] });

    expect(result.ok && labelsOf(result.steps)).toEqual([]);
  });

  it("still refuses an unknown --only label under a change list", () => {
    expect(affected(["src/ui/a.tsx"], { only: ["nope"] })[0]).toStartWith('refused: Unknown --only label: "nope".');
  });

  it("intersects --only with the change list", () => {
    expect(affected(["src/ui/a.tsx"], { only: ["docs", "ui"] })).toEqual(["ui"]);
  });

  it("refuses a duplicated label before looking at the change list", () => {
    const table: readonly Step[] = [...WATCHED, { label: "ui", tail: 10, cmd: ["x"] }];
    const result = selectSteps(table, { mode: "full", changed: [] });

    expect(result.ok ? "" : result.error).toStartWith("Duplicate step label: ui.");
  });

  it("refuses an empty watches list, which would silently skip the step", () => {
    const result = selectSteps([{ label: "lint", tail: 10, cmd: ["x"], watches: [] }], { mode: "quality" });

    expect(result.ok ? "" : result.error).toBe('Step "lint" declares an empty `watches` — omit it to run the step on every change.');
  });

  it("refuses a negated watches entry, since a declaration only widens", () => {
    const result = selectSteps([{ label: "lint", tail: 10, cmd: ["x"], watches: ["src/**", "!src/gen/**"] }], { mode: "quality" });

    expect(result.ok ? "" : result.error).toBe(
      'Step "lint" declares `watches` entry "!src/gen/**" — a declaration only widens, so `!` exclusions are refused.',
    );
  });

  it("keeps the tier order under a change list", () => {
    const inverted: readonly Step[] = [
      { label: "browser", tier: "full", tail: 10, cmd: ["b"], watches: ["src/**"] },
      { label: "lint", tail: 10, cmd: ["l"], watches: ["src/**"] },
    ];
    const result = selectSteps(inverted, { mode: "full", changed: ["src/a.ts"] });

    expect(result.ok && labelsOf(result.steps)).toEqual(["lint", "browser"]);
  });

  it("marks the run scoped under a change list even when every step is selected", () => {
    const result = selectSteps(WATCHED, { mode: "full", changed: ["package.json"] });

    expect(result.ok && result.scoped).toBe(true);
  });

  it("matches a dotfile and a path above the root", () => {
    const table: readonly Step[] = [{ label: "lint", tail: 10, cmd: ["l"], watches: [".oxlintrc*"] }];

    expect(selectSteps(table, { mode: "quality", changed: [".oxlintrc.json"] })).toMatchObject({ ok: true, steps: [{ label: "lint" }] });
    expect(affected(["../other/x.ts"], { mode: "quality" })).toEqual(["ui", "docs", "everything"]);
  });
});
