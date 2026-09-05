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

const ABSENT = { tool: "tailwindcss", probe: () => false, hint: "bun add -d tailwindcss" };
const PRESENT = { tool: "tailwindcss", probe: () => true, hint: "bun add -d tailwindcss" };

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
  console.log = (msg: string) => logs.push(msg);
  let code: number | undefined;
  try {
    await command.run?.([], { full: false, list: false, fix: false, only: [], ...flags } as never, ctx);
  } catch (error) {
    if (!(error instanceof Exited)) throw error;
    code = error.code;
  } finally {
    console.log = original;
  }
  return { logs, code };
}

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
    expect(logs.at(-1)?.startsWith("✗ verify --full — failed at `delta` (step 2 of 2")).toBe(true);
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
        hint: "bun add -d tailwindcss",
      },
    };
    const { logs, code } = await run([check], { fix: true, full: true });

    expect(probed).toEqual([]);
    expect(logs.at(-1)).toBe("0 fixed, 1 without a fixer — re-run `bun run verify --full` to confirm.");
    expect(code).toBeUndefined();
  });

  // Nothing here asserts a fixer's exit status: `proc.test.ts` mocks `node:child_process` with
  // `mock.module`, which is process-global, so a spawn's outcome is not this file's to predict.
  it("runs every fixer the selection holds rather than stopping at the first", async () => {
    const { logs } = await run([fixable("beta"), fixable("alpha")], { fix: true });

    expect(logs.filter((line) => line.includes("fix:")).length).toBe(2);
  });
});

describe("createGateCommand() — --list", () => {
  const exploding: Step = {
    label: "validate-class-groups",
    run: () => {
      throw new Error("--list must run nothing at all");
    },
    requires: { tool: "tailwindcss", probe: () => false, hint: "bun add -d tailwindcss" },
  };

  it("marks a step with a dependency conditional in a fast run, executing none of them", async () => {
    const { logs, code } = await run([passing("alpha"), exploding], { list: true });

    expect(logs).toEqual(["verify — 2 steps\n  alpha\n  validate-class-groups (conditional — tailwindcss required)"]);
    expect(code).toBeUndefined();
  });

  it("states the dependency as required under --full, where its absence is a failure", async () => {
    const { logs } = await run([exploding], { list: true, full: true });

    expect(logs).toEqual(["verify --full — 1 step\n  validate-class-groups (requires tailwindcss)"]);
  });
});
