import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { v } from "../../../validation/mod";
import { runAcceptance, runTrap } from "./judge";
import { assertRoundName, writeTaskResult } from "./results";
import { matchFindings, parseFindings, REVIEW_SUFFIX } from "./review";
import {
  applyPatch,
  assertCleanCheckout,
  commitAll,
  createTree,
  diffBetween,
  prepareBase,
  readHead,
  removeTree,
  resetTree,
  step,
  verifyUnit,
  wardenArgv,
  writeMcpConfig,
} from "./scaffold";
import { unseedTrust } from "./session";
import { specHash } from "./spec";
import { emptySessionMetrics, findTranscripts, lastReplyText, readSessionMetrics, transcriptPaths } from "./transcript";
import type {
  CalibrationRecord,
  CheckoutHead,
  EvalEnv,
  EvalTask,
  RunChange,
  ReviewFinding,
  RunRecord,
  SessionMetrics,
  SessionOutcome,
  SessionRequest,
  TrapFiring,
  TrapVerdict,
  TreeKind,
} from "./types";

/** The tools a headless session may use without asking; the one list both the author and the reviewer run under. */
export const ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "LSP",
  "Edit",
  "Write",
  "Bash",
  "Agent",
  "mcp__warden__knowledge_search",
  "mcp__warden__knowledge_read",
  "mcp__warden__knowledge_outline",
  "mcp__warden__knowledge_related",
  "mcp__warden__knowledge_impact",
  "mcp__warden__warden_check",
  "mcp__warden__warden_query",
  // Code Mode's tool; inert where the session runs without it, as a headless `-p` session does.
  "REPL",
];

/** What every headless session's environment adds: the Code Mode opt-in, which a version or surface without it ignores. */
export const SESSION_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" };

/** The `claude --version` the round's sessions ran under, recorded in the round file. */
export function claudeVersion(env: EvalEnv): string {
  return step("claude", ["--version"], env.checkout, env.spawn).trim();
}

/** The setting sources every headless session loads, recorded in the round file. */
export const SETTING_SOURCES: readonly string[] = [
  // Not `local`: Claude Code reads it from a linked worktree's main checkout, carrying one developer's overrides into every forge tree.
  "user",
  "project",
];

/** The argv of one headless Claude Code session, under the round's warden-only MCP config. */
export function claudeArgv(prompt: string, options: { sessionId: string; model: string; mcpConfig: string }): string[] {
  return [
    "-p",
    prompt,
    "--session-id",
    options.sessionId,
    "--model",
    options.model,
    "--setting-sources",
    SETTING_SOURCES.join(","),
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
    "--strict-mcp-config",
    "--mcp-config",
    options.mcpConfig,
    "--output-format",
    "json",
  ];
}

/** The permission mode an interactive session runs under, the same for both Code Mode arms: what is not allowed is refused, never asked. */
export const INTERACTIVE_PERMISSION_MODE = "dontAsk";

/** The argv after `claude` of one interactive session: the prompt first, since `--allowedTools` and `--mcp-config` take every value after them. */
export function interactiveArgv(prompt: string, options: { sessionId: string; model: string; mcpConfig: string }): string[] {
  return [
    prompt,
    "--session-id",
    options.sessionId,
    "--model",
    options.model,
    "--setting-sources",
    SETTING_SOURCES.join(","),
    "--permission-mode",
    INTERACTIVE_PERMISSION_MODE,
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
    "--strict-mcp-config",
    "--mcp-config",
    options.mcpConfig,
  ];
}

/** The script that drives one interactive session in a PTY, run as its own `bun` process so the round stays synchronous. */
export const SESSION_BIN = fileURLToPath(new URL("session-bin.ts", import.meta.url));

const DRIVER_GRACE_MS = 60_000;

const SessionResultSchema = v.object({
  settled: v.boolean(),
  exitCode: v.nullable(v.number()),
  timedOut: v.boolean(),
  stalled: v.nullable(v.string()),
});

interface SessionOptions {
  model: string;
  mcpConfig: string;
  timeoutMinutes: number;
  /** Where an interactive session's screen is saved if it stalls; beside the tree's diff when absent. */
  screenLog?: string;
}

function screenLogPath(env: EvalEnv, tree: string, suffix: string): string {
  return join(env.cacheDir, `${relative(env.treesDir, tree)}${suffix}.pty.log`);
}

function driverResult(sessionId: string, stdout: string): v.InferOutput<typeof SessionResultSchema> {
  try {
    return v.parse(SessionResultSchema, JSON.parse(stdout));
  } catch (error) {
    throw new Error(`the session driver for ${sessionId} printed no result: ${JSON.stringify(stdout.slice(0, 200))}`, { cause: error });
  }
}

function runInteractive(env: EvalEnv, tree: string, prompt: string, options: SessionOptions, codeMode: boolean): SessionOutcome {
  const sessionId = crypto.randomUUID();
  const timeoutMs = options.timeoutMinutes * 60_000;
  const request: SessionRequest = {
    argv: ["claude", ...interactiveArgv(prompt, { sessionId, model: options.model, mcpConfig: options.mcpConfig })],
    tree,
    sessionId,
    projectsDir: env.projectsDir,
    claudeJson: env.claudeJson,
    codeMode,
    timeoutMs,
    screenLog: options.screenLog ?? screenLogPath(env, tree, ""),
  };
  const outcome = env.spawn("bun", [SESSION_BIN], {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    env: process.env,
    cwd: tree,
    input: JSON.stringify(request),
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs + DRIVER_GRACE_MS,
    killSignal: "SIGKILL",
  });
  if (outcome.status !== 0) {
    const reason = outcome.error?.message ?? outcome.stderr ?? "";
    throw new Error(`the session driver for ${sessionId} in ${tree} exited ${outcome.status ?? "on a signal"}\n${reason}`);
  }
  const result = driverResult(sessionId, outcome.stdout ?? "");
  if (!result.settled && !result.timedOut && result.stalled === null && result.exitCode !== 0) {
    throw new Error(`claude session ${sessionId} in ${tree} exited ${result.exitCode ?? "on a signal"} before its turn settled`);
  }
  const paths = findTranscripts(sessionId, env.projectsDir);
  return { sessionId, timedOut: result.timedOut, stalled: result.stalled, result: paths === undefined ? "" : lastReplyText(paths) };
}

function replyText(stdout: string): string {
  try {
    const reply = JSON.parse(stdout) as { result?: unknown };
    return typeof reply.result === "string" ? reply.result : "";
  } catch {
    return "";
  }
}

/** Runs one fresh session in the tree, headless or interactive as the env says, throwing when it fails for any reason but the wall clock or a stall. */
export function runSession(env: EvalEnv, tree: string, prompt: string, options: SessionOptions): SessionOutcome {
  if (env.session?.kind === "interactive") return runInteractive(env, tree, prompt, options, env.session.codeMode);
  const sessionId = crypto.randomUUID();
  const outcome = env.spawn("claude", claudeArgv(prompt, { sessionId, ...options }), {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    env: { ...process.env, ...SESSION_ENV },
    cwd: tree,
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMinutes * 60_000,
    killSignal: "SIGKILL",
  });
  const timedOut = outcome.error !== undefined && "code" in outcome.error && outcome.error.code === "ETIMEDOUT";
  if (!timedOut && outcome.status !== 0) {
    const reason = outcome.error?.message ?? outcome.stderr ?? "";
    throw new Error(`claude session ${sessionId} in ${tree} exited ${outcome.status ?? "on a signal"}\n${reason}`);
  }
  return { sessionId, timedOut, stalled: null, result: replyText(outcome.stdout ?? "") };
}

function sessionMetrics(env: EvalEnv, outcome: SessionOutcome): SessionMetrics {
  const paths = findTranscripts(outcome.sessionId, env.projectsDir);
  if (paths === undefined && outcome.stalled !== null) return emptySessionMetrics();
  return readSessionMetrics(paths ?? transcriptPaths(outcome.sessionId, env.projectsDir));
}

function codeModeOff(env: EvalEnv): boolean {
  return env.session?.kind === "interactive" && !env.session.codeMode;
}

function sessionInvalid(env: EvalEnv, role: "author" | "review", outcome: SessionOutcome, metrics: SessionMetrics): string | null {
  if (outcome.stalled !== null) return `${role} session ${outcome.sessionId} stalled: ${outcome.stalled}`;
  if (codeModeOff(env) && (metrics.toolsByName.REPL ?? 0) > 0) return `${role} session ${outcome.sessionId} used REPL with Code Mode off`;
  return null;
}

function treePath(env: EvalEnv, round: string, name: string): string {
  return join(env.treesDir, round, name);
}

function saveDiff(env: EvalEnv, round: string, name: string, diff: string): void {
  const dir = join(env.cacheDir, round);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.diff`), diff, "utf-8");
}

function inTree<T>(env: EvalEnv, kind: TreeKind, head: CheckoutHead, at: string, body: () => T): T {
  try {
    createTree(env, kind, head, at);
    return body();
  } finally {
    try {
      if (env.session?.kind === "interactive") unseedTrust(env.claudeJson, at);
    } finally {
      removeTree(env, kind, at);
    }
  }
}

interface Review {
  outcome: SessionOutcome;
  metrics: SessionMetrics;
  invalid: string | null;
}

function review(env: EvalEnv, task: EvalTask, tree: string, sha: string, mcpConfig: string): Review {
  const outcome = runSession(env, tree, `/warden-review ${sha}^!\n${REVIEW_SUFFIX}`, {
    model: task.model,
    mcpConfig,
    timeoutMinutes: task.timeoutMinutes,
    screenLog: screenLogPath(env, tree, "-review"),
  });
  const metrics = sessionMetrics(env, outcome);
  const silent = metrics.assistantMessages === 0 ? `review session ${outcome.sessionId} produced no assistant turn` : null;
  const invalid = sessionInvalid(env, "review", outcome, metrics) ?? silent;
  if (invalid !== null) env.log(`${task.id}: ${invalid}, so the record is invalid`);
  return { outcome, metrics, invalid };
}

function fireAll(task: EvalTask, tree: string, change: RunChange, env: EvalEnv): Record<string, TrapFiring> {
  return Object.fromEntries(task.traps.map((trap) => [trap.id, runTrap(task, trap, tree, change, env.spawn)]));
}

function judgeTraps(
  task: EvalTask,
  reviewed: Review,
  findings: readonly ReviewFinding[],
  firing: Record<string, TrapFiring>,
): Record<string, TrapVerdict> {
  const verdicts = matchFindings(findings, task.traps, firing);
  if (reviewed.invalid === null) return verdicts;
  return Object.fromEntries(Object.entries(verdicts).map(([id, verdict]) => [id, verdict === "clean" ? "clean" : "unreviewed"]));
}

/** One author session on the task in a fresh tree, then a fresh review of its commit, verify:unit, the traps and acceptance. */
export function runOnce(env: EvalEnv, task: EvalTask, round: string, rep: number, head: CheckoutHead): RunRecord {
  const name = `${task.id}-${rep}`;
  const mcpConfig = writeMcpConfig(env, round, task.tree);
  return inTree(env, task.tree, head, treePath(env, round, name), () => {
    const tree = treePath(env, round, name);
    const base = prepareBase(env, task, tree);
    const prompt = readFileSync(join(task.dir, "prompt.md"), "utf-8");
    const author = runSession(env, tree, prompt, { model: task.model, mcpConfig, timeoutMinutes: task.timeoutMinutes });
    const authorMetrics = sessionMetrics(env, author);
    const authorInvalid = sessionInvalid(env, "author", author, authorMetrics);
    if (authorInvalid !== null) env.log(`${task.id}: ${authorInvalid}, so the record is invalid`);
    step("git", ["reset", "-q", "--soft", base], tree, env.spawn);
    const authorSha = commitAll(tree, `eval author: ${task.id}`, env.spawn);
    const diff = diffBetween(tree, base, authorSha, env.spawn);
    saveDiff(env, round, name, diff);
    const reviewed = review(env, task, tree, authorSha, mcpConfig);
    const parsed = parseFindings(reviewed.outcome.result);
    const unit = verifyUnit(tree, env.spawn);
    const firing = fireAll(task, tree, { base, diff }, env);
    const accepted = runAcceptance(task, tree, env.spawn);
    return {
      rep,
      timedOut: author.timedOut || reviewed.outcome.timedOut,
      author: authorMetrics,
      review: reviewed.metrics,
      invalid: authorInvalid ?? reviewed.invalid,
      reviewParseFailed: parsed.reviewParseFailed,
      findings: parsed.findings.length,
      verifyUnit: unit,
      accepted,
      traps: judgeTraps(task, reviewed, parsed.findings, firing),
    };
  });
}

function applyAll(tree: string, task: EvalTask, patches: readonly string[], env: EvalEnv): void {
  for (const patch of patches) {
    if (!applyPatch(tree, join(task.dir, patch), env.spawn)) throw new Error(`${task.id}: ${patch} does not apply`);
  }
}

function plantPatches(task: EvalTask): string[] {
  return task.traps.map((trap) => join("plants", `${trap.id}.patch`));
}

/** Reviews the reference solution with every plant applied, so a reviewer's recall is measured on traps known to be present. */
export function runCalibration(env: EvalEnv, task: EvalTask, round: string, rep: number, head: CheckoutHead): CalibrationRecord {
  const name = `${task.id}-${rep}-calibration`;
  const mcpConfig = writeMcpConfig(env, round, task.tree);
  return inTree(env, task.tree, head, treePath(env, round, name), () => {
    const tree = treePath(env, round, name);
    const base = prepareBase(env, task, tree);
    applyAll(tree, task, ["reference.patch", ...plantPatches(task)], env);
    const planted = commitAll(tree, `eval calibration: ${task.id}`, env.spawn);
    const diff = diffBetween(tree, base, planted, env.spawn);
    saveDiff(env, round, name, diff);
    const reviewed = review(env, task, tree, planted, mcpConfig);
    const parsed = parseFindings(reviewed.outcome.result);
    return {
      rep,
      timedOut: reviewed.outcome.timedOut,
      review: reviewed.metrics,
      invalid: reviewed.invalid,
      reviewParseFailed: parsed.reviewParseFailed,
      traps: judgeTraps(task, reviewed, parsed.findings, fireAll(task, tree, { base, diff }, env)),
    };
  });
}

function checkPlants(env: EvalEnv, task: EvalTask, tree: string, base: string, reference: string): string[] {
  const problems: string[] = [];
  for (const trap of task.traps) {
    resetTree(tree, reference, env.spawn);
    if (!applyPatch(tree, join(task.dir, "plants", `${trap.id}.patch`), env.spawn)) {
      problems.push(`plant ${trap.id} does not apply over the reference`);
      continue;
    }
    const planted = commitAll(tree, `eval check plant: ${trap.id}`, env.spawn);
    if (!runTrap(task, trap, tree, { base, diff: diffBetween(tree, base, planted, env.spawn) }, env.spawn).fires) {
      problems.push(`plant ${trap.id} does not fire its own trap`);
    }
  }
  resetTree(tree, reference, env.spawn);
  if (!plantPatches(task).every((patch) => applyPatch(tree, join(task.dir, patch), env.spawn))) {
    problems.push("the plants do not all apply together");
  }
  return problems;
}

function unresolvedRules(env: EvalEnv, task: EvalTask, tree: string): string[] {
  const rules = [...new Set(task.traps.flatMap((trap) => trap.rules))].sort();
  return rules.flatMap((id) => {
    try {
      step("bun", wardenArgv(task.tree, "read", id), tree, env.spawn);
      return [];
    } catch {
      return [`rule ${id} does not resolve`];
    }
  });
}

/** Runs every task `reps` times, each with its calibration review, writing each task's results into the round file as it finishes. */
export function runRound(env: EvalEnv, round: string, tasks: readonly EvalTask[], reps: number): string[] {
  assertRoundName(round);
  const head = readHead(env.checkout, env.spawn);
  assertCleanCheckout(head);
  const version = claudeVersion(env);
  const written: string[] = [];
  for (const task of tasks) {
    const runs: RunRecord[] = [];
    const calibration: CalibrationRecord[] = [];
    for (let rep = 1; rep <= reps; rep += 1) {
      env.log(`${task.id}: run ${rep} of ${reps}`);
      runs.push(runOnce(env, task, round, rep, head));
      env.log(`${task.id}: calibration ${rep} of ${reps}`);
      calibration.push(runCalibration(env, task, round, rep, head));
    }
    const recordedUnder = {
      forgeSha: head.sha,
      settingSources: SETTING_SOURCES,
      claudeVersion: version,
      mode: env.session?.kind ?? "print",
      codeMode: env.session?.kind === "interactive" && env.session.codeMode,
    };
    written.push(writeTaskResult(env, round, recordedUnder, task.id, { specHash: specHash(task.dir), model: task.model, runs, calibration }));
  }
  return [...new Set(written)];
}

/** Proves a task spec without spending a session, returning every problem found; none means the task is ready to run. */
export function checkTask(env: EvalEnv, task: EvalTask, head: CheckoutHead): string[] {
  const at = join(env.treesDir, "check", task.id);
  return inTree(env, task.tree, head, at, () => {
    const base = prepareBase(env, task, at);
    const problems: string[] = [];
    if (!verifyUnit(at, env.spawn)) problems.push("the base tree fails verify:unit");
    if (!applyPatch(at, join(task.dir, "reference.patch"), env.spawn)) return [...problems, "reference.patch does not apply"];
    const reference = commitAll(at, `eval check reference: ${task.id}`, env.spawn);
    const diff = diffBetween(at, base, reference, env.spawn);
    if (!runAcceptance(task, at, env.spawn)) problems.push("acceptance fails on the reference");
    for (const trap of task.traps) {
      if (runTrap(task, trap, at, { base, diff }, env.spawn).fires) problems.push(`trap ${trap.id} fires on the reference`);
    }
    return [...problems, ...checkPlants(env, task, at, base, reference), ...unresolvedRules(env, task, at)];
  });
}
