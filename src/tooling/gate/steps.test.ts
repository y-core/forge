import { describe, expect, it } from "bun:test";

import { checkResult } from "./finding";
import { DEFAULT_GATE_INPUTS, failsWhenAbsent, isCheckStep, selectSteps } from "./steps";
import { declaredSteps, resolveTiers, tier } from "./tiers";
import { GATE_TIERS } from "./types";
import type { GateTier, ResolvedTiers, Step, StepTiers } from "./types";

function resolved(tiers: StepTiers): ResolvedTiers {
  const result = resolveTiers(tiers);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function ladder(rows: { [K in GateTier]?: readonly Step[] }): ResolvedTiers {
  return resolved({
    static: [...(rows.static ?? [])],
    unit: [tier("static"), ...(rows.unit ?? [])],
    runtime: [tier("unit"), ...(rows.runtime ?? [])],
    scheduled: [tier("runtime"), ...(rows.scheduled ?? [])],
  });
}

const FIXTURE_TIERS: StepTiers = {
  static: [
    { label: "alpha", tail: 10, cmd: ["a"] },
    { label: "beta", tail: 10, cmd: ["b"], fix: ["b", "--write"] },
  ],
  unit: [tier("static"), { label: "delta", tail: 10, cmd: ["d"] }],
  runtime: [tier("unit"), { label: "gamma", tail: 10, cmd: ["c"] }],
  scheduled: [tier("runtime")],
};

const FIXTURE = resolved(FIXTURE_TIERS);

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

describe("isCheckStep()", () => {
  const check: Step = { label: "in-process", run: () => checkResult([], "walked nothing") };

  it("narrows a step carrying a run function", () => {
    expect(isCheckStep(check)).toBe(true);
  });

  it("leaves a command step to the spawning path", () => {
    expect(declaredSteps(FIXTURE_TIERS).every((step) => !isCheckStep(step))).toBe(true);
  });

  // A check's fixer is a function and a command's is an argument vector, so the narrowing is what
  // tells the runner which of the two `--fix` is holding.
  it("narrows a check carrying a fixer, whose fixer is a function rather than a command", () => {
    const fixing: Step = { ...check, fix: () => undefined };

    expect(isCheckStep(fixing)).toBe(true);
    expect(typeof fixing.fix).toBe("function");
  });

  it("selects check and command steps alike, since the distinction is how they run, not whether", () => {
    const result = selectSteps(resolved({ ...FIXTURE_TIERS, static: [...(FIXTURE_TIERS.static ?? []), check] }), { tier: "static" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "in-process"]);
  });

  it("holds a check step back to its tier exactly as a command step is", () => {
    const result = selectSteps(ladder({ runtime: [check] }), { tier: "static" });

    expect(result.ok).toBe(false);
  });
});

describe("failsWhenAbsent()", () => {
  it("skips an absent prerequisite below runtime and fails it from runtime up", () => {
    expect(GATE_TIERS.map(failsWhenAbsent)).toEqual([false, false, true, true]);
  });
});

describe("selectSteps() — the resolved tier's rows", () => {
  it("runs the resolved tier's rows in that tier's order", () => {
    const table = resolved({
      static: [
        { label: "lint", tail: 10, cmd: ["oxlint"] },
        { label: "format", tail: 10, cmd: ["oxfmt"] },
      ],
      unit: [{ label: "test", tail: 10, cmd: ["bun"] }, tier("static")],
    });
    const result = selectSteps(table, { tier: "unit" });

    expect(result.ok && labelsOf(result.steps)).toEqual(["test", "lint", "format"]);
  });

  it("counts the tier's own rows as the total, and calls an unfiltered run unscoped", () => {
    const result = selectSteps(FIXTURE, { tier: "unit" });

    expect(result.ok && { total: result.total, scoped: result.scoped }).toEqual({ total: 3, scoped: false });
  });

  it("refuses a run at a tier the table does not declare", () => {
    const result = selectSteps(resolved({ static: [{ label: "alpha", tail: 10, cmd: ["a"] }] }), { tier: "unit" });

    expect(result.ok ? "" : result.error).toBe("The step table declares no unit tier — add a `unit` key under `tiers`.");
  });
});

describe("selectSteps() — --only filtering", () => {
  it("narrows to the named labels and marks the run scoped", () => {
    const result = selectSteps(FIXTURE, { tier: "scheduled", only: ["gamma", "alpha"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(true);
    expect(result.total).toBe(4);
  });

  it("preserves table order regardless of the order the labels were given", () => {
    const result = selectSteps(FIXTURE, { tier: "scheduled", only: ["gamma", "alpha"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "gamma"]);
  });

  it("tolerates surrounding whitespace and empty entries between labels", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: [" alpha , , beta "] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta"]);
  });

  it("is not scoped when --only happens to name every step in the tier", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: ["alpha", "beta"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(false);
  });
});

describe("selectSteps() — refusals", () => {
  it("rejects an unknown label and names every label the tier knows", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: ["nope"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "nope". Known labels for a static run: alpha, beta');
  });

  it("rejects a higher-tier label in a static run, pointing at what a static run does hold", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: ["gamma"] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unknown --only label: "gamma". Known labels for a static run: alpha, beta');
  });

  it("rejects an --only list that names nothing at all", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: [" , "] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('No steps selected for a static run from --only " , " — refusing to report a green gate that ran nothing.');
  });

  it("rejects a tier with no steps rather than reporting an empty run green", () => {
    const result = selectSteps(resolved({ static: [] }), { tier: "static" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a static run — refusing to report a green gate that ran nothing.");
  });

  it("names the unit tier in its refusal, so the message says which run was resolved", () => {
    const result = selectSteps(resolved({ unit: [] }), { tier: "unit" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a unit run — refusing to report a green gate that ran nothing.");
  });

  it("names the scheduled tier in its refusal too", () => {
    const result = selectSteps(resolved({ scheduled: [] }), { tier: "scheduled" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a scheduled run — refusing to report a green gate that ran nothing.");
  });
});

describe("selectSteps() — table validity", () => {
  it("selects a step carrying a dependency in a static run, where an absent one is skipped rather than failed", () => {
    const table = resolved({
      static: [{ label: "class-groups", run: () => checkResult([], ""), requires: { tool: "tailwindcss", hint: "install it" } }],
    });
    const result = selectSteps(table, { tier: "static" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["class-groups"]);
  });

  it("allows a dependency on a runtime step too, since the tier decides what its absence means", () => {
    const table = ladder({
      static: [{ label: "unit", tail: 10, cmd: ["bun"] }],
      runtime: [{ label: "browser", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } }],
    });

    expect(selectSteps(table, { tier: "scheduled" }).ok).toBe(true);
  });

  it("calls no probe, so selection stays pure and a machine cannot change which steps were chosen", () => {
    const table = resolved({
      static: [
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
      ],
    });

    expect(selectSteps(table, { tier: "static" }).ok).toBe(true);
  });

  it("refuses a malformed row a lower tier never selects, whichever tier was asked for", () => {
    const table = ladder({
      static: [{ label: "lint", tail: 10, cmd: ["l"] }],
      scheduled: [{ label: "browser", tail: 10, cmd: ["b"], watches: [] }],
    });

    expect(selectSteps(table, { tier: "static" }).ok).toBe(false);
  });
});

describe("selectSteps() — the repeatable --only", () => {
  it("takes the array a repeated flag produces", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: ["alpha", "beta"] });
    expect(result.ok && result.steps.map((s) => s.label)).toEqual(["alpha", "beta"]);
  });

  it("splits a comma-joined element of that array, so both spellings name the same steps", () => {
    const result = selectSteps(FIXTURE, { tier: "static", only: ["alpha,beta"] });
    expect(result.ok && result.steps.map((s) => s.label)).toEqual(["alpha", "beta"]);
  });

  it("reads an empty array as the flag's absence, not as a request for nothing", () => {
    // What a repeatable flag resolves to when it was never given. Reading it the other way
    // refuses every unscoped run.
    const result = selectSteps(FIXTURE, { tier: "static", only: [] });
    expect(result.ok && result.scoped).toBe(false);
  });
});

describe("selectSteps() — the paths a change touches", () => {
  const UI: Step = { label: "ui", tail: 10, cmd: ["u"], watches: ["src/ui/**"] };
  const DOCS: Step = { label: "docs", tail: 10, cmd: ["d"], watches: ["docs/**/*.md", "README.md"] };
  const BROWSER: Step = { label: "browser", tail: 10, cmd: ["b"], watches: ["src/**"] };
  const WATCHED = ladder({ static: [UI, DOCS, { label: "everything", tail: 10, cmd: ["e"] }], runtime: [BROWSER] });

  function affected(
    changed: readonly string[],
    extra: { tier?: "static" | "scheduled"; gateInputs?: readonly string[]; only?: readonly string[] } = {},
  ): string[] {
    const result = selectSteps(WATCHED, { tier: extra.tier ?? "scheduled", changed, ...extra });
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
    const result = selectSteps(WATCHED, { tier: "scheduled", changed: [] });

    expect(result).toEqual({ ok: true, steps: [], reach: {}, total: 4, scoped: true });
  });

  it("gives an empty selection when no declared glob matches and every step declares one", () => {
    const declared = ladder({ static: [UI, DOCS], runtime: [BROWSER] });
    const result = selectSteps(declared, { tier: "scheduled", changed: ["scripts/x.sh"] });

    expect(result.ok && labelsOf(result.steps)).toEqual([]);
  });

  it("still refuses an unknown --only label under a change list", () => {
    expect(affected(["src/ui/a.tsx"], { only: ["nope"] })[0]).toStartWith('refused: Unknown --only label: "nope".');
  });

  it("intersects --only with the change list", () => {
    expect(affected(["src/ui/a.tsx"], { only: ["docs", "ui"] })).toEqual(["ui"]);
  });

  it("refuses an empty watches list, which would silently skip the step", () => {
    const result = selectSteps(resolved({ static: [{ label: "lint", tail: 10, cmd: ["x"], watches: [] }] }), { tier: "static" });

    expect(result.ok ? "" : result.error).toBe('Step "lint" declares an empty `watches` — omit it to run the step on every change.');
  });

  it("refuses a negated watches entry, since a declaration only widens", () => {
    const result = selectSteps(resolved({ static: [{ label: "lint", tail: 10, cmd: ["x"], watches: ["src/**", "!src/gen/**"] }] }), {
      tier: "static",
    });

    expect(result.ok ? "" : result.error).toBe(
      'Step "lint" declares `watches` entry "!src/gen/**" — a declaration only widens, so `!` exclusions are refused.',
    );
  });

  it("refuses a nested watches or wide glob that matches no file, naming the row, the field and the glob", () => {
    const files = ["src/ui/a.ts", "README.md"];
    const refusal = (step: Step): string => {
      const result = selectSteps(resolved({ scheduled: [step] }), { tier: "scheduled", files });
      return result.ok ? "" : result.error;
    };

    expect(refusal({ label: "ui", tail: 10, cmd: ["x"], watches: ["src/ui/**", "src/css/**"] })).toBe(
      'Step "ui" declares `watches` glob "src/css/**", which matches no file in the work tree — a renamed path no longer reaches the step, so update the glob.',
    );
    expect(refusal({ label: "b", tail: 10, cmd: ["x"], narrow: { args: [], wide: ["src/theme/*.css"] } })).toStartWith(
      'Step "b" declares `narrow.wide` glob "src/theme/*.css", which matches no file',
    );
  });

  it("accepts a glob whose literal directory exists but holds no matching file yet, and refuses one whose directory is gone", () => {
    const files = ["src/a.ts", "config/steps.ts", "README.md"];
    const refusal = (watches: string[]): string => {
      const result = selectSteps(resolved({ static: [{ label: "md", tail: 10, cmd: ["x"], watches }] }), { tier: "static", files });
      return result.ok ? "" : result.error;
    };

    expect(refusal(["src/**/*.md", "config/**/*.md", "**/*.md"])).toBe("");
    expect(refusal(["src/**/*.md", "docs/**/*.md"])).toBe(
      'Step "md" declares `watches` glob "docs/**/*.md", which matches no file in the work tree — a renamed path no longer reaches the step, so update the glob.',
    );
  });

  it("accepts a root-level name, a path above the root, and either half of a file-or-directory pair that matches", () => {
    const step: Step = { label: "lint", tail: 10, cmd: ["x"], watches: [".oxlintignore", "../shared/**", "src", "src/**", "README.md/**"] };

    expect(selectSteps(resolved({ static: [step] }), { tier: "static", files: ["src/a.ts", "README.md"] }).ok).toBe(true);
  });

  it("pairs a nested path with the tree beneath it, so a directory named without `/**` is not dead", () => {
    const step: Step = { label: "lint", tail: 10, cmd: ["x"], watches: ["src/ui"] };

    expect(selectSteps(resolved({ static: [step] }), { tier: "static", files: ["src/ui/a.ts"] }).ok).toBe(true);
  });

  it("refuses a nested path that names neither a file nor a directory in the work tree", () => {
    const cases: { watches: string[]; dead: string }[] = [
      { watches: ["src/gone.ts"], dead: "src/gone.ts" },
      { watches: ["src/ui/**", "src/u"], dead: "src/u" },
      { watches: ["./src/**"], dead: "./src/**" },
    ];

    for (const { watches, dead } of cases) {
      const result = selectSteps(resolved({ static: [{ label: "lint", tail: 10, cmd: ["x"], watches }] }), {
        tier: "static",
        files: ["src/ui/a.ts"],
      });
      expect(result.ok ? "" : result.error).toStartWith(`Step "lint" declares \`watches\` glob "${dead}", which matches no file`);
    }
  });

  it("refuses a dead glob on a row the run's tier and --only leave out, since the table is malformed for every run", () => {
    const table = ladder({
      static: [{ label: "lint", tail: 10, cmd: ["l"] }],
      scheduled: [{ label: "webkit", tail: 10, cmd: ["w"], narrow: { args: [], wide: ["src/gone/**"] } }],
    });
    const result = selectSteps(table, { tier: "static", only: ["lint"], files: ["src/ui/a.ts"] });

    expect(result.ok ? "" : result.error).toStartWith('Step "webkit" declares `narrow.wide` glob "src/gone/**"');
  });

  it("checks no glob against the work tree when no file list is given", () => {
    expect(selectSteps(resolved({ static: [{ label: "lint", tail: 10, cmd: ["x"], watches: ["gone/**"] }] }), { tier: "static" }).ok).toBe(true);
  });

  it("keeps the tier order under a change list", () => {
    const table = resolved({ static: [{ label: "lint", tail: 10, cmd: ["l"], watches: ["src/**"] }], scheduled: [BROWSER, tier("static")] });
    const result = selectSteps(table, { tier: "scheduled", changed: ["src/a.ts"] });

    expect(result.ok && labelsOf(result.steps)).toEqual(["browser", "lint"]);
  });

  it("marks the run scoped under a change list even when every step is selected", () => {
    const result = selectSteps(WATCHED, { tier: "scheduled", changed: ["package.json"] });

    expect(result.ok && result.scoped).toBe(true);
  });

  it("matches a dotfile and a path above the root", () => {
    const table = resolved({ static: [{ label: "lint", tail: 10, cmd: ["l"], watches: [".oxlintrc*"] }] });

    expect(selectSteps(table, { tier: "static", changed: [".oxlintrc.json"] })).toMatchObject({ ok: true, steps: [{ label: "lint" }] });
    expect(affected(["../other/x.ts"], { tier: "static" })).toEqual(["ui", "docs", "everything"]);
  });
});

describe("selectSteps() — how each step reaches the pending changes", () => {
  const RUNTIME = ladder({
    static: [{ label: "lint", tail: 10, cmd: ["l"], watches: ["src/**"] }],
    unit: [{ label: "test", tail: 10, cmd: ["t"] }],
    runtime: [
      {
        label: "browser",
        tail: 10,
        cmd: ["b"],
        watches: ["src/**"],
        narrow: { args: ["--only-changed"], wide: ["playwright.config.ts", "src/css/**"] },
      },
      { label: "db", tail: 10, cmd: ["d"], watches: ["db/**"] },
    ],
    scheduled: [{ label: "webkit", tail: 10, cmd: ["w"], watches: ["src/**"], narrow: { args: ["--only-changed"] } }],
  });

  function reachAt(runTier: GateTier, pending: readonly string[] | undefined, gateInputs?: readonly string[]): Record<string, string> {
    const result = selectSteps(RUNTIME, {
      tier: runTier,
      ...(pending === undefined ? {} : { pending }),
      ...(gateInputs === undefined ? {} : { gateInputs }),
    });
    return result.ok ? { ...result.reach } : { refused: result.error };
  }

  it("narrows a row with `narrow` whose watches a pending change touches, and leaves a runtime row it misses untouched", () => {
    expect(reachAt("runtime", ["src/ui/a.ts"])).toEqual({ lint: "whole", test: "whole", browser: "narrow", db: "untouched" });
  });

  it("runs a runtime row without `narrow` whole when a pending change touches it", () => {
    expect(reachAt("runtime", ["db/schema.sql"])).toMatchObject({ browser: "untouched", db: "whole" });
  });

  it("leaves every runtime row untouched on a clean tree, and the rows below it whole", () => {
    expect(reachAt("runtime", [])).toEqual({ lint: "whole", test: "whole", browser: "untouched", db: "untouched" });
  });

  it("runs a row whole when a pending change matches its `wide` globs, whether or not its watches cover the path", () => {
    expect(reachAt("runtime", ["src/css/theme.css"]).browser).toBe("whole");
    expect(reachAt("runtime", ["playwright.config.ts"]).browser).toBe("whole");
  });

  it("runs every runtime row whole when a pending change matches a default gate input", () => {
    expect(reachAt("runtime", ["package.json"])).toMatchObject({ browser: "whole", db: "whole" });
  });

  it("runs every runtime row whole when a pending change matches a declared gate input", () => {
    expect(reachAt("runtime", ["tools/gen.ts"], ["tools/**"])).toMatchObject({ browser: "whole", db: "whole" });
  });

  it("runs every row whole below `runtime` and at `scheduled`, whatever is pending", () => {
    const pending = ["src/ui/a.ts"];

    expect(GATE_TIERS.filter((runTier) => runTier !== "runtime").map((runTier) => reachAt(runTier, pending))).toEqual([
      { lint: "whole" },
      { lint: "whole", test: "whole" },
      { lint: "whole", test: "whole", browser: "whole", db: "whole", webkit: "whole" },
    ]);
  });

  it("runs every row whole at `runtime` when no pending list could be read", () => {
    expect(Object.values(reachAt("runtime", undefined)).every((reach) => reach === "whole")).toBe(true);
  });

  it("keeps an untouched row in the selection and leaves the run unscoped, since the narrowing is the tier's own", () => {
    const result = selectSteps(RUNTIME, { tier: "runtime", pending: [] });

    expect(result.ok && { labels: labelsOf(result.steps), scoped: result.scoped }).toEqual({
      labels: ["lint", "test", "browser", "db"],
      scoped: false,
    });
  });
});

describe("selectSteps() — narrowing keys on a row's home tier", () => {
  const DB: Step = { label: "db", tail: 10, cmd: ["d"], watches: ["db/**"] };
  const NARROWS: Step = { label: "browser", tail: 10, cmd: ["b"], watches: ["src/**"], narrow: { args: ["--only-changed"] } };

  function reachIn(table: ResolvedTiers): Readonly<Record<string, string>> {
    const result = selectSteps(table, { tier: "runtime", pending: ["src/ui/a.ts"] });
    return result.ok ? result.reach : { refused: result.error };
  }

  it("leaves a runtime-home row whose watches miss the pending changes untouched", () => {
    expect(reachIn(ladder({ runtime: [DB] }))).toEqual({ db: "untouched" });
  });

  it('runs the same row whole when it is declared in static and reached through tier("static")', () => {
    expect(reachIn(ladder({ static: [DB] }))).toEqual({ db: "whole" });
  });

  it("narrows a row carrying `narrow` whatever its home tier", () => {
    expect([reachIn(ladder({ static: [NARROWS] })), reachIn(ladder({ runtime: [NARROWS] }))]).toEqual([
      { browser: "narrow" },
      { browser: "narrow" },
    ]);
  });
});
