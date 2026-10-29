import { describe, expect, it } from "bun:test";

import { checkResult } from "./finding";
import { DEFAULT_GATE_INPUTS, failsWhenAbsent, isCheckStep, selectSteps } from "./steps";
import { GATE_TIERS } from "./types";
import type { GateTier, Step } from "./types";

const FIXTURE: readonly Step[] = [
  { label: "alpha", tail: 10, cmd: ["a"] },
  { label: "beta", tail: 10, cmd: ["b"], fix: ["b", "--write"] },
  { label: "delta", tier: "unit", tail: 10, cmd: ["d"] },
  { label: "gamma", tier: "runtime", tail: 10, cmd: ["c"] },
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

  // A check's fixer is a function and a command's is an argument vector, so the narrowing is what
  // tells the runner which of the two `--fix` is holding.
  it("narrows a check carrying a fixer, whose fixer is a function rather than a command", () => {
    const fixing: Step = { ...check, fix: () => undefined };

    expect(isCheckStep(fixing)).toBe(true);
    expect(typeof fixing.fix).toBe("function");
  });

  it("selects check and command steps alike, since the distinction is how they run, not whether", () => {
    const result = selectSteps([...FIXTURE, check], { tier: "static" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha", "beta", "in-process"]);
  });

  it("holds a check step back to its tier exactly as a command step is", () => {
    const table: readonly Step[] = [{ ...check, tier: "runtime" }];
    const result = selectSteps(table, { tier: "static" });

    expect(result.ok).toBe(false);
  });
});

describe("failsWhenAbsent()", () => {
  it("skips an absent prerequisite below runtime and fails it from runtime up", () => {
    expect(GATE_TIERS.map(failsWhenAbsent)).toEqual([false, false, true, true, true]);
  });
});

describe("selectSteps() — tier membership", () => {
  const LADDER: readonly Step[] = [
    { label: "lint", tail: 10, cmd: ["l"] },
    { label: "test", tier: "unit", tail: 10, cmd: ["t"] },
    { label: "browser", tier: "runtime", tail: 10, cmd: ["b"] },
    { label: "changelog", tier: "deploy", tail: 10, cmd: ["c"] },
    { label: "browser:webkit", tier: "release", tail: 10, cmd: ["w"] },
  ];

  function tierOf(tier: GateTier): string[] {
    const result = selectSteps(LADDER, { tier });
    return result.ok ? labelsOf(result.steps) : [];
  }

  it("adds exactly one tier's rows at each step up the ladder", () => {
    expect(GATE_TIERS.map(tierOf)).toEqual([
      ["lint"],
      ["lint", "test"],
      ["lint", "test", "browser"],
      ["lint", "test", "browser", "changelog"],
      ["lint", "test", "browser", "changelog", "browser:webkit"],
    ]);
  });

  it("makes static ⊆ unit ⊆ runtime ⊆ deploy ⊆ release for any table", () => {
    const runs = GATE_TIERS.map(tierOf);

    expect(runs.slice(1).every((run, index) => (runs[index] ?? []).every((label) => run.includes(label)))).toBe(true);
  });

  it("counts the tier's own rows as the total, and calls an unfiltered run unscoped", () => {
    const result = selectSteps(FIXTURE, { tier: "unit" });

    expect(result.ok && { total: result.total, scoped: result.scoped }).toEqual({ total: 3, scoped: false });
  });

  it('treats an explicit `tier: "static"` as the same as declaring none', () => {
    const table: readonly Step[] = [{ label: "alpha", tier: "static", tail: 10, cmd: ["a"] }];
    const result = selectSteps(table, { tier: "static" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["alpha"]);
  });
});

describe("selectSteps() — tier-stable order", () => {
  // The table a consumer writes is not the order it runs in: a preset emits its runtime rows where
  // it happens to know about them, and an appended unit row must still run before them.
  const INVERTED: readonly Step[] = [
    { label: "browser", tier: "runtime", tail: 10, cmd: ["playwright"] },
    { label: "lint:types", tier: "unit", tail: 10, cmd: ["oxlint"] },
    { label: "lint", tail: 10, cmd: ["oxlint"] },
  ];

  it("runs the cheaper tier first, whatever order the table declared", () => {
    const result = selectSteps(INVERTED, { tier: "release" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["lint", "lint:types", "browser"]);
  });

  it("keeps declared order within a tier, so `lint` before `format` survives the sort", () => {
    const table: readonly Step[] = [
      { label: "lint", tail: 10, cmd: ["oxlint"] },
      { label: "format", tail: 10, cmd: ["oxfmt"] },
      { label: "browser", tier: "runtime", tail: 10, cmd: ["playwright"] },
      { label: "types:assets", tail: 10, cmd: ["forge"] },
    ];
    const result = selectSteps(table, { tier: "release" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["lint", "format", "types:assets", "browser"]);
  });

  it("sorts an --only selection the same way, so a scoped run is a prefix of the same order", () => {
    const result = selectSteps(INVERTED, { tier: "release", only: ["browser", "lint:types"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["lint:types", "browser"]);
  });

  it("leaves the caller's table untouched, since a selection may not reorder what it was handed", () => {
    selectSteps(INVERTED, { tier: "release" });

    expect(labelsOf([...INVERTED])).toEqual(["browser", "lint:types", "lint"]);
  });
});

describe("selectSteps() — --only filtering", () => {
  it("narrows to the named labels and marks the run scoped", () => {
    const result = selectSteps(FIXTURE, { tier: "release", only: ["gamma", "alpha"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoped).toBe(true);
    expect(result.total).toBe(4);
  });

  it("preserves table order regardless of the order the labels were given", () => {
    const result = selectSteps(FIXTURE, { tier: "release", only: ["gamma", "alpha"] });

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
    const result = selectSteps([], { tier: "static" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a static run — refusing to report a green gate that ran nothing.");
  });

  it("names the unit tier in its refusal, so the message says which run was resolved", () => {
    const result = selectSteps([], { tier: "unit" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a unit run — refusing to report a green gate that ran nothing.");
  });

  it("names the release tier in its refusal too", () => {
    const result = selectSteps([], { tier: "release" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("No steps selected for a release run — refusing to report a green gate that ran nothing.");
  });
});

describe("selectSteps() — table validity", () => {
  it("refuses a duplicated label, which would make --only name two steps at once", () => {
    const table: readonly Step[] = [
      { label: "lint", tail: 10, cmd: ["a"] },
      { label: "lint", tail: 10, cmd: ["b"] },
    ];
    const result = selectSteps(table, { tier: "static" });

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
    const result = selectSteps(table, { tier: "static" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.startsWith("Duplicate step label: a, b.")).toBe(true);
  });

  it("selects a step carrying a dependency in a static run, where an absent one is skipped rather than failed", () => {
    const table: readonly Step[] = [
      { label: "class-groups", run: () => checkResult([], ""), requires: { tool: "tailwindcss", hint: "install it" } },
    ];
    const result = selectSteps(table, { tier: "static" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(labelsOf(result.steps)).toEqual(["class-groups"]);
  });

  it("allows a dependency on a runtime step too, since the tier decides what its absence means", () => {
    const table: readonly Step[] = [
      { label: "unit", tail: 10, cmd: ["bun"] },
      { label: "browser", tier: "runtime", tail: 10, cmd: ["playwright"], requires: { tool: "chromium", hint: "install it" } },
    ];

    expect(selectSteps(table, { tier: "release" }).ok).toBe(true);
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

    expect(selectSteps(table, { tier: "static" }).ok).toBe(true);
  });

  it("refuses a malformed row a lower tier never selects, whichever tier was asked for", () => {
    const tables: readonly (readonly Step[])[] = [
      [
        { label: "lint", tail: 10, cmd: ["l"] },
        { label: "browser", tier: "release", tail: 10, cmd: ["a"] },
        { label: "browser", tier: "release", tail: 10, cmd: ["b"] },
      ],
      [
        { label: "lint", tail: 10, cmd: ["l"] },
        { label: "browser", tier: "release", tail: 10, cmd: ["b"], watches: [] },
      ],
    ];

    expect(tables.map((table) => selectSteps(table, { tier: "static" }).ok)).toEqual([false, false]);
  });

  it("holds a check step to the label rule, since it is not about how a step runs", () => {
    const table: readonly Step[] = [
      { label: "validate-docs", run: () => checkResult([], "") },
      { label: "validate-docs", run: () => checkResult([], "") },
    ];

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
  const WATCHED: readonly Step[] = [
    { label: "ui", tail: 10, cmd: ["u"], watches: ["src/ui/**"] },
    { label: "docs", tail: 10, cmd: ["d"], watches: ["docs/**/*.md", "README.md"] },
    { label: "everything", tail: 10, cmd: ["e"] },
    { label: "browser", tier: "runtime", tail: 10, cmd: ["b"], watches: ["src/**"] },
  ];

  function affected(
    changed: readonly string[],
    extra: { tier?: "static" | "release"; gateInputs?: readonly string[]; only?: readonly string[] } = {},
  ): string[] {
    const result = selectSteps(WATCHED, { tier: extra.tier ?? "release", changed, ...extra });
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
    const result = selectSteps(WATCHED, { tier: "release", changed: [] });

    expect(result).toEqual({ ok: true, steps: [], reach: {}, total: 4, scoped: true });
  });

  it("gives an empty selection when no declared glob matches and every step declares one", () => {
    const declared = WATCHED.filter((step) => step.watches !== undefined);
    const result = selectSteps(declared, { tier: "release", changed: ["scripts/x.sh"] });

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
    const result = selectSteps(table, { tier: "release", changed: [] });

    expect(result.ok ? "" : result.error).toStartWith("Duplicate step label: ui.");
  });

  it("refuses an empty watches list, which would silently skip the step", () => {
    const result = selectSteps([{ label: "lint", tail: 10, cmd: ["x"], watches: [] }], { tier: "static" });

    expect(result.ok ? "" : result.error).toBe('Step "lint" declares an empty `watches` — omit it to run the step on every change.');
  });

  it("refuses a negated watches entry, since a declaration only widens", () => {
    const result = selectSteps([{ label: "lint", tail: 10, cmd: ["x"], watches: ["src/**", "!src/gen/**"] }], { tier: "static" });

    expect(result.ok ? "" : result.error).toBe(
      'Step "lint" declares `watches` entry "!src/gen/**" — a declaration only widens, so `!` exclusions are refused.',
    );
  });

  it("refuses a nested watches or wide glob that matches no file, naming the row, the field and the glob", () => {
    const files = ["src/ui/a.ts", "README.md"];
    const refusal = (step: Step): string => {
      const result = selectSteps([step], { tier: "release", files });
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
      const result = selectSteps([{ label: "md", tail: 10, cmd: ["x"], watches }], { tier: "static", files });
      return result.ok ? "" : result.error;
    };

    expect(refusal(["src/**/*.md", "config/**/*.md", "**/*.md"])).toBe("");
    expect(refusal(["src/**/*.md", "docs/**/*.md"])).toBe(
      'Step "md" declares `watches` glob "docs/**/*.md", which matches no file in the work tree — a renamed path no longer reaches the step, so update the glob.',
    );
  });

  it("accepts a root-level name, a path above the root, and either half of a file-or-directory pair that matches", () => {
    const step: Step = { label: "lint", tail: 10, cmd: ["x"], watches: [".oxlintignore", "../shared/**", "src", "src/**", "README.md/**"] };

    expect(selectSteps([step], { tier: "static", files: ["src/a.ts", "README.md"] }).ok).toBe(true);
  });

  it("pairs a nested path with the tree beneath it, so a directory named without `/**` is not dead", () => {
    const step: Step = { label: "lint", tail: 10, cmd: ["x"], watches: ["src/ui"] };

    expect(selectSteps([step], { tier: "static", files: ["src/ui/a.ts"] }).ok).toBe(true);
  });

  it("refuses a nested path that names neither a file nor a directory in the work tree", () => {
    const cases: { watches: string[]; dead: string }[] = [
      { watches: ["src/gone.ts"], dead: "src/gone.ts" },
      { watches: ["src/ui/**", "src/u"], dead: "src/u" },
      { watches: ["./src/**"], dead: "./src/**" },
    ];

    for (const { watches, dead } of cases) {
      const result = selectSteps([{ label: "lint", tail: 10, cmd: ["x"], watches }], { tier: "static", files: ["src/ui/a.ts"] });
      expect(result.ok ? "" : result.error).toStartWith(`Step "lint" declares \`watches\` glob "${dead}", which matches no file`);
    }
  });

  it("refuses a dead glob on a row the run's tier and --only leave out, since the table is malformed for every run", () => {
    const table: readonly Step[] = [
      { label: "lint", tail: 10, cmd: ["l"] },
      { label: "webkit", tier: "release", tail: 10, cmd: ["w"], narrow: { args: [], wide: ["src/gone/**"] } },
    ];
    const result = selectSteps(table, { tier: "static", only: ["lint"], files: ["src/ui/a.ts"] });

    expect(result.ok ? "" : result.error).toStartWith('Step "webkit" declares `narrow.wide` glob "src/gone/**"');
  });

  it("checks no glob against the work tree when no file list is given", () => {
    expect(selectSteps([{ label: "lint", tail: 10, cmd: ["x"], watches: ["gone/**"] }], { tier: "static" }).ok).toBe(true);
  });

  it("keeps the tier order under a change list", () => {
    const inverted: readonly Step[] = [
      { label: "browser", tier: "runtime", tail: 10, cmd: ["b"], watches: ["src/**"] },
      { label: "lint", tail: 10, cmd: ["l"], watches: ["src/**"] },
    ];
    const result = selectSteps(inverted, { tier: "release", changed: ["src/a.ts"] });

    expect(result.ok && labelsOf(result.steps)).toEqual(["lint", "browser"]);
  });

  it("marks the run scoped under a change list even when every step is selected", () => {
    const result = selectSteps(WATCHED, { tier: "release", changed: ["package.json"] });

    expect(result.ok && result.scoped).toBe(true);
  });

  it("matches a dotfile and a path above the root", () => {
    const table: readonly Step[] = [{ label: "lint", tail: 10, cmd: ["l"], watches: [".oxlintrc*"] }];

    expect(selectSteps(table, { tier: "static", changed: [".oxlintrc.json"] })).toMatchObject({ ok: true, steps: [{ label: "lint" }] });
    expect(affected(["../other/x.ts"], { tier: "static" })).toEqual(["ui", "docs", "everything"]);
  });
});

describe("selectSteps() — how each step reaches the pending changes", () => {
  const RUNTIME: readonly Step[] = [
    { label: "lint", tail: 10, cmd: ["l"], watches: ["src/**"] },
    { label: "test", tier: "unit", tail: 10, cmd: ["t"] },
    {
      label: "browser",
      tier: "runtime",
      tail: 10,
      cmd: ["b"],
      watches: ["src/**"],
      narrow: { args: ["--only-changed"], wide: ["playwright.config.ts", "src/css/**"] },
    },
    { label: "db", tier: "runtime", tail: 10, cmd: ["d"], watches: ["db/**"] },
    { label: "webkit", tier: "release", tail: 10, cmd: ["w"], watches: ["src/**"], narrow: { args: ["--only-changed"] } },
  ];

  function reachAt(tier: GateTier, pending: readonly string[] | undefined, gateInputs?: readonly string[]): Record<string, string> {
    const result = selectSteps(RUNTIME, {
      tier,
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

  it("runs every row whole below `runtime` and from `deploy` up, whatever is pending", () => {
    const pending = ["src/ui/a.ts"];

    expect(GATE_TIERS.filter((tier) => tier !== "runtime").map((tier) => reachAt(tier, pending))).toEqual([
      { lint: "whole" },
      { lint: "whole", test: "whole" },
      { lint: "whole", test: "whole", browser: "whole", db: "whole" },
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
