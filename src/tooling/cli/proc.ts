import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import type { CaptureResult, RunOutcome, SpawnSync, StreamCapture, ToolHints } from "./types";

function spawnDeadline(timeoutMs: number | undefined): { timeout: number; killSignal: "SIGKILL" } | Record<string, never> {
  return timeoutMs === undefined ? {} : { timeout: timeoutMs, killSignal: "SIGKILL" };
}

/** Idempotently inserts `dir` at the front of `process.env.PATH`. */
export function insertPath(dir: string): void {
  if (!dir || !existsSync(dir)) return;
  if ((process.env.PATH ?? "").split(delimiter).includes(dir)) return;
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

/** True when `cmd args` exits 0, with its output discarded. */
export function probeOk(cmd: string, args: readonly string[], spawn: SpawnSync = spawnSync): boolean {
  return spawn(cmd, [...args], { stdio: "ignore", env: process.env }).status === 0;
}

/** True when `cmd --version` exits 0 — i.e. the tool is present and runnable. */
export function hasTool(cmd: string, spawn: SpawnSync = spawnSync): boolean {
  return probeOk(cmd, ["--version"], spawn);
}

/** Asserts every tool is present, throwing `<cmd> not found — <hint>` on the first missing one. */
export function requireTools(tools: ToolHints, spawn: SpawnSync = spawnSync): void {
  for (const [cmd, hint] of Object.entries(tools)) {
    if (!hasTool(cmd, spawn)) throw new Error(`${cmd} not found — ${hint}`);
  }
}

/** Spawns `cmd args` with inherited stdio, returning how it exited without throwing. */
export function runUnchecked(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: typeof process.env; timeoutMs?: number },
  spawn: SpawnSync = spawnSync,
): RunOutcome {
  const r = spawn(cmd, args, {
    stdio: "inherit",
    env: opts?.env ?? process.env,
    ...(opts?.cwd ? { cwd: opts.cwd } : {}),
    ...spawnDeadline(opts?.timeoutMs),
  });
  return { code: r.status ?? 1, exited: typeof r.status === "number" && !r.error, spawnError: r.error?.message };
}

/** Spawns `cmd args` with inherited stdio, returning 0 or throwing naming the command and exit code. */
export function run(cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }, spawn: SpawnSync = spawnSync): number {
  const outcome = runUnchecked(cmd, args, opts, spawn);
  if (outcome.code !== 0) {
    const reason = outcome.spawnError === undefined ? "" : `: ${outcome.spawnError}`;
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${outcome.code})${reason}`);
  }
  return outcome.code;
}

/** Spawns `cmd args`, buffering its combined output and returning the exit code without throwing. */
export function capture(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: typeof process.env; timeoutMs?: number },
  spawn: SpawnSync = spawnSync,
): CaptureResult {
  // One temp-file fd for both streams keeps them interleaved; `stdio: "pipe"` yields two independent buffers and loses the order.
  const dir = mkdtempSync(join(tmpdir(), "forge-capture-"));
  const file = join(dir, "output");
  const fd = openSync(file, "w");
  const started = Date.now();
  try {
    const r = spawn(cmd, args, {
      stdio: ["ignore", fd, fd],
      env: opts?.env ?? process.env,
      ...(opts?.cwd ? { cwd: opts.cwd } : {}),
      ...spawnDeadline(opts?.timeoutMs),
    });
    closeSync(fd);
    const reason = r.error ? `${r.error.message}\n` : "";
    return { code: r.status ?? 1, output: readFileSync(file, "utf-8") + reason, ms: Date.now() - started };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Spawns `cmd args` with stdout and stderr captured apart, returning the exit code without throwing. */
export function captureStreams(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: typeof process.env; timeoutMs?: number; maxBuffer?: number },
  spawn: SpawnSync = spawnSync,
): StreamCapture {
  const r = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    env: opts.env ?? process.env,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.maxBuffer === undefined ? {} : { maxBuffer: opts.maxBuffer }),
    ...spawnDeadline(opts.timeoutMs),
  });
  const reason = r.error ? `${r.error.message}\n` : "";
  return { code: r.status ?? 1, exited: typeof r.status === "number" && !r.error, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${reason}` };
}
