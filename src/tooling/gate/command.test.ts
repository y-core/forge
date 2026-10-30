import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { parseArgs } from "../cli/parse";
import type { CliContext } from "../cli/types";
import { worktreeHash, worktreeHead } from "../cli/worktree";
import { cloneWorktree, worktreeFixture } from "../cli/worktree.fixture";
import { PLAIN } from "../term/color";
import { browserRequired, COMPAT_SERVER, PRIMARY_SERVER } from "./builders";
import { gateFixtureRoot } from "./checks/gate.fixture";
import { createGateCommand } from "./command";
import { checkResult, fail } from "./finding";
import { clearReceipt, readReceipt, recordReceipt } from "./receipt";
import type { CommandStep, GateRunReport, Step, StepResults, TestFailure } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(...args: Parameters<typeof gateFixtureRoot>): string {
  const root = gateFixtureRoot(...args);
  roots.push(root);
  return root;
}

function worktreeRoot(...args: Parameters<typeof worktreeFixture>): string {
  const root = worktreeFixture(...args);
  roots.push(root);
  return root;
}

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
  opts: { cwd?: string; gateInputs?: readonly string[]; receipt?: boolean } = {},
): Promise<{ logs: string[]; code: number | undefined }> {
  const { ctx, logs } = context();
  const command = createGateCommand({
    cwd: opts.cwd ?? fixtureRoot(),
    steps,
    ...(opts.gateInputs === undefined ? {} : { gateInputs: opts.gateInputs }),
    ...(opts.receipt === undefined ? {} : { receipt: opts.receipt }),
  });
  const original = console.log;
  const originalError = console.error;
  console.log = (msg: string) => logs.push(msg);
  // A refusal is written to stderr, so a test asserting one has to see both streams.
  console.error = (msg: string) => logs.push(msg);
  let code: number | undefined;
  try {
    await command.run?.([], { list: false, fix: false, only: [], ...flags } as never, ctx);
  } catch (error) {
    if (!(error instanceof Exited)) throw error;
    code = error.code;
  } finally {
    console.log = original;
    console.error = originalError;
  }
  return { logs, code };
}

describe("createGateCommand() — the tier reaches a check", () => {
  const seen: string[] = [];
  const recording: Step = {
    label: "validate-thing",
    run: (tier) => {
      seen.push(tier);
      return checkResult([], "");
    },
  };

  it("hands a check the tier of the run, which a check may vary its strictness on", async () => {
    seen.length = 0;
    for (const tier of ["static", "unit", "runtime", "scheduled"]) await run([recording], { tier });

    expect(seen).toEqual(["static", "unit", "runtime", "scheduled"]);
  });

  it("resolves a bare run to runtime, so `verify` is the run a task closes on", async () => {
    seen.length = 0;
    await run([recording]);

    expect(seen).toEqual(["runtime"]);
  });
});

describe("createGateCommand() — resolving the tier", () => {
  const trivial: Step = { label: "alpha", run: () => checkResult([], "") };
  const flags = createGateCommand({ cwd: "/nowhere", steps: [trivial] }).flags;

  it("refuses an unrecognised --tier, the retired `deploy` included, naming the four it knows and running nothing", async () => {
    const called: string[] = [];
    const recording: Step = { label: "alpha", run: () => (called.push("alpha"), checkResult([], "")) };
    const { logs, code } = await run([recording], { tier: "deploy" });

    expect({ logs, code, called }).toEqual({
      logs: ['Unknown --tier: "deploy". Known tiers: static, unit, runtime, scheduled.'],
      code: 1,
      called: [],
    });
  });

  it("refuses the retired `release` tier, which is `scheduled` now, with no alias", async () => {
    const { logs, code } = await run([trivial], { tier: "release" });

    expect({ logs, code }).toEqual({ logs: ['Unknown --tier: "release". Known tiers: static, unit, runtime, scheduled.'], code: 1 });
  });

  it("knows neither --mode nor --full, so a retired spelling is refused as an unknown flag", () => {
    expect(() => parseArgs(["--mode", "full"], flags)).toThrow("Unknown flag: --mode");
    expect(() => parseArgs(["--full"], flags)).toThrow("Unknown flag: --full");
  });

  it("names a tier other than runtime in the banner, and a bare run as plain `verify`", async () => {
    expect((await run([trivial], { tier: "static", list: true })).logs).toEqual(["verify --tier static — 1 step\n  alpha"]);
    expect((await run([trivial], { list: true })).logs).toEqual(["verify — 1 step\n  alpha"]);
    expect((await run([trivial], { tier: "runtime", list: true })).logs).toEqual(["verify — 1 step\n  alpha"]);
    expect((await run([trivial], { tier: "scheduled", list: true })).logs).toEqual(["verify --tier scheduled — 1 step\n  alpha"]);
  });
});

describe("createGateCommand() — a step whose dependency is absent", () => {
  it("skips it below the runtime tier but refuses to call the run green, and exits non-zero", async () => {
    for (const tier of ["static", "unit"]) {
      const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)], { tier });

      expect(logs).toContain("○ delta — skipped (tailwindcss not found; run `bun add -d tailwindcss`)");
      expect(logs.at(-1)?.startsWith(`○ verify --tier ${tier} — 1 step passed, 1 step skipped`)).toBe(true);
      expect(code).toBe(1);
    }
  });

  it("fails it from the runtime tier up, which promise that a runtime ran", async () => {
    for (const tier of ["runtime", "scheduled"]) {
      const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)], { tier });

      expect(logs).toContain("✗ delta — tailwindcss not found; run `bun add -d tailwindcss`");
      expect(logs.at(-1)).toContain("failed at `delta` (step 2 of 2");
      expect(code).toBe(1);
    }
  });

  it("names the skip in the closing line", async () => {
    const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)], { tier: "unit" });

    expect(logs.at(-1)).toContain("not green: 1 step never ran");
    expect(code).toBe(1);
  });

  it("probes one tool once however many steps name it, since the probe shells out", async () => {
    let probes = 0;
    const counted = { tool: "tailwindcss", probe: () => ((probes += 1), false), hint: "run `bun add -d tailwindcss`" };
    await run([passing("alpha", counted), passing("beta", counted), passing("gamma", counted)], { tier: "unit" });

    expect(probes).toBe(1);
  });

  it("awaits a probe that answers asynchronously, reporting the step missing when it settles false", async () => {
    const remote = { tool: "Playwright server", probe: () => Promise.resolve(false), hint: "start the sidecar" };
    const { logs, code } = await run([passing("delta", remote)]);

    expect(logs).toContain("✗ delta — Playwright server not found; start the sidecar");
    expect(code).toBe(1);
  });

  it("gives every browser step under one Playwright server the hint its one probe earned", async () => {
    const probes = {
      env: { PW_TEST_CONNECT_WS_ENDPOINT: "ws://shared.test:3000/" },
      serverStatus: () => Promise.resolve({ state: "mismatch" as const, server: "1.64" }),
    };
    const { logs } = await run(
      [passing("journey", browserRequired(PRIMARY_SERVER, probes)), passing("layout", browserRequired(PRIMARY_SERVER, probes))],
      { tier: "unit" },
    );
    const skips = logs.filter((line) => line.startsWith("○ journey") || line.startsWith("○ layout"));

    expect(skips).toHaveLength(2);
    expect(skips.every((line) => line.includes("the server runs Playwright 1.64"))).toBe(true);
  });

  it("gives every cross-engine row under the compat server the hint its one probe earned", async () => {
    const probes = {
      env: { PLAYWRIGHT_COMPAT_WS_ENDPOINT: "ws://compat.test:3000/" },
      serverStatus: () => Promise.resolve({ state: "mismatch" as const, server: "1.64" }),
    };
    const { logs } = await run(
      [passing("firefox", browserRequired(COMPAT_SERVER, probes)), passing("webkit", browserRequired(COMPAT_SERVER, probes))],
      { tier: "unit" },
    );
    const skips = logs.filter((line) => line.startsWith("○ firefox") || line.startsWith("○ webkit"));

    expect(skips).toHaveLength(2);
    expect(skips.every((line) => line.includes("the server runs Playwright 1.64"))).toBe(true);
  });

  it("runs it when the probe finds the dependency, in a static run as much as a scheduled one", async () => {
    const { logs, code } = await run([passing("delta", PRESENT)]);

    expect(logs.some((line) => line.startsWith("✓ delta"))).toBe(true);
    expect(logs.at(-1)?.startsWith("✓ verify — 1 step passed (")).toBe(true);
    expect(code).toBeUndefined();
  });

  it("fails the scheduled gate rather than skipping, since `--tier scheduled` is what a publish is checked by", async () => {
    const { logs, code } = await run([passing("alpha"), passing("delta", ABSENT)], { tier: "scheduled" });

    expect(logs.at(-1)?.startsWith("✗ verify --tier scheduled — failed at `delta` (step 2 of 2")).toBe(true);
    expect(code).toBe(1);
  });

  it("refuses a green when every selected step was skipped", async () => {
    const { logs, code } = await run([passing("alpha", ABSENT), passing("beta", ABSENT), passing("gamma", ABSENT)], { tier: "unit" });

    expect(logs.at(-1)).toMatch(
      /^✗ verify --tier unit — every step skipped \(0 of 3 ran, .+\) — refusing to report a green gate that ran nothing$/,
    );
    expect(code).toBe(1);
  });

  it("counts a skip in the failure line, and states the failing step's position rather than a run count", async () => {
    const { logs, code } = await run([passing("alpha"), passing("skipped", ABSENT), failing("beta"), passing("gamma")], { tier: "unit" });

    expect(logs.at(-1)?.startsWith("✗ verify --tier unit — failed at `beta` (step 3 of 4, 1 skipped")).toBe(true);
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
    const { logs, code } = await run([fixable("alpha"), fixable("delta", ABSENT)], { fix: true, tier: "unit" });

    expect(logs.some((line) => line.startsWith("✓ fix:alpha"))).toBe(true);
    expect(logs.some((line) => line.startsWith("✓ fix:delta") || line.startsWith("✗ fix:delta"))).toBe(false);
    expect(logs.at(-1)).toBe(
      "1 fixed, 1 step skipped — that step was not fixed; install what each skip line above names, then re-run `bun run verify --tier unit`.",
    );
    expect(code).toBe(1);
  });

  // A step with no fixer was never going to spawn, so probing it would report a dependency this run
  // does not need.
  it("asks the fixer question before the dependency question, even at the scheduled tier", async () => {
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
    const { logs, code } = await run([check], { fix: true, tier: "scheduled" });

    expect(probed).toEqual([]);
    expect(logs.at(-1)).toBe("0 fixed, 1 without a fixer — re-run `bun run verify --tier scheduled` to confirm.");
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

  it("marks a step with a dependency conditional below the runtime tier, executing none of them", async () => {
    const { logs, code } = await run([passing("alpha"), exploding], { list: true, tier: "unit" });

    expect(logs).toEqual(["verify --tier unit — 2 steps\n  alpha\n  validate-class-groups (conditional — tailwindcss required)"]);
    expect(code).toBeUndefined();
  });

  it("states the dependency as required at the scheduled tier, where its absence is a failure", async () => {
    const { logs } = await run([exploding], { list: true, tier: "scheduled" });

    expect(logs).toEqual(["verify --tier scheduled — 1 step\n  validate-class-groups (requires tailwindcss)"]);
  });
});

describe("createGateCommand() — the receipt a passing run records", () => {
  const FILES = { ".gitignore": "ignored.log\n", "a.txt": "alpha\n", "b.txt": "beta\n" };
  const TEMPLATE = worktreeRoot(FILES);

  function worktreeClone(): string {
    const root = cloneWorktree(TEMPLATE);
    roots.push(root);
    return root;
  }

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
    const root = worktreeClone();
    const { calls, step } = counting();
    const steps = [step("alpha"), step("beta")];
    await run(steps, {}, { cwd: root });
    calls.length = 0;
    return { root, calls, steps };
  }

  it("records the tree, tier, HEAD commit and labels of an unscoped pass", async () => {
    const root = worktreeClone();
    const { step } = counting();
    const { code } = await run([step("alpha"), step("beta")], {}, { cwd: root });

    expect(code).toBeUndefined();
    expect(readReceipt(root)).toEqual({
      tree: worktreeHash(root) ?? "",
      tier: "runtime",
      base: worktreeHead(root) ?? "",
      labels: ["alpha", "beta"],
    });
  });

  it("neither records nor clears a receipt when the table is not the gate's", async () => {
    const { root, steps } = await recorded();
    const standing = readReceipt(root);
    await run([failing("cross-engine")], {}, { cwd: root, receipt: false });
    expect(readReceipt(root)).toEqual(standing);

    clearReceipt(root);
    await run(steps, {}, { cwd: root, receipt: false });
    expect(readReceipt(root)).toBeUndefined();
  });

  it("answers --reuse on the same tree without calling a step, naming the hash", async () => {
    const { root, calls, steps } = await recorded();
    const { logs, code } = await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(code).toBeUndefined();
    expect(logs).toEqual([`✓ verify — reused the passing runtime run of tree ${worktreeHash(root) ?? ""}; no step ran`]);
  });

  it("runs the gate under --reuse after a tracked file is edited", async () => {
    const { root, calls, steps } = await recorded();
    writeFileSync(join(root, "a.txt"), "edited\n");
    const { logs } = await run(steps, { reuse: true }, { cwd: root });

    expect(calls).toEqual(["alpha", "beta"]);
    expect(logs[0]).toBe(`○ no passing run of tree ${worktreeHash(root) ?? ""} on record at runtime or above; running the gate`);
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
      [[passing("alpha"), passing("beta", absent)], { tier: "unit" }],
    ];
    for (const [steps, flags] of cases) {
      const root = worktreeClone();
      await run(steps, flags, { cwd: root });

      expect(readReceipt(root)).toBeUndefined();
    }
  });

  it("clears an existing receipt when an unscoped run fails", async () => {
    const { root } = await recorded();
    await run([passing("alpha"), failing("beta")], {}, { cwd: root });

    expect(readReceipt(root)).toBeUndefined();
  });

  it("lets a deploy receipt answer a runtime --reuse, and refuses a unit one", async () => {
    const root = worktreeClone();
    const tree = worktreeHash(root) ?? "";
    const { calls, step } = counting();
    const steps = [step("alpha")];

    recordReceipt(root, { tree, tier: "unit", labels: ["alpha"] });
    await run(steps, { reuse: true }, { cwd: root });
    expect(calls).toEqual(["alpha"]);

    clearReceipt(root);
    calls.length = 0;
    recordReceipt(root, { tree, tier: "scheduled", base: "0".repeat(40), labels: ["alpha"] });
    const { logs } = await run(steps, { reuse: true }, { cwd: root });
    expect(calls).toEqual([]);
    expect(logs).toEqual([`✓ verify — reused the passing scheduled run of tree ${tree}; no step ran`]);
  });

  it("refuses a runtime receipt recorded against another HEAD, and reuses one recorded against this one", async () => {
    const root = worktreeClone();
    const tree = worktreeHash(root) ?? "";
    const { calls, step } = counting();
    const steps = [step("alpha")];

    recordReceipt(root, { tree, tier: "runtime", base: "0".repeat(40), labels: ["alpha"] });
    await run(steps, { reuse: true }, { cwd: root });
    expect(calls).toEqual(["alpha"]);

    calls.length = 0;
    await run(steps, { reuse: true }, { cwd: root });
    expect(calls).toEqual([]);
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
    const root = worktreeClone();
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
    const root = fixtureRoot();
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
      const { logs, code } = await run([passing("alpha")], { reuse: true, ...flags }, { cwd: worktreeClone() });

      expect(logs).toEqual([`--reuse stands in for a whole gate run, so it takes no --${name}.`]);
      expect(code).toBe(1);
    }
  });
});

describe("createGateCommand() — --affected", () => {
  const FILES = { "package.json": "{}\n", "src/ui/a.tsx": "a\n", "docs/A.md": "a\n" };
  const TEMPLATE = worktreeRoot(FILES);

  function worktreeClone(): string {
    const root = cloneWorktree(TEMPLATE);
    roots.push(root);
    return root;
  }

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
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/a.tsx"), "edited\n");
    const { calls, steps } = table();
    const { code } = await run(steps, { affected: true }, { cwd: root });

    expect(calls).toEqual(["ui", "always"]);
    expect(code).toBeUndefined();
  });

  it("runs every step when a gate-wide input changes", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "package.json"), '{"name":"x"}\n');
    const { calls, steps } = table();
    await run(steps, { affected: true }, { cwd: root });

    expect(calls).toEqual(["ui", "docs", "always"]);
  });

  it("runs every step when a changed path matches a gateInputs glob", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "gen.ts"), "gen\n");
    const { calls, steps } = table();
    await run(steps, { affected: true }, { cwd: root, gateInputs: ["gen.ts"] });

    expect(calls).toEqual(["ui", "docs", "always"]);
  });

  it("calls no step on a clean tree, says so under the scoped banner, and exits normally", async () => {
    const root = worktreeClone();
    const { calls, steps } = table();
    const { logs, code } = await run(steps, { affected: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(code).toBeUndefined();
    expect(logs).toEqual(["○ verify --affected — no change against HEAD; nothing ran ⚠ scoped run (0 of 3 steps) — not the gate"]);
  });

  it("says how many changed paths touch no step, calls none, and exits normally", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "notes.txt"), "notes\n");
    const { calls, steps } = table();
    const declared = steps.filter((step) => step.watches !== undefined);
    const { logs, code } = await run(declared, { affected: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(code).toBeUndefined();
    expect(logs).toEqual(["○ verify --affected — 1 changed path touches no step; nothing ran ⚠ scoped run (0 of 2 steps) — not the gate"]);
  });

  it("runs only the affected steps' fixers under --fix", async () => {
    const root = worktreeClone();
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
    const root = worktreeClone();
    writeFileSync(join(root, "package.json"), '{"name":"x"}\n');
    const { steps } = table();
    const { logs } = await run(steps, { affected: true, tier: "scheduled" }, { cwd: root });

    expect(logs.at(-1)).toStartWith("✓ verify --tier scheduled --affected — 3 steps passed (");
    expect(logs.at(-1)).toEndWith("⚠ scoped run (3 of 3 steps) — not the gate");
  });

  it("intersects --only with the affected selection", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/a.tsx"), "edited\n");
    const { calls, steps } = table();
    await run(steps, { affected: true, only: ["ui", "docs"] }, { cwd: root });

    expect(calls).toEqual(["ui"]);
  });

  it("lists the affected selection under --list, running nothing", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "docs/A.md"), "edited\n");
    const { calls, steps } = table();
    const { logs } = await run(steps, { affected: true, list: true }, { cwd: root });

    expect(calls).toEqual([]);
    expect(logs).toEqual(["verify --affected — 2 steps\n  docs\n  always\n⚠ scoped run (2 of 3 steps) — not the gate"]);
  });

  it("writes no receipt for an --affected pass", async () => {
    const root = worktreeClone();
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

describe("createGateCommand() — the runtime tier's narrowing", () => {
  const FILES = { "src/ui/a.ts": "a\n", "src/ui/theme.css": "t\n", "db/schema.sql": "s\n", "docs/A.md": "a\n" };
  const TEMPLATE = worktreeRoot(FILES);

  function worktreeClone(): string {
    const root = cloneWorktree(TEMPLATE);
    roots.push(root);
    return root;
  }

  // Each row writes the arguments it was spawned with outside the tree, so a test reads back how the runner reached it.
  const out = fixtureRoot();
  const recording = (label: string, watches: readonly string[], narrow?: CommandStep["narrow"]): CommandStep => ({
    label,
    tier: "runtime",
    tail: 5,
    cmd: ["sh", "-c", `printf '%s ' "$@" > "${out}/$(basename "$PWD")-${label}.args"`, "sh", "whole"],
    watches,
    ...(narrow === undefined ? {} : { narrow }),
  });

  const table = (): Step[] => [
    passing("lint"),
    recording("browser", ["src/**"], { args: ["--only-changed"], wide: ["src/ui/theme.css"] }),
    recording("db", ["db/**"]),
  ];

  const spawnedWith = (root: string, label: string): string | undefined => {
    const path = join(out, `${basename(root)}-${label}.args`);
    return existsSync(path) ? readFileSync(path, "utf-8").trim() : undefined;
  };

  it("runs a touched row with its narrow arguments, reports an untouched one, and is a gate green", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/a.ts"), "edited\n");
    const { logs, code } = await run(table(), {}, { cwd: root });

    expect(spawnedWith(root, "browser")).toBe("whole --only-changed");
    expect(spawnedWith(root, "db")).toBeUndefined();
    expect(logs).toContain("○ db — untouched by 1 change");
    expect(logs.at(-1)).toMatch(/^✓ verify — 2 steps passed \([^)]+\)$/);
    expect(code).toBeUndefined();
  });

  it("runs a row whole when a pending change matches its `wide` globs", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/theme.css"), "new\n");
    await run(table(), {}, { cwd: root });

    expect(spawnedWith(root, "browser")).toBe("whole");
  });

  it("runs every runtime row whole when a gate input changes", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "tools.ts"), "new\n");
    await run(table(), {}, { cwd: root, gateInputs: ["tools.ts"] });

    expect([spawnedWith(root, "browser"), spawnedWith(root, "db")]).toEqual(["whole", "whole"]);
  });

  it("runs no runtime row on a clean tree, and records only the rows that ran", async () => {
    const root = worktreeClone();
    const { logs } = await run(table(), {}, { cwd: root });

    expect(logs).toContain("○ browser — untouched by 0 changes");
    expect(logs).toContain("○ db — untouched by 0 changes");
    expect(readReceipt(root)?.labels).toEqual(["lint"]);
  });

  it("records a narrowed run's receipt against HEAD, naming only the rows that ran", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/a.ts"), "edited\n");
    await run(table(), {}, { cwd: root });

    expect(readReceipt(root)).toEqual({
      tree: worktreeHash(root) ?? "",
      tier: "runtime",
      base: worktreeHead(root) ?? "",
      labels: ["lint", "browser"],
    });
  });

  it("never probes an untouched row, so a runtime it would need is not asked for", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/a.ts"), "edited\n");
    const probed: string[] = [];
    const absent = { tool: "workerd", probe: () => (probed.push("db"), false), hint: "run `bun install`" };
    const { code } = await run([passing("lint"), { ...recording("db", ["db/**"]), requires: absent }], {}, { cwd: root });

    expect({ probed, code }).toEqual({ probed: [], code: undefined });
  });

  it("runs every row whole at the scheduled tier, whatever is pending", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "docs/A.md"), "edited\n");
    await run(table(), { tier: "scheduled" }, { cwd: root });

    expect([spawnedWith(root, "browser"), spawnedWith(root, "db")]).toEqual(["whole", "whole"]);
  });

  it("refuses a table whose nested glob matches no file in the work tree, before any row runs", async () => {
    const root = worktreeClone();
    const { logs, code } = await run([passing("lint"), recording("db", ["database/**"])], {}, { cwd: root });

    expect(logs).toEqual([
      'Step "db" declares `watches` glob "database/**", which matches no file in the work tree — a renamed path no longer reaches the step, so update the glob.',
    ]);
    expect(code).toBe(1);
  });

  it("lists how each runtime row reaches the pending changes", async () => {
    const root = worktreeClone();
    writeFileSync(join(root, "src/ui/a.ts"), "edited\n");
    const { logs } = await run(table(), { list: true }, { cwd: root });

    expect(logs).toEqual(["verify — 3 steps\n  lint\n  browser (narrowed to pending changes)\n  db (untouched)"]);
  });
});

describe("createGateCommand() — a row that traces or probes before it narrows", () => {
  const FILES = { "src/ui/a.ts": "a\n", "src/ui/exposed.ts": "e\n", "docs/A.md": "a\n" };
  const TEMPLATE = worktreeRoot(FILES);
  const out = fixtureRoot();

  function editedClone(path = "src/ui/a.ts"): string {
    const root = cloneWorktree(TEMPLATE);
    roots.push(root);
    writeFileSync(join(root, path), "edited\n");
    return root;
  }

  // Answers `--list` with `listing` and `exit`, recording that it was asked; any other run records its arguments.
  const probing = (listing: string, exit = 0, reach: { wide?: readonly string[]; widen?: Step["widen"] } = {}): CommandStep => ({
    label: "browser",
    tier: "runtime",
    tail: 5,
    cmd: [
      "sh",
      "-c",
      `case " $* " in *" --list "*) touch "${out}/$(basename "$PWD").probed"; printf '%s' '${listing}'; exit ${exit};; esac; printf '%s ' "$@" > "${out}/$(basename "$PWD").args"`,
      "sh",
      "whole",
    ],
    narrow: {
      args: ["--only-changed"],
      probe: { args: ["--list"], selects: (output) => output !== "none" },
      ...(reach.wide === undefined ? {} : { wide: reach.wide }),
    },
    ...(reach.widen === undefined ? {} : { widen: reach.widen }),
  });

  const outcome = (root: string): { probed: boolean; args: string | undefined } => {
    const args = join(out, `${basename(root)}.args`);
    return { probed: existsSync(join(out, `${basename(root)}.probed`)), args: existsSync(args) ? readFileSync(args, "utf-8").trim() : undefined };
  };

  it("leaves a row its probe selects nothing for untouched, saying which probe found so, and records only the rows that ran", async () => {
    const root = editedClone();
    const { logs, code } = await run([passing("lint"), probing("none")], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: true, args: undefined });
    expect(logs.find((line) => line.startsWith("○ browser"))).toMatch(
      /^○ browser — untouched by 1 change: `sh -c .* --only-changed --list` selects nothing$/,
    );
    expect(readReceipt(root)?.labels).toEqual(["lint"]);
    expect(code).toBeUndefined();
  });

  it("runs a row narrowed when its probe selects something", async () => {
    const root = editedClone();
    await run([probing("one spec")], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: true, args: "whole --only-changed" });
  });

  it("runs a row whole when its probe exits non-zero, never untouched", async () => {
    const root = editedClone();
    await run([probing("none", 1)], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: true, args: "whole" });
  });

  it("runs a row whole without probing when a pending change is a path its `widen` traces", async () => {
    const root = editedClone("src/ui/exposed.ts");
    await run([probing("none", 0, { widen: () => ["src/ui/exposed.ts"] })], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: false, args: "whole" });
  });

  it("probes a row whose `widen` traces none of the pending changes", async () => {
    const root = editedClone();
    await run([probing("none", 0, { widen: async () => ["src/ui/exposed.ts"] })], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: true, args: undefined });
  });

  it("runs a row its watches leave untouched whole when a pending change is a path its `widen` traces from the gate's root", async () => {
    const root = editedClone("src/ui/exposed.ts");
    const seen: string[] = [];
    const step: CommandStep = {
      label: "db",
      tier: "runtime",
      tail: 5,
      cmd: ["sh", "-c", `printf '%s ' "$@" > "${out}/$(basename "$PWD").args"`, "sh", "whole"],
      watches: ["docs/**"],
      widen: (cwd) => (seen.push(cwd), ["src/ui/exposed.ts"]),
    };
    await run([step], {}, { cwd: root });

    expect({ seen, args: outcome(root).args }).toEqual({ seen: [root], args: "whole" });
  });

  it("runs a row whole when its `widen` throws", async () => {
    const root = editedClone();
    const widen = (): string[] => {
      throw new Error("no bundler");
    };
    await run([probing("none", 0, { widen })], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: false, args: "whole" });
  });

  it("runs a row whole without probing when its `widen` rejects", async () => {
    const root = editedClone();
    await run([probing("none", 0, { widen: () => Promise.reject(new Error("bundle failed")) })], {}, { cwd: root });

    expect(outcome(root)).toEqual({ probed: false, args: "whole" });
  });

  it("runs a row whole when its probe cannot be spawned, never untouched", async () => {
    const root = editedClone();
    const unspawnable: CommandStep = { ...probing("none"), label: "absent", cmd: ["forge-no-such-binary", "test"] };
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = mkdtempSync(join(tmpdir(), "forge-system-tmp-"));
    const { logs, code } = await run([unspawnable], {}, { cwd: root }).finally(() => {
      rmSync(process.env.TMPDIR!, { recursive: true, force: true });
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    });

    expect(logs.find((line) => line.includes(" absent"))).toMatch(/^✗ absent \([^)]+\)$/);
    expect(code).toBe(1);
  });

  it("runs a row whole without probing when a gate input or a `wide` glob changes", async () => {
    const gateInput = editedClone("docs/A.md");
    await run([probing("none")], {}, { cwd: gateInput, gateInputs: ["docs/**"] });
    const wide = editedClone("docs/A.md");
    await run([probing("none", 0, { wide: ["docs/**"] })], {}, { cwd: wide });

    expect([outcome(gateInput), outcome(wide)]).toEqual([
      { probed: false, args: "whole" },
      { probed: false, args: "whole" },
    ]);
  });

  it("never probes at the scheduled tier, where every row runs whole", async () => {
    const root = editedClone();
    await run([probing("none")], { tier: "scheduled" }, { cwd: root });

    expect(outcome(root)).toEqual({ probed: false, args: "whole" });
  });

  it("never asks for the prerequisite of a row its probe leaves untouched", async () => {
    const root = editedClone();
    const probed: string[] = [];
    const absent = { tool: "playwright server", probe: () => (probed.push("browser"), false), hint: "start it" };
    const { code } = await run([passing("lint"), { ...probing("none"), requires: absent }], {}, { cwd: root });

    expect({ probed, code }).toEqual({ probed: [], code: undefined });
  });

  it("lists the reach the probe and the trace settle on", async () => {
    const untouched = editedClone();
    const traced = editedClone("src/ui/exposed.ts");
    const listed = async (root: string, step: CommandStep): Promise<string[]> => (await run([step], { list: true }, { cwd: root })).logs;

    expect(await listed(untouched, probing("none"))).toEqual(["verify — 1 step\n  browser (untouched)"]);
    expect(await listed(traced, probing("none", 0, { widen: () => ["src/ui/exposed.ts"] }))).toEqual(["verify — 1 step\n  browser"]);
  });

  it("reuses a receipt whose run the probe left the row out of, without probing again", async () => {
    const root = editedClone();
    await run([passing("lint"), probing("none")], {}, { cwd: root });
    rmSync(join(out, `${basename(root)}.probed`));
    const { logs } = await run([passing("lint"), probing("none")], { reuse: true }, { cwd: root });

    expect(logs.at(-1)).toStartWith("✓ verify — reused the passing runtime run");
    expect(outcome(root).probed).toBe(false);
  });
});

describe("createGateCommand() — a spawned step's temp dir", () => {
  const saved = process.env.TMPDIR;
  let systemTmp = "";

  beforeEach(() => {
    systemTmp = mkdtempSync(join(tmpdir(), "forge-system-tmp-"));
    process.env.TMPDIR = systemTmp;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
    rmSync(systemTmp, { recursive: true, force: true });
  });

  const recording = (label: string, record: string): CommandStep => {
    const script = `mkdir "$TMPDIR/left-behind" && printf '%s' "$TMPDIR" > "${record}"`;
    return { label, tail: 5, cmd: ["sh", "-c", script], fix: ["sh", "-c", script] };
  };
  const seen = (record: string): { stepTmp: string } => ({ stepTmp: readFileSync(record, "utf-8") });

  it("gives the step its own TMPDIR and removes it, with what the step left there, when the step exits", async () => {
    const root = fixtureRoot();
    const record = join(root, "step-tmpdir");
    const { code } = await run([recording("leaves", record)], {}, { cwd: root });

    const { stepTmp } = seen(record);
    expect(code).toBeUndefined();
    expect(stepTmp).not.toBe(systemTmp);
    expect(existsSync(stepTmp)).toBe(false);
  });

  it("fails a step that opts into leavesNoTemp and leaves something behind, naming the entry", async () => {
    const root = fixtureRoot();
    const record = join(root, "strict");
    const { logs, code } = await run([{ ...recording("strict", record), leavesNoTemp: true }], {}, { cwd: root });

    expect(code).toBe(1);
    expect(logs.some((line) => line.includes("left in its TMPDIR: left-behind"))).toBe(true);
    expect(existsSync(seen(record).stepTmp)).toBe(false);
  });

  it("reports an undeclared leftover and never a declared cache, both left by the same step", async () => {
    const root = fixtureRoot();
    const script = 'mkdir "$TMPDIR/transform-cache-1000" "$TMPDIR/stray"';
    const step: CommandStep = { label: "cached", tail: 5, cmd: ["sh", "-c", script], leavesNoTemp: true, tempCaches: ["transform-cache-*"] };
    const { logs, code } = await run([step], {}, { cwd: root });

    expect(code).toBe(1);
    expect(logs.some((line) => line.includes("left in its TMPDIR: stray"))).toBe(true);
    expect(logs.some((line) => line.includes("transform-cache-1000"))).toBe(false);
  });

  it("passes a step that opts into leavesNoTemp and leaves nothing", async () => {
    const root = fixtureRoot();
    const { code } = await run(
      [{ label: "tidy", tail: 5, cmd: ["sh", "-c", 'mkdir "$TMPDIR/x" && rmdir "$TMPDIR/x"'], leavesNoTemp: true }],
      {},
      { cwd: root },
    );

    expect(code).toBeUndefined();
  });

  it("removes a fixer's TMPDIR the same way", async () => {
    const root = fixtureRoot();
    const record = join(root, "fix-tmpdir");
    await run([recording("leaves", record)], { fix: true }, { cwd: root });

    const { stepTmp } = seen(record);
    expect(stepTmp).not.toBe(systemTmp);
    expect(existsSync(stepTmp)).toBe(false);
  });

  it("gives each step a TMPDIR of its own", async () => {
    const root = fixtureRoot();
    const records = [join(root, "first"), join(root, "second")];
    await run([recording("first", records[0]!), recording("second", records[1]!)], {}, { cwd: root });

    const [first, second] = records.map(seen);
    expect(first?.stepTmp).not.toBe(second?.stepTmp);
  });

  it("keeps a failed step's full log on disk at the path it reports", async () => {
    const root = fixtureRoot();
    const { logs, code } = await run([{ label: "test:broken", tail: 5, cmd: ["sh", "-c", "echo the whole story; exit 3"] }], {}, { cwd: root });

    const reported = logs.find((line) => line.startsWith("    full log at "))?.slice("    full log at ".length) ?? "";
    expect(code).toBe(1);
    expect(reported.startsWith(join(systemTmp, "forge-gate-logs"))).toBe(true);
    expect(readFileSync(reported, "utf-8")).toBe("the whole story\n");
  });

  it("overwrites one log per repository and step, however often the step fails", async () => {
    const [first, second] = [fixtureRoot(), fixtureRoot()];
    const broken: Step = { label: "test:broken", tail: 5, cmd: ["sh", "-c", "exit 3"] };
    await run([broken], {}, { cwd: first });
    await run([broken], {}, { cwd: first });
    await run([broken], {}, { cwd: second });

    const logs = readdirSync(join(systemTmp, "forge-gate-logs"), { recursive: true }).filter((entry) => entry.endsWith(".log"));
    expect(logs).toHaveLength(2);
    expect(new Set(logs.map((entry) => entry.split("/")[0])).size).toBe(2);
  });

  it("writes no log for a step that passes, so a green run adds nothing to the system temp directory", async () => {
    const root = fixtureRoot();
    await run([recording("passes", join(root, "passes"))], {}, { cwd: root });

    expect(readdirSync(systemTmp).filter((entry) => join(systemTmp, entry) !== root)).toEqual([]);
  });
});

describe("createGateCommand() — --report", () => {
  // A red step also writes its log under the system TMPDIR, so each case gets one of its own.
  const saved = process.env.TMPDIR;
  let systemTmp = "";

  beforeEach(() => {
    systemTmp = mkdtempSync(join(tmpdir(), "forge-report-tmp-"));
    process.env.TMPDIR = systemTmp;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
    rmSync(systemTmp, { recursive: true, force: true });
  });

  const reportDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "forge-report-"));
    roots.push(dir);
    return dir;
  };
  const readReport = (dir: string): GateRunReport => JSON.parse(readFileSync(join(dir, "report.json"), "utf-8")) as GateRunReport;
  const shell = (label: string, script: string, extra: Partial<CommandStep> = {}): CommandStep => ({
    label,
    tail: 5,
    cmd: ["sh", "-c", script],
    ...extra,
  });

  const FAILURE: TestFailure = { engine: "chromium", spec: "a.browser.ts", title: "a › opens", error: "Expected 1" };
  const results = (args: readonly string[] = ["--results"]): StepResults => ({
    args,
    env: "RESULTS_FILE",
    read: (text) => (text === "none" ? undefined : text === "clean" ? [] : [FAILURE]),
  });
  const writing = (label: string, written: string | undefined, exit: number): CommandStep =>
    shell(label, `${written === undefined ? "" : `printf '%s' ${written} > "$RESULTS_FILE"; `}exit ${exit}`, { results: results([]) });

  it("records each step's status, its whole log and the run's verdict for a green run", async () => {
    const root = worktreeRoot();
    const dir = reportDir();
    const { code } = await run([shell("say", "echo hello"), passing("check")], { report: dir }, { cwd: root });

    const report = readReport(dir);
    expect(code).toBeUndefined();
    expect([report.tier, report.verdict, report.head]).toEqual(["runtime", "pass", worktreeHead(root)]);
    expect(report.steps.map((step) => [step.label, step.status, step.log])).toEqual([
      ["say", "passed", "say.log"],
      ["check", "passed", "check.log"],
    ]);
    expect(readFileSync(join(dir, "say.log"), "utf-8")).toBe("hello\n");
    expect(Number.isNaN(Date.parse(report.startedAt))).toBe(false);
  });

  it("writes the report on a red run, naming the failing step and every step after it as unreached", async () => {
    const dir = reportDir();
    const { code } = await run([shell("broken", "echo why; exit 2"), shell("later", "true"), failing("never")], { report: dir });

    const report = readReport(dir);
    expect(code).toBe(1);
    expect(report.verdict).toBe("fail");
    expect(report.steps.map((step) => [step.label, step.status])).toEqual([
      ["broken", "failed"],
      ["later", "unreached"],
      ["never", "unreached"],
    ]);
    expect(readFileSync(join(dir, "broken.log"), "utf-8")).toBe("why\n");
  });

  it("writes a failed check's findings into its log", async () => {
    const dir = reportDir();
    await run([failing("check")], { report: dir });

    expect(readFileSync(join(dir, "check.log"), "utf-8")).toContain("no good");
  });

  it("records the failing tests a step's results file names", async () => {
    const dir = reportDir();
    await run([writing("test:browser", "failed", 1)], { report: dir });

    expect(readReport(dir).steps).toMatchObject([{ label: "test:browser", status: "failed", failures: [FAILURE] }]);
  });

  it("records a red step whose results file holds no test result as setup, not as a test failure", async () => {
    const dir = reportDir();
    await run([writing("test:browser", "none", 1)], { report: dir });

    expect(readReport(dir).steps[0]?.status).toBe("setup");
    expect(readReport(dir).steps[0]?.failures).toBeUndefined();
  });

  it("records a red step that wrote no results file at all as setup", async () => {
    const dir = reportDir();
    await run([writing("test:browser", undefined, 1)], { report: dir });

    expect(readReport(dir).steps[0]?.status).toBe("setup");
  });

  it("records a red step whose results file names no failing test as failed with no failures", async () => {
    const dir = reportDir();
    await run([writing("test:browser", "clean", 1)], { report: dir });

    expect(readReport(dir).steps[0]).toMatchObject({ status: "failed" });
    expect(readReport(dir).steps[0]?.failures).toBeUndefined();
  });

  it("never counts the results file against leavesNoTemp", async () => {
    const dir = reportDir();
    const { code } = await run([{ ...writing("test:browser", "clean", 0), leavesNoTemp: true }], { report: dir });

    expect(code).toBeUndefined();
  });

  it("appends the results arguments only to a reported run", async () => {
    const root = fixtureRoot();
    const record = join(root, "argv");
    // The trailing `sh` is `$0`, so every appended argument lands in `$*`.
    const step: CommandStep = {
      label: "echo",
      tail: 5,
      cmd: ["sh", "-c", `printf '%s' "$*" > "${record}"`, "sh"],
      results: results(["--reporter=json"]),
    };

    await run([step], {}, { cwd: root });
    const bare = readFileSync(record, "utf-8");
    await run([step], { report: reportDir() }, { cwd: root });

    expect([bare, readFileSync(record, "utf-8")]).toEqual(["", "--reporter=json"]);
  });

  it("records a dependency that fails a runtime run as setup", async () => {
    const dir = reportDir();
    await run([passing("needs", ABSENT)], { report: dir });

    expect(readReport(dir).steps.map((step) => step.status)).toEqual(["setup"]);
  });

  it("records a dependency a unit run excuses as skipped", async () => {
    const dir = reportDir();
    await run([passing("needs", ABSENT), passing("other")], { report: dir, tier: "unit" });

    expect(readReport(dir).steps.map((step) => step.status)).toEqual(["skipped", "passed"]);
  });

  for (const flag of ["fix", "list", "reuse", "affected"] as const) {
    it(`refuses --${flag}, which runs no whole set of steps to record`, async () => {
      const dir = reportDir();
      const { logs, code } = await run([passing("a")], { report: dir, [flag]: true });

      expect(code).toBe(1);
      expect(logs).toContain(`--report records the steps a run executes, so it takes no --${flag}.`);
      expect(existsSync(join(dir, "report.json"))).toBe(false);
    });
  }
});
