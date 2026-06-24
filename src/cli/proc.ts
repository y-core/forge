/** proc.ts — process/tool/PATH primitives for forge CLI scripts.
 *
 *  Part of the node-only `@y-core/forge/cli` toolkit (like `execute`, which already
 *  imports `node:process`). All failures throw with a descriptive message so `execute`
 *  formats them on stderr and exits non-zero.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import type { ToolHints } from "./types";

/** Idempotently insert `dir` at the front of `process.env.PATH`.
 *  A no-op when `dir` is empty, does not exist on disk, or is already on `PATH`. */
export function insertPath(dir: string): void {
  if (!dir || !existsSync(dir)) return;
  if ((process.env.PATH ?? "").split(delimiter).includes(dir)) return;
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

/** True when `cmd --version` exits 0 — i.e. the tool is present and runnable. */
export function hasTool(cmd: string): boolean {
  return spawnSync(cmd, ["--version"], { stdio: "ignore", env: process.env }).status === 0;
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
