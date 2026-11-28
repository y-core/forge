import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { addCommand, createCommand } from "../../cli/command";
import { CliError } from "../../cli/errors";
import type { CliContext, Command, SpawnSync } from "../../cli/types";
import { compareRounds } from "./compare";
import { readRound, roundPath } from "./results";
import { checkTask, claudeVersion, runRound } from "./run";
import { readHead } from "./scaffold";
import { loadTask } from "./spec";
import type { EvalEnv, EvalSession, EvalTask } from "./types";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const systemSpawn: SpawnSync = (command, args, options) => spawnSync(command, args, { ...options, encoding: "utf-8" });

/** The environment the `eval` commands run in when nothing is injected: this checkout, its `tests/evals`, and the user's own directories. */
export function defaultEvalEnv(log: (line: string) => void = console.log): EvalEnv {
  return {
    checkout: CHECKOUT,
    evalsDir: join(CHECKOUT, "tests", "evals"),
    treesDir: join(tmpdir(), "forge-eval"),
    cacheDir: join(homedir(), ".cache", "forge-eval"),
    projectsDir: join(homedir(), ".claude", "projects"),
    claudeJson: join(homedir(), ".claude.json"),
    spawn: systemSpawn,
    log,
  };
}

/** The ids of every task under the evals directory: each subdirectory holding a `task.json`. */
export function listTaskIds(evalsDir: string): string[] {
  if (!existsSync(evalsDir)) return [];
  return readdirSync(evalsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(evalsDir, entry.name, "task.json")))
    .map((entry) => entry.name)
    .sort();
}

function selectTasks(env: EvalEnv, ids: readonly string[]): EvalTask[] {
  const known = listTaskIds(env.evalsDir);
  const chosen = ids.length === 0 ? known : [...ids];
  const unknown = chosen.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new CliError("invalid-args", `no eval task ${unknown.join(", ")} under ${env.evalsDir}`);
  if (chosen.length === 0) throw new CliError("invalid-args", `no eval tasks under ${env.evalsDir}`);
  return chosen.map((id) => loadTask(join(env.evalsDir, id)));
}

function parseReps(value: string): number {
  const reps = Number(value);
  if (!Number.isInteger(reps) || reps < 1) throw new CliError("invalid-args", `--reps must be a whole number of at least 1, got ${value}`);
  return reps;
}

function parseSession(interactive: boolean, codeMode: string | undefined): EvalSession {
  if (!interactive) {
    if (codeMode !== undefined) throw new CliError("invalid-args", "--code-mode needs --interactive, since a headless session has no Code Mode");
    return { kind: "print" };
  }
  if (codeMode !== undefined && codeMode !== "on" && codeMode !== "off") {
    throw new CliError("invalid-args", `--code-mode must be on or off, got ${codeMode}`);
  }
  return { kind: "interactive", codeMode: codeMode === "on" };
}

function assertSameClaude(env: EvalEnv, written: readonly string[]): void {
  const now = claudeVersion(env);
  for (const path of written) {
    const recorded = readRound(path).claudeVersion;
    if (recorded !== now)
      throw new Error(`claude changed from ${recorded ?? "an unrecorded version"} to ${now} during the round, so ${path} mixes two versions`);
  }
}

function quit(ctx: CliContext | undefined, code: number): void {
  if (code !== 0) (ctx?.io.exit ?? process.exit)(code);
}

/** Assembles `eval run`, `eval check` and `eval compare`, which measure an agent's work on fixed tasks and hold a re-run to the last round. */
export function createEvalCommand(env: EvalEnv = defaultEvalEnv()): Command {
  const root = createCommand({ name: "eval", description: "Run agent evals against fixed tasks, prove their specs, and compare rounds" });

  addCommand(
    root,
    createCommand({
      name: "run",
      description: "Run each task in a fresh session and throwaway tree, and write tests/evals/results/<round>.json",
      flags: {
        round: { type: "string", required: true, description: "Name of the round file to write" },
        task: { type: "string", multiple: true, description: "Run only this task; repeat for more. Defaults to every task" },
        reps: { type: "string", default: "1", description: "Author runs per task, each with its own calibration review" },
        interactive: { type: "boolean", description: "Run each session interactively in a PTY rather than headless with -p" },
        "code-mode": { type: "string", description: "With --interactive: on or off; defaults to off" },
      },
      args: { kind: "none" },
      run(_args, flags) {
        const session = parseSession(flags.interactive, flags["code-mode"]);
        const tasks = selectTasks(env, flags.task);
        const written = runRound({ ...env, session }, flags.round, tasks, parseReps(flags.reps));
        for (const path of written) env.log(`wrote ${path}`);
        assertSameClaude(env, written);
      },
    }),
  );

  addCommand(
    root,
    createCommand({
      name: "check",
      description: "Prove each task's spec — base, reference, traps, plants and rules — without spending a session",
      flags: { task: { type: "string", multiple: true, description: "Check only this task; repeat for more. Defaults to every task" } },
      args: { kind: "none" },
      run(_args, flags, ctx) {
        const head = readHead(env.checkout, env.spawn);
        let failed = false;
        for (const task of selectTasks(env, flags.task)) {
          const problems = checkTask(env, task, head);
          env.log(problems.length === 0 ? `${task.id}: ok` : `${task.id}:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
          failed ||= problems.length > 0;
        }
        quit(ctx, failed ? 1 : 0);
      },
    }),
  );

  addCommand(
    root,
    createCommand({
      name: "compare",
      description: "Compare two rounds task by task, exiting 1 on any regression",
      flags: {
        "allow-respec": { type: "boolean", description: "Compare a task whose spec changed between the rounds, rather than failing it" },
        "allow-mixed-mode": { type: "boolean", description: "Compare a headless round with an interactive one, rather than refusing" },
      },
      args: { kind: "exact", count: 2 },
      run(args, flags, ctx) {
        const [before = "", after = ""] = args;
        const comparison = compareRounds(readRound(roundPath(env, before)), readRound(roundPath(env, after)), {
          allowRespec: flags["allow-respec"],
          allowMixedMode: flags["allow-mixed-mode"],
        });
        for (const line of comparison.lines) env.log(line);
        quit(ctx, comparison.regressed ? 1 : 0);
      },
    }),
  );

  return root;
}
