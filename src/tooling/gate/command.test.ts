import { describe, expect, it } from "bun:test";

import type { CliContext } from "../cli/types";
import { PLAIN } from "../term/color";
import { createGateCommand } from "./command";
import { checkResult, fail } from "./finding";
import type { Step } from "./steps";

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
async function run(steps: readonly Step[], flags: Record<string, unknown> = {}): Promise<{ logs: string[]; code: number | undefined }> {
  const { ctx, logs } = context();
  const command = createGateCommand({ cwd: process.cwd(), steps });
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
    await run([recording], { mode: "fast" });
    await run([recording]);
    await run([recording], { full: true });

    expect(seen).toEqual(["fast", "standard", "full"]);
  });

  it("resolves a bare run to standard, so `verify` is the gate and fast is opt-in", async () => {
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
    const { logs, code } = await run([trivial], { mode: "fast", full: true });

    expect(logs).toContain("Pass --mode or --full, not both.");
    expect(code).toBe(1);
  });

  it("refuses an unrecognised --mode, naming the three it knows", async () => {
    const { logs, code } = await run([trivial], { mode: "nope" });

    expect(logs).toContain('Unknown --mode: "nope". Known modes: fast, standard, full.');
    expect(code).toBe(1);
  });

  it("names the mode canonically in the banner, since --full is an input spelling only", async () => {
    expect((await run([trivial], { mode: "fast", list: true })).logs).toEqual(["verify --mode fast — 1 step\n  alpha"]);
    expect((await run([trivial], { list: true })).logs).toEqual(["verify — 1 step\n  alpha"]);
    expect((await run([trivial], { full: true, list: true })).logs).toEqual(["verify --mode full — 1 step\n  alpha"]);
  });
});

describe("createGateCommand() — a step whose dependency is absent", () => {
  it("skips it in a fast run and counts it apart from the steps that passed", async () => {
    const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)]);

    expect(logs).toContain("○ delta — skipped (tailwindcss not found; run `bun add -d tailwindcss`)");
    expect(logs.at(-1)?.startsWith("✓ verify — 1 step passed, 1 skipped")).toBe(true);
    expect(code).toBeUndefined();
  });

  it("runs it when the probe finds the dependency, in a fast run as much as a full one", async () => {
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
    expect(logs.at(-1)).toBe("1 fixed, 1 skipped — re-run `bun run verify` to confirm.");
    expect(code).toBeUndefined();
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

  // Nothing here asserts a fixer's exit status: `proc.test.ts` mocks `node:child_process` with
  // `mock.module`, which is process-global, so a spawn's outcome is not this file's to predict.
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

  it("marks a step with a dependency conditional in a fast run, executing none of them", async () => {
    const { logs, code } = await run([passing("alpha"), exploding], { list: true });

    expect(logs).toEqual(["verify — 2 steps\n  alpha\n  validate-class-groups (conditional — tailwindcss required)"]);
    expect(code).toBeUndefined();
  });

  it("states the dependency as required under --full, where its absence is a failure", async () => {
    const { logs } = await run([exploding], { list: true, full: true });

    expect(logs).toEqual(["verify --mode full — 1 step\n  validate-class-groups (requires tailwindcss)"]);
  });
});
