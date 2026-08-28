import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { CaptureResult, ToolHints } from "./types";

/** Idempotently inserts `dir` at the front of `process.env.PATH`. */
export function insertPath(dir: string): void {
  if (!dir || !existsSync(dir)) return;
  if ((process.env.PATH ?? "").split(delimiter).includes(dir)) return;
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
}

/** True when `cmd args` exits 0, with its output discarded. */
export function probeOk(cmd: string, args: readonly string[]): boolean {
  return spawnSync(cmd, [...args], { stdio: "ignore", env: process.env }).status === 0;
}

/** True when `cmd --version` exits 0 — i.e. the tool is present and runnable. */
export function hasTool(cmd: string): boolean {
  return probeOk(cmd, ["--version"]);
}

/** Asserts every tool is present, throwing `<cmd> not found — <hint>` on the first missing one. */
export function requireTools(tools: ToolHints): void {
  for (const [cmd, hint] of Object.entries(tools)) {
    if (!hasTool(cmd)) throw new Error(`${cmd} not found — ${hint}`);
  }
}

/** Spawns `cmd args` with inherited stdio, returning 0 or throwing naming the command and exit code. */
export function run(cmd: string, args: string[], opts?: { cwd?: string }): number {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env, ...(opts?.cwd ? { cwd: opts.cwd } : {}) });
  if (r.status !== 0) {
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.status})`);
  }
  return r.status;
}

/** Spawns `cmd args`, buffering its combined output and returning the exit code without throwing. */
export function capture(cmd: string, args: string[], opts?: { cwd?: string }): CaptureResult {
  // One temp-file fd for both streams keeps them interleaved; `stdio: "pipe"` yields two independent buffers and loses the order.
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
