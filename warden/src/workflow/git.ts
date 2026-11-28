import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";

/** Where a workflow script runs, and the task check it runs on a commit. @public */
export interface WorkflowEnv {
  /** The repository's work tree. */
  readonly cwd: string;
  /** The task check, run on the commit a step produced. Defaults to `bun run verify:unit`. */
  readonly check?: readonly string[];
  /** Receives each progress line; defaults to stdout. */
  readonly log?: (line: string) => void;
  /** Where the check's stream is written; defaults to a fresh directory under the system temp. */
  readonly logDir?: string;
}

/** The task check every script runs unless told otherwise. @public */
export const TASK_CHECK: readonly string[] = ["bun", "run", "verify:unit"];

/** Runs git in `cwd`, answering its trimmed stdout or a message naming the command and what git said. @internal */
export function git(cwd: string, ...args: string[]): Result<string, string> {
  const run = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error !== undefined) return err(`git ${args.join(" ")} did not start: ${run.error.message}`);
  if (run.status !== 0) {
    const said = `${run.stderr ?? ""}${run.stdout ?? ""}`.trim();
    return err(`git ${args.join(" ")} failed (exit ${String(run.status)})${said === "" ? "" : `: ${said}`}`);
  }
  return ok((run.stdout ?? "").trim());
}

/** Feeds `input` to git on stdin, as `git patch-id` takes a diff. @internal */
export function gitWithInput(cwd: string, input: string, ...args: string[]): Result<string, string> {
  const run = spawnSync("git", args, { cwd, encoding: "utf-8", input, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) return err(`git ${args.join(" ")} failed (exit ${String(run.status)}): ${(run.stderr ?? "").trim()}`);
  return ok((run.stdout ?? "").trim());
}

/** The stable patch id of one commit's change, which outlives its sha across a rebase. @internal */
export function patchId(cwd: string, rev: string): Result<string, string> {
  const diff = git(cwd, "diff-tree", "-p", rev);
  if (!diff.ok) return diff;
  const id = gitWithInput(cwd, `${diff.data}\n`, "patch-id", "--stable");
  if (!id.ok) return id;
  const first = id.data.split(" ")[0] ?? "";
  return first === "" ? err(`${rev} carries no change, so it has no patch id`) : ok(first);
}

/** The patch ids of `range`'s commits, oldest first. @internal */
export function patchIds(cwd: string, range: string): Result<string[], string> {
  const shas = git(cwd, "rev-list", "--reverse", "--no-merges", range);
  if (!shas.ok) return shas;
  const ids: string[] = [];
  for (const sha of shas.data.split("\n").filter((line) => line !== "")) {
    const id = patchId(cwd, sha);
    if (!id.ok) return id;
    ids.push(id.data);
  }
  return ok(ids);
}

/** Whether the work tree and the index match `HEAD`, ignoring untracked files. @internal */
export function isClean(cwd: string): boolean {
  return git(cwd, "diff", "--quiet").ok && git(cwd, "diff", "--cached", "--quiet").ok;
}

/** Runs the task check with its stream to a file, answering the file and, on a red check, its tail. @internal */
export function runCheck(env: WorkflowEnv, label: string): Result<string, string> {
  const command = env.check ?? TASK_CHECK;
  const [bin, ...args] = command;
  if (bin === undefined) return err("the task check names no command");
  const run = spawnSync(bin, args, { cwd: env.cwd, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const dir = env.logDir ?? mkdtempSync(join(tmpdir(), "forge-workflow-"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${label.replace(/[^\w.-]/g, "_")}.log`);
  writeFileSync(file, output, "utf-8");
  if (run.error !== undefined) return err(`\`${command.join(" ")}\` did not start: ${run.error.message}`);
  if (run.status !== 0) {
    const tail = output.trimEnd().split("\n").slice(-15).join("\n");
    return err(`\`${command.join(" ")}\` is red (exit ${String(run.status)}) — full log at ${file}\n${tail}`);
  }
  return ok(file);
}
