import { execFileSync } from "node:child_process";

import { parseSemVer } from "../gate/semver";
import type { ExecFile } from "./types";
import { ReleaseError } from "./types";

// `execFileSync` surfaces the actual git output on stderr/stdout; `message` is only the generic "Command failed: <cmd>" summary.
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

/** Runs a git command in `cwd` and returns its trimmed stdout, throwing a {@link ReleaseError} on failure. */
export function gitExec(args: string[], cwd: string, exec: ExecFile = execFileSync): string {
  try {
    const result = exec("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return (result as string).trim();
  } catch (err) {
    throw new ReleaseError("git-error", `git ${args[0]} failed: ${gitErrorDetail(err)}`);
  }
}

/** True when the working tree has no uncommitted changes. */
export function isWorkingTreeClean(cwd: string, exec: ExecFile = execFileSync): boolean {
  const output = gitExec(["status", "--porcelain"], cwd, exec);
  return output === "";
}

/** The branch HEAD is on, or `null` in a detached HEAD. */
export function currentBranch(cwd: string, exec: ExecFile = execFileSync): string | null {
  const name = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd, exec);
  return name === "HEAD" ? null : name;
}

/** The branch the remote publishes from, or `null` when the remote names none. */
export function defaultBranch(cwd: string, remote = "origin", exec: ExecFile = execFileSync): string | null {
  // `git clone` writes this ref; `git init` + `git remote add` + `git push -u` does not, and no
  // fetch adds it — so its absence is an unanswered question rather than an answer of `main`.
  try {
    const ref = gitExec(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd, exec);
    if (ref === "") return null;
    return ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref;
  } catch {
    return null;
  }
}

/** Returns the most recent release tag matching `prefix`, or `null` when there are none. */
export function getLatestTag(cwd: string, prefix: string, exec: ExecFile = execFileSync): string | null {
  const output = gitExec(["tag", "--list", `${prefix}*`, "--sort=-v:refname"], cwd, exec);
  if (!output) return null;
  // Without `-c versionsort.suffix=-`, git sorts `v1.0.0-rc.1` above `v1.0.0`; a prerelease is not
  // a release to compute the next version from, so the first tag the release scheme accepts wins.
  for (const tag of output.split("\n").filter(Boolean)) {
    if (parseSemVer(tag.startsWith(prefix) ? tag.slice(prefix.length) : tag) !== null) return tag;
  }
  return null;
}

/** True when `tag` is an ancestor of HEAD — false when published history below it was rewritten. */
export function tagIsAncestorOfHead(cwd: string, tag: string, exec: ExecFile = execFileSync): boolean {
  try {
    exec("git", ["merge-base", "--is-ancestor", tag, "HEAD"], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (err) {
    // Exit 1 is the answer "no"; anything else is git failing to answer, which must not read as a rewrite.
    if (err && typeof err === "object" && (err as { status?: unknown }).status === 1) return false;
    throw new ReleaseError("git-error", `git merge-base failed: ${gitErrorDetail(err)}`);
  }
}

/** Tag names `remote` carries, or `null` when the remote could not be reached. */
export function remoteTags(cwd: string, remote = "origin", exec: ExecFile = execFileSync): string[] | null {
  let output: string;
  try {
    output = gitExec(["ls-remote", "--tags", remote], cwd, exec);
  } catch {
    return null;
  }
  return (
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t")[1] ?? "")
      // An annotated tag also lists a `^{}` dereference line for the commit it points at.
      .map((ref) => ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""))
      .filter(Boolean)
  );
}

/** Returns each `--oneline` commit entry made since `tag`. */
export function getCommitsSinceTag(cwd: string, tag: string, exec: ExecFile = execFileSync): string[] {
  const output = gitExec(["log", `${tag}..HEAD`, "--oneline"], cwd, exec);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

function assertRefResolvable(cwd: string, ref: string, cause: unknown, exec: ExecFile): void {
  try {
    gitExec(["rev-parse", "--verify", `${ref}^{object}`], cwd, exec);
  } catch {
    throw new ReleaseError("git-error", `git could not resolve ${ref}: ${gitErrorDetail(cause)}`);
  }
}

/** The file's contents at `ref`, or `null` when the path did not exist there; throws when git cannot resolve `ref`. */
export function readFileAtRef(cwd: string, ref: string, path: string, exec: ExecFile = execFileSync): string | null {
  try {
    return gitExec(["show", `${ref}:${path}`], cwd, exec);
  } catch (err) {
    // A path absent at a resolvable ref is data; a ref git cannot answer for must not read as "nothing was published".
    assertRefResolvable(cwd, ref, err, exec);
    return null;
  }
}

/** Returns the subject line of the most recent commit. */
export function getLastCommitMessage(cwd: string, exec: ExecFile = execFileSync): string {
  return gitExec(["log", "-1", "--format=%s"], cwd, exec);
}

function hasStagedChanges(cwd: string, exec: ExecFile): boolean {
  return gitExec(["diff", "--cached", "--name-only"], cwd, exec) !== "";
}

/** Stages `files` and commits. Returns `false`, without error, when nothing was staged. */
export function commit(cwd: string, message: string, files: string[], exec: ExecFile = execFileSync): boolean {
  gitExec(["add", ...files], cwd, exec);
  if (!hasStagedChanges(cwd, exec)) return false;
  gitExec(["commit", "-m", message], cwd, exec);
  return true;
}

/** True when `tag` already exists in the repository. */
export function tagExists(cwd: string, tag: string, exec: ExecFile = execFileSync): boolean {
  return gitExec(["tag", "--list", tag], cwd, exec) !== "";
}

/** Creates a git tag named `tag`. */
export function createTag(cwd: string, tag: string, exec: ExecFile = execFileSync): void {
  gitExec(["tag", tag], cwd, exec);
}
