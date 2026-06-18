import { execFileSync } from "node:child_process";
import { ReleaseError } from "./types";

/**
 * Extract the most informative text from a failed `execFileSync` error.
 * `execFileSync` surfaces the actual git output on `stderr`/`stdout`; `message`
 * is only the generic `"Command failed: <cmd>"` shell summary.
 * @internal
 */
function gitErrorDetail(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    if (stderr) return stderr;
    const stdout = typeof e.stdout === "string" ? e.stdout.trim() : "";
    if (stdout) return stdout;
    if (typeof e.message === "string") return e.message;
  }
  return String(err);
}

export function gitExec(args: string[], cwd: string): string {
  try {
    const result = execFileSync("git", args, { cwd, encoding: "utf-8" });
    return (result as string).trim();
  } catch (err) {
    throw new ReleaseError("git-error", `git ${args[0]} failed: ${gitErrorDetail(err)}`);
  }
}

export function isWorkingTreeClean(cwd: string): boolean {
  const output = gitExec(["status", "--porcelain"], cwd);
  return output === "";
}

export function getLatestTag(cwd: string, prefix: string): string | null {
  const output = gitExec(["tag", "--list", `${prefix}*`, "--sort=-v:refname"], cwd);
  if (!output) return null;
  const lines = output.split("\n").filter(Boolean);
  return lines[0] ?? null;
}

export function getCommitsSinceTag(cwd: string, tag: string): string[] {
  const output = gitExec(["log", `${tag}..HEAD`, "--oneline"], cwd);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

export function getLastCommitMessage(cwd: string): string {
  return gitExec(["log", "-1", "--format=%s"], cwd);
}

/**
 * Returns `true` when the index contains staged changes, `false` otherwise.
 * @internal
 */
function hasStagedChanges(cwd: string): boolean {
  return gitExec(["diff", "--cached", "--name-only"], cwd) !== "";
}

/**
 * Stages `files` and commits. Returns `true` when a commit was made, `false`
 * when the index was empty after staging (nothing to commit — no error thrown).
 */
export function commit(cwd: string, message: string, files: string[]): boolean {
  gitExec(["add", ...files], cwd);
  if (!hasStagedChanges(cwd)) return false;
  gitExec(["commit", "-m", message], cwd);
  return true;
}

/**
 * Returns `true` when `tag` already exists in the repository.
 */
export function tagExists(cwd: string, tag: string): boolean {
  return gitExec(["tag", "--list", tag], cwd) !== "";
}

export function createTag(cwd: string, tag: string): void {
  gitExec(["tag", tag], cwd);
}
