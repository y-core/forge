import { execFileSync } from "node:child_process";
import { ReleaseError } from "./types";

export function gitExec(args: string[], cwd: string): string {
  try {
    const result = execFileSync("git", args, { cwd, encoding: "utf-8" });
    return (result as string).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ReleaseError("git-error", `git ${args[0]} failed: ${msg}`);
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

export function createTag(cwd: string, tag: string): void {
  gitExec(["tag", tag], cwd);
}
