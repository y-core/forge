import { describe, expect, it } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CliContext } from "../cli/types";
import { PLAIN } from "../term/color";
import { gateFixtureRoot } from "./checks/gate.fixture";
import { createGateCommand } from "./command";
import { checkResult, fail } from "./finding";
import { readReceipt, recordReceipt } from "./receipt";
import type { Step } from "./types";
import { worktreeHash } from "./worktree";
import { worktreeFixture } from "./worktree.fixture";

// The fake exit throws so the run stops exactly where the real process would; `node:process` is
// deliberately not mocked, since it is process-global and imported across the CLI.
class Exited extends Error {
  code: number;

  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

const ABSENT = { tool: "tailwindcss", probe: () => false, hint: "run `bun add -d tailwindcss`" };
const PRESENT = { tool: "tailwindcss", probe: () => true, hint: "run `bun add -d tailwindcss`" };

const passing = (label: string, requires?: Step["requires"]): Step => ({
  label,
  run: () => checkResult([], ""),
  ...(requires === undefined ? {} : { requires }),
});

const failing = (label: string): Step => ({ label, run: () => checkResult([fail("no good")], "") });

function context(): { ctx: CliContext; logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    ctx: {
      io: {
        stdout: (msg: string) => logs.push(msg),
        stderr: (msg: string) => logs.push(msg),
        exit: (code: number): never => {
          throw new Exited(code);
        },
      },
      out: PLAIN,
      err: PLAIN,
      width: 80,
    },
  };
}

/** Runs the gate over `steps`, capturing `console.log` and the exit code the runner asked for. */
async function run(
  steps: readonly Step[],
  flags: Record<string, unknown> = {},
  opts: { cwd?: string; gateInputs?: readonly string[] } = {},
): Promise<{ logs: string[]; code: number | undefined }> {
  const { ctx, logs } = context();
  const command = createGateCommand({
    cwd: opts.cwd ?? gateFixtureRoot(),
    steps,
    ...(opts.gateInputs === undefined ? {} : { gateInputs: opts.gateInputs }),
  });
  const original = console.log;
  const originalError = console.error;
  console.log = (msg: string) => logs.push(msg);
  // A refusal is written to stderr, so a test asserting one has to see both streams.
  console.error = (msg: string) => logs.push(msg);
  let code: number | undefined;
  try {
    await command.run?.([], { full: false, list: false, fix: false, only: [], ...flags } as never, ctx);
  } catch (error) {
    if (!(error instanceof Exited)) throw error;
    code = error.code;
  } finally {
    console.log = original;
    console.error = originalError;
  }
  return { logs, code };
}

describe("createGateCommand() — the mode reaches a check", () => {
  const seen: string[] = [];
  const recording: Step = {
    label: "validate-thing",
    run: (mode) => {
      seen.push(mode);
      return checkResult([], "");
    },
  };

  it("hands a check the mode of the run, which a check may vary its strictness on", async () => {
    seen.length = 0;
    await run([recording], { mode: "quality" });
    await run([recording]);
    await run([recording], { full: true });

    expect(seen).toEqual(["quality", "standard", "full"]);
  });

  it("resolves a bare run to standard, so `verify` is the gate and quality is opt-in", async () => {
    seen.length = 0;
    await run([recording]);

    expect(seen).toEqual(["standard"]);
  });

  it("reads --full as sugar for --mode full", async () => {
    seen.length = 0;
    await run([recording], { full: true });
    await run([recording], { mode: "full" });

    expect(seen).toEqual(["full", "full"]);
  });
});

describe("createGateCommand() — resolving the mode", () => {
  const trivial: Step = { label: "alpha", run: () => checkResult([], "") };

  it("refuses --mode and --full together rather than inventing a precedence", async () => {
    const { logs, code } = await run([trivial], { mode: "quality", full: true });

    expect(logs).toContain("Pass --mode or --full, not both.");
    expect(code).toBe(1);
  });

  it("refuses an unrecognised --mode, naming the three it knows", async () => {
    const { logs, code } = await run([trivial], { mode: "nope" });

    expect(logs).toContain('Unknown --mode: "nope". Known modes: quality, standard, full.');
    expect(code).toBe(1);
  });

  it("names the mode canonically in the banner, since --full is an input spelling only", async () => {
    expect((await run([trivial], { mode: "quality", list: true })).logs).toEqual(["verify --mode quality — 1 step\n  alpha"]);
    expect((await run([trivial], { list: true })).logs).toEqual(["verify — 1 step\n  alpha"]);
    expect((await run([trivial], { full: true, list: true })).logs).toEqual(["verify --mode full — 1 step\n  alpha"]);
  });
});

describe("createGateCommand() — a step whose dependency is absent", () => {
  it("skips it in a quality run but refuses to call the run green, and exits non-zero", async () => {
    const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)]);

    expect(logs).toContain("○ delta — skipped (tailwindcss not found; run `bun add -d tailwindcss`)");
    expect(logs.at(-1)?.startsWith("○ verify — 1 step passed, 1 step skipped")).toBe(true);
    expect(logs.at(-1)).toContain("not green: 1 step never ran");
    expect(code).toBe(1);
  });

  it("probes one tool once however many steps name it, since the probe shells out", async () => {
    let probes = 0;
    const counted = { tool: "tailwindcss", probe: () => ((probes += 1), false), hint: "run `bun add -d tailwindcss`" };
    await run([passing("alpha", counted), passing("beta", counted), passing("gamma", counted)]);

    expect(probes).toBe(1);
  });

  it("runs it when the probe finds the dependency, in a quality run as much as a full one", async () => {
    const { logs, code } = await run([passing("delta", PRESENT)]);

    expect(logs.some((line) => line.startsWith("✓ delta"))).toBe(true);
    expect(logs.at(-1)?.startsWith("✓ verify — 1 step passed (")).toBe(true);
    expect(code).toBeUndefined();
  });

  it("fails the release gate rather than skipping, since --full is what a publish is checked by", async () => {
    const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)], { full: true });

    expect(logs).toContain("✗ delta — tailwindcss not found; run `bun add -d tailwindcss`");
    expect(logs.at(-1)?.startsWith("✗ verify --mode full — failed at `delta` (step 2 of 2")).toBe(true);
    expect(code).toBe(1);
  });

  it("refuses a green when every selected step was skipped", async () => {
    const { logs, code } = await run([passing("alpha", ABSENT), passing("beta", ABSENT), passing("gamma", ABSENT)]);

    expect(logs.at(-1)).toMatch(/^✗ verify — every step skipped \(0 of 3 ran, .+\) — refusing to report a green gate that ran nothing$/);
    expect(code).toBe(1);
  });

  it("counts a skip in the failure line, and states the failing step's position rather than a run count", async () => {
    const { logs, code } = await run([passing("alpha"), passing("skipped", ABSENT), failing("beta"), passing("gamma")]);

    expect(logs.at(-1)?.startsWith("✗ verify — failed at `beta` (step 3 of 4, 1 skipped")).toBe(true);
    expect(code).toBe(1);
  });
});

describe("createGateCommand() — --fix", () => {
  const fixable = (label: string, requires?: Step["requires"]): Step => ({
    label,
    tail: 5,
    cmd: ["bun", "--version"],
    fix: ["bun", "--version"],
    ...(requires === undefined ? {} : { requires }),
  });

  it("spawns no fixer for a step whose dependency is absent", async () => {
    const { logs, code } = await run([fixable("alpha"), fixable("delta", ABSENT)], { fix: true });

    expect(logs.some((line) => line.startsWith("✓ fix:alpha"))).toBe(true);
    expect(logs.some((line) => line.startsWith("✓ fix:delta") || line.startsWith("✗ fix:delta"))).toBe(false);
    expect(logs.at(-1)).toBe(
      "1 fixed, 1 step skipped — that step was not fixed; install what each skip line above names, then re-run `bun run verify`.",
    );
    expect(code).toBe(1);
  });

  // A step with no fixer was never going to spawn, so probing it would report a dependency this run
  // does not need.
  it("asks the fixer question before the dependency question, even under --full", async () => {
    const probed: string[] = [];
    const check: Step = {
      label: "validate-thing",
      run: () => checkResult([], ""),
      requires: {
        tool: "tailwindcss",
        probe: () => {
          probed.push("validate-thing");
          return false;
        },
        hint: "run `bun add -d tailwindcss`",
      },
    };
    const { logs, code } = await run([check], { fix: true, full: true });

    expect(probed).toEqual([]);
    expect(logs.at(-1)).toBe("0 fixed, 1 without a fixer — re-run `bun run verify --mode full` to confirm.");
    expect(code).toBeUndefined();
  });

  // Nothing here asserts a fixer's exit status: a fixer spawns a real tool, so what it exits with
  // belongs to the machine running the suite rather than to this file.
  it("runs every fixer the selection holds rather than stopping at the first", async () => {
    const { logs } = await run([fixable("beta"), fixable("alpha")], { fix: true });

    expect(logs.filter((line) => line.includes("fix:")).length).toBe(2);
  });

  it("calls a check's fixer in-process, and its `run` not at all", async () => {
    const called: string[] = [];
    const step: Step = {
      label: "validate-markdown",
      run: () => {
        called.push("run");
        return checkResult([], "");
      },
      fix: () => {
        called.push("fix");
      },
    };
    const { logs, code } = await run([step], { fix: true });

    expect(called).toEqual(["fix"]);
    expect(logs.some((line) => line.startsWith("✓ fix:validate-markdown"))).toBe(true);
    expect(logs.at(-1)).toBe("1 fixed — re-run `bun run verify` to confirm.");
    expect(code).toBeUndefined();
  });

  it("counts a check without a fixer unfixable, as it always did", async () => {
    const { logs } = await run([passing("validate-thing")], { fix: true });

    expect(logs.some((line) => line.includes("fix:validate-thing"))).toBe(false);
    expect(logs.at(-1)).toBe("0 fixed, 1 without a fixer — re-run `bun run verify` to confirm.");
  });

  it("fails the run when a fixer throws, naming the step and printing what it said", async () => {
    const step: Step = {
      label: "validate-markdown",
      run: () => checkResult([], ""),
      fix: () => {
        throw new Error("EACCES: docs/a.md");
      },
    };
    const { logs, code } = await run([step], { fix: true });

    expect(logs.some((line) => line.startsWith("✗ fix:validate-markdown"))).toBe(true);
    expect(logs).toContain("    EACCES: docs/a.md");
    expect(code).toBe(1);
  });

  it("never invokes a fixer on a run that is not --fix, whichever steps were selected", async () => {
    const called: string[] = [];
    const step: Step = {
      label: "validate-markdown",
      run: () => checkResult([], ""),
      fix: () => {
        called.push("fix");
      },
    };
    await run([step], { only: ["validate-markdown"] });

    expect(called).toEqual([]);
  });
});

describe("createGateCommand() — --list", () => {
  const exploding: Step = {
    label: "validate-class-groups",
    run: () => {
      throw new Error("--list must run nothing at all");
    },
    requires: { tool: "tailwindcss", probe: () => false, hint: "run `bun add -d tailwindcss`" },
  };

  it("marks a step with a dependency conditional in a quality run, executing none of them", async () => {
    const { logs, code } = await run([passing("alpha"), exploding], { list: true });

    expect(logs).toEqual(["verify — 2 steps\n  alpha\n  validate-class-groups (conditional — tailwindcss required)"]);
    expect(code).toBeUndefined();
  });

  it("states the dependency as required under --full, where its absence is a failure", async () => {
    const { logs } = await run([exploding], { list: true, full: true });

    expect(logs).toEqual(["verify --mode full — 1 step\n  validate-class-groups (requires tailwindcss)"]);
  });
});

describe("createGateCommand() — the receipt a passing run records", () => {
  const FILES = { ".gitignore": "ignored.log\n", "a.txt": "alpha\n", "b.txt": "beta\n" };

  function counting(): { calls: string[]; step: (label: string) => Step } {
    const calls: string[] = [];
    return {
      calls,
      step: (label) => ({
        label,
        run: () => {
          calls.push(label);
          return checkResult([], "");
        },
      }),
    };
  }

  async function recorded(): Promise<{ root: string; calls: string[]; steps: Step[] }> {
    const root = worktreeFixture(FILES);
    const { calls, step } = counting();
    const steps = [step("alpha"), step("beta")];
    await run(steps, {}, { cwd: root });
    calls.length = 0;
    return { root, calls, steps };
  }

  it("records the tree, mode and labels of an unscoped pass", async () => {
    const root = worktreeFixture(FILES);
    const { step } = counting();
    const { code } = await run([step("alpha"), step("beta")], {}, { cwd: root });

    expect(code).toBeUndefined();
    expect(readReceipt(root)).toEqual({ tree: worktreeHash(root) ?? "", mode: "standard", labels: ["alpha", "beta"] });
  });

  it("answers --reuse on the same tree without calling a step, naming the hash", async () => {
    const { root, calls, steps } = await recorded();
    const { logs, code } = await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(code).toBeUndefined();
    expect(logs).toEqual([`✓ verify — reused the passing standard run of tree ${worktreeHash(root) ?? ""}; no step ran`]);
  });

  it("runs the gate under --reuse after a tracked file is edited", async () => {
    const { root, calls, steps } = await recorded();
    writeFileSync(join(root, "a.txt"), "edited\n");
    const { logs } = await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual(["alpha", "beta"]);
    expect(logs[0]).toBe(`○ no passing run of tree ${worktreeHash(root) ?? ""} on record at standard or above; running the gate`);
  });

  it("runs the gate under --reuse after an untracked file is added", async () => {
    const { root, calls, steps } = await recorded();
    writeFileSync(join(root, "new.txt"), "new\n");
    await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual(["alpha", "beta"]);
  });

  it("runs the gate under --reuse after a tracked file is deleted", async () => {
    const { root, calls, steps } = await recorded();
    rmSync(join(root, "b.txt"));
    await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual(["alpha", "beta"]);
  });

  it("still reuses after an ignored file is added", async () => {
    const { root, calls, steps } = await recorded();
    writeFileSync(join(root, "ignored.log"), "noise\n");
    await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual([]);
  });

  it("records nothing for an --only pass, a failure, a --fix run, a --list run or a run with a skip", async () => {
    const absent = { tool: "tailwindcss", probe: () => false, hint: "run `bun add -d tailwindcss`" };
    const cases: [readonly Step[], Record<string, unknown>][] = [
      [[passing("alpha"), passing("beta")], { only: ["alpha"] }],
      [[passing("alpha"), failing("beta")], {}],
      [[passing("alpha")], { fix: true }],
      [[passing("alpha")], { list: true }],
      [[passing("alpha"), passing("beta", absent)], {}],
    ];
    for (const [steps, flags] of cases) {
      const root = worktreeFixture(FILES);
      await run(steps, flags, { cwd: root });

      expect(readReceipt(root)).toBeUndefined();
    }
  });

  it("clears an existing receipt when an unscoped run fails", async () => {
    const { root } = await recorded();
    await run([passing("alpha"), failing("beta")], {}, { cwd: root });

    expect(readReceipt(root)).toBeUndefined();
  });

  it("lets a full receipt answer a standard --reuse, and refuses a quality one", async () => {
    const root = worktreeFixture(FILES);
    const tree = worktreeHash(root) ?? "";
    const { calls, step } = counting();
    const steps = [step("alpha")];

    recordReceipt(root, { tree, mode: "quality", labels: ["alpha"] });
    await run(steps, { reuse: true }, { cwd: root });
    expect(calls).toEqual(["alpha"]);

    calls.length = 0;
    recordReceipt(root, { tree, mode: "full", labels: ["alpha"] });
    const { logs } = await run(steps, { reuse: true }, { cwd: root });
    expect(calls).toEqual([]);
    expect(logs).toEqual([`✓ verify — reused the passing full run of tree ${tree}; no step ran`]);
  });

  it("clears an existing receipt when an unscoped run skips a step", async () => {
    const { root } = await recorded();
    await run([passing("alpha"), passing("beta", ABSENT)], {}, { cwd: root });

    expect(readReceipt(root)).toBeUndefined();
  });

  it("runs when the table now selects a label the receipt never ran", async () => {
    const { root, calls, steps } = await recorded();
    const { step } = counting();
    await run([...steps, step("gamma")], { reuse: true }, { cwd: root });

    expect(calls).toEqual(["alpha", "beta"]);
  });

  it("withholds the receipt when a step changes the tree during the run", async () => {
    const root = worktreeFixture(FILES);
    const writer: Step = {
      label: "writer",
      run: () => {
        writeFileSync(join(root, "generated.txt"), "made\n");
        return checkResult([], "");
      },
    };
    const { logs } = await run([writer], {}, { cwd: root });

    expect(readReceipt(root)).toBeUndefined();
    expect(logs).toContain("○ the tree changed during the run — no receipt written");
  });

  it("records nothing outside a git work tree, and --reuse there says so and runs", async () => {
    const root = gateFixtureRoot();
    const { calls, step } = counting();
    await run([step("alpha")], {}, { cwd: root });
    const { logs, code } = await run([step("alpha")], { reuse: true }, { cwd: root });

    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(calls).toEqual(["alpha", "alpha"]);
    expect(logs[0]).toBe("○ not a git work tree — no receipt to reuse; running the gate");
    expect(code).toBeUndefined();
  });

  it("refuses --reuse with --only, --fix, --list or --affected, since it stands in for a whole run", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ only: ["alpha"] }, "only"],
      [{ fix: true }, "fix"],
      [{ list: true }, "list"],
      [{ affected: true }, "affected"],
    ];
    for (const [flags, name] of cases) {
      const { logs, code } = await run([passing("alpha")], { reuse: true, ...flags }, { cwd: worktreeFixture(FILES) });

      expect(logs).toEqual([`--reuse stands in for a whole gate run, so it takes no --${name}.`]);
      expect(code).toBe(1);
    }
  });
});

describe("createGateCommand() — --affected", () => {
  const FILES = { "package.json": "{}\n", "src/ui/a.tsx": "a\n", "docs/A.md": "a\n" };

  function counting(): { calls: string[]; step: (label: string, watches?: readonly string[]) => Step } {
    const calls: string[] = [];
    return {
      calls,
      step: (label, watches) => ({
        label,
        run: () => {
          calls.push(label);
          return checkResult([], "");
        },
        ...(watches === undefined ? {} : { watches }),
      }),
    };
  }

  function table(): { calls: string[]; steps: Step[] } {
    const { calls, step } = counting();
    return { calls, steps: [step("ui", ["src/ui/**"]), step("docs", ["docs/**"]), step("always")] };
  }

  it("runs only the step whose watches match the edit, and an undeclared step too", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "src/ui/a.tsx"), "edited\n");
    const { calls, steps } = table();
    const { code } = await run(steps, { affected: true }, { cwd: root });

    expect(calls).toEqual(["ui", "always"]);
    expect(code).toBeUndefined();
  });

  it("runs every step when a gate-wide input changes", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "package.json"), '{"name":"x"}\n');
    const { calls, steps } = table();
    await run(steps, { affected: true }, { cwd: root });

    expect(calls).toEqual(["ui", "docs", "always"]);
  });

  it("runs every step when a changed path matches a gateInputs glob", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "gen.ts"), "gen\n");
    const { calls, steps } = table();
    await run(steps, { affected: true }, { cwd: root, gateInputs: ["gen.ts"] });

    expect(calls).toEqual(["ui", "docs", "always"]);
  });

  it("calls no step on a clean tree, says so under the scoped banner, and exits normally", async () => {
    const root = worktreeFixture(FILES);
    const { calls, steps } = table();
    const { logs, code } = await run(steps, { affected: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(code).toBeUndefined();
    expect(logs).toEqual(["○ verify --affected — no change against HEAD; nothing ran ⚠ scoped run (0 of 3 steps) — not the gate"]);
  });

  it("says how many changed paths touch no step, calls none, and exits normally", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "notes.txt"), "notes\n");
    const { calls, steps } = table();
    const declared = steps.filter((step) => step.watches !== undefined);
    const { logs, code } = await run(declared, { affected: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(code).toBeUndefined();
    expect(logs).toEqual(["○ verify --affected — 1 changed path touches no step; nothing ran ⚠ scoped run (0 of 2 steps) — not the gate"]);
  });

  it("runs only the affected steps' fixers under --fix", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "docs/A.md"), "edited\n");
    const fixed: string[] = [];
    const fixable = (label: string, watches: readonly string[]): Step => ({
      label,
      run: () => checkResult([], ""),
      fix: () => {
        fixed.push(label);
      },
      watches,
    });
    const { code } = await run([fixable("ui", ["src/ui/**"]), fixable("docs", ["docs/**"])], { affected: true, fix: true }, { cwd: root });

    expect(fixed).toEqual(["docs"]);
    expect(code).toBeUndefined();
  });

  it("names the flag in the summary and brands the run scoped even when every step ran", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "package.json"), '{"name":"x"}\n');
    const { steps } = table();
    const { logs } = await run(steps, { affected: true, mode: "full" }, { cwd: root });

    expect(logs.at(-1)).toStartWith("✓ verify --mode full --affected — 3 steps passed (");
    expect(logs.at(-1)).toEndWith("⚠ scoped run (3 of 3 steps) — not the gate");
  });

  it("intersects --only with the affected selection", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "src/ui/a.tsx"), "edited\n");
    const { calls, steps } = table();
    await run(steps, { affected: true, only: ["ui", "docs"] }, { cwd: root });

    expect(calls).toEqual(["ui"]);
  });

  it("lists the affected selection under --list, running nothing", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "docs/A.md"), "edited\n");
    const { calls, steps } = table();
    const { logs } = await run(steps, { affected: true, list: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(logs).toEqual(["verify --affected — 2 steps\n  docs\n  always\n⚠ scoped run (2 of 3 steps) — not the gate"]);
  });

  it("writes no receipt for an --affected pass", async () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "src/ui/a.tsx"), "edited\n");
    const { steps } = table();
    await run(steps, { affected: true }, { cwd: root });

    expect(readReceipt(root)).toBeUndefined();
  });

  it("refuses outside a git work tree, where there is no diff to call affected", async () => {
    const { calls, steps } = table();
    const { logs, code } = await run(steps, { affected: true });

    expect(calls).toEqual([]);
    expect(logs).toEqual(["--affected reads its changes from git, and this is not a git work tree."]);
    expect(code).toBe(1);
  });
});
