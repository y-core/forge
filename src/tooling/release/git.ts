import { captureStreams } from "../cli/proc";
import type { SpawnSync, StreamCapture } from "../cli/types";
import { parseSemVer } from "../gate/semver";
import { ReleaseError } from "./types";

function failureDetail(r: StreamCapture): string {
  return r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`;
}

/** Runs a git command in `cwd` and returns its trimmed stdout, throwing a {@link ReleaseError} on failure. */
export function gitExec(args: string[], cwd: string, spawn?: SpawnSync): string {
  const r = captureStreams("git", args, { cwd }, spawn);
  if (r.code !== 0) throw new ReleaseError("git-error", `git ${args[0]} failed: ${failureDetail(r)}`);
  return r.stdout.trim();
}

/** True when the working tree has no uncommitted changes. */
export function isWorkingTreeClean(cwd: string, spawn?: SpawnSync): boolean {
  const output = gitExec(["status", "--porcelain"], cwd, spawn);
  return output === "";
}

/** The branch HEAD is on, or `null` in a detached HEAD. */
export function currentBranch(cwd: string, spawn?: SpawnSync): string | null {
  const name = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd, spawn);
  return name === "HEAD" ? null : name;
}

/** The branch the remote publishes from, or `null` when the remote names none. */
export function defaultBranch(cwd: string, remote = "origin", spawn?: SpawnSync): string | null {
  // `git clone` writes this ref; `git init` + `git remote add` + `git push -u` does not, and no
  // fetch adds it — so its absence is an unanswered question rather than an answer of `main`.
  try {
    const ref = gitExec(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], cwd, spawn);
    if (ref === "") return null;
    return ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref;
  } catch {
    return null;
  }
}

/** Returns the most recent release tag matching `prefix`, or `null` when there are none. */
export function getLatestTag(cwd: string, prefix: string, spawn?: SpawnSync): string | null {
  const output = gitExec(["tag", "--list", `${prefix}*`, "--sort=-v:refname"], cwd, spawn);
  if (!output) return null;
  // Without `-c versionsort.suffix=-`, git sorts `v1.0.0-rc.1` above `v1.0.0`; a prerelease is not
  // a release to compute the next version from, so the first tag the release scheme accepts wins.
  for (const tag of output.split("\n").filter(Boolean)) {
    if (parseSemVer(tag.startsWith(prefix) ? tag.slice(prefix.length) : tag) !== null) return tag;
  }
  return null;
}

/** True when `tag` is an ancestor of HEAD — false when published history below it was rewritten. */
export function tagIsAncestorOfHead(cwd: string, tag: string, spawn?: SpawnSync): boolean {
  const r = captureStreams("git", ["merge-base", "--is-ancestor", tag, "HEAD"], { cwd }, spawn);
  if (r.code === 0) return true;
  // Exit 1 is the answer "no"; anything else is git failing to answer, which must not read as a rewrite.
  if (r.exited && r.code === 1) return false;
  throw new ReleaseError("git-error", `git merge-base failed: ${failureDetail(r)}`);
}

/** Tag names `remote` carries, or `null` when the remote could not be reached. */
export function remoteTags(cwd: string, remote = "origin", spawn?: SpawnSync): string[] | null {
  let output: string;
  try {
    output = gitExec(["ls-remote", "--tags", remote], cwd, spawn);
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
export function getCommitsSinceTag(cwd: string, tag: string, spawn?: SpawnSync): string[] {
  const output = gitExec(["log", `${tag}..HEAD`, "--oneline"], cwd, spawn);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

function assertRefResolvable(cwd: string, ref: string, cause: unknown, spawn?: SpawnSync): void {
  try {
    gitExec(["rev-parse", "--verify", `${ref}^{object}`], cwd, spawn);
  } catch {
    throw new ReleaseError("git-error", `git could not resolve ${ref}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** The file's contents at `ref`, or `null` when the path did not exist there; throws when git cannot resolve `ref`. */
export function readFileAtRef(cwd: string, ref: string, path: string, spawn?: SpawnSync): string | null {
  try {
    return gitExec(["show", `${ref}:${path}`], cwd, spawn);
  } catch (err) {
    // A path absent at a resolvable ref is data; a ref git cannot answer for must not read as "nothing was published".
    assertRefResolvable(cwd, ref, err, spawn);
    return null;
  }
}

/** Returns the subject line of the most recent commit. */
export function getLastCommitMessage(cwd: string, spawn?: SpawnSync): string {
  return gitExec(["log", "-1", "--format=%s"], cwd, spawn);
}

function hasStagedChanges(cwd: string, spawn?: SpawnSync): boolean {
  return gitExec(["diff", "--cached", "--name-only"], cwd, spawn) !== "";
}

/** Stages `files` and commits. Returns `false`, without error, when nothing was staged. */
export function commit(cwd: string, message: string, files: string[], spawn?: SpawnSync): boolean {
  gitExec(["add", ...files], cwd, spawn);
  if (!hasStagedChanges(cwd, spawn)) return false;
  gitExec(["commit", "-m", message], cwd, spawn);
  return true;
}

/** True when `tag` already exists in the repository. */
export function tagExists(cwd: string, tag: string, spawn?: SpawnSync): boolean {
  return gitExec(["tag", "--list", tag], cwd, spawn) !== "";
}

/** Creates a git tag named `tag`. */
export function createTag(cwd: string, tag: string, spawn?: SpawnSync): void {
  gitExec(["tag", tag], cwd, spawn);
}
