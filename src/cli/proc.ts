/** proc.ts — process/tool/PATH primitives for forge CLI scripts.
 *
 *  Part of the node-only `@y-core/forge/cli` toolkit (like `execute`, which already
 *  imports `node:process`). All failures throw with a descriptive message so `execute`
 *  formats them on stderr and exits non-zero.
 */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { CaptureResult, ToolHints } from "./types";

/** Idempotently insert `dir` at the front of `process.env.PATH`.
 *  A no-op when `dir` is empty, does not exist on disk, or is already on `PATH`. */
export function insertPath(dir: string): void {
  if (!dir || !existsSync(dir)) return;
  if ((process.env.PATH ?? "").split(delimiter).includes(dir)) return;
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

/** True when `cmd args` exits 0, with its output discarded — a prerequisite check whose
 *  only signal is the exit code. A prerequisite that is not the presence of an executable
 *  (a downloaded browser, a running service) needs a command of its own to answer for it. */
export function probeOk(cmd: string, args: readonly string[]): boolean {
  return spawnSync(cmd, [...args], { stdio: "ignore", env: process.env }).status === 0;
}

/** True when `cmd --version` exits 0 — i.e. the tool is present and runnable. */
export function hasTool(cmd: string): boolean {
  return probeOk(cmd, ["--version"]);
}

/** Assert every tool is present, in insertion order. Throws on the first missing one
 *  with `<cmd> not found — <hint>` so `execute` reports it on stderr and exits 1. */
export function requireTools(tools: ToolHints): void {
  for (const [cmd, hint] of Object.entries(tools)) {
    if (!hasTool(cmd)) throw new Error(`${cmd} not found — ${hint}`);
  }
}

/** Spawn `cmd args` with inherited stdio; pass `cwd` only when provided (otherwise
 *  `spawnSync`'s default, `process.cwd()`). Returns the (zero) exit code on success;
 *  throws naming the command + code on failure. */
export function run(cmd: string, args: string[], opts?: { cwd?: string }): number {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
  if (r.status !== 0) {
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.status})`);
  }
  return r.status;
}

/** Spawn `cmd args`, buffering its combined output and returning the exit code — the
 *  non-throwing counterpart to `run`, for callers that report on failure rather than abort.
 *
 *  Both stdout and stderr are pointed at a single temp-file descriptor, reproducing
 *  `cmd > log 2>&1`: the two streams stay interleaved in the order the child wrote them.
 *  `stdio: "pipe"` cannot do this — it yields two independent buffers, so a tail of their
 *  concatenation would show only the stderr tail. A spawn failure (e.g. the tool is missing)
 *  has no output of its own, so its message is appended instead of returning an empty capture. */
export function capture(cmd: string, args: string[], opts?: { cwd?: string }): CaptureResult {
  const dir = mkdtempSync(join(tmpdir(), "forge-capture-"));
  const file = join(dir, "output");
  const fd = openSync(file, "w");
  const started = Date.now();
  try {
    const r = spawnSync(cmd, args, { stdio: ["ignore", fd, fd], env: process.env, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
    closeSync(fd);
    const reason = r.error ? `${r.error.message}\n` : "";
    return { code: r.status ?? 1, output: readFileSync(file, "utf-8") + reason, ms: Date.now() - started };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
