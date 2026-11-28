import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { capture, captureStreams } from "../../cli/proc";
import type { SpawnSync } from "../../cli/types";
import { CHANGELOG, changelogHunks, editUnreleased } from "./changelog";
import type { CheckoutHead, EvalEnv, EvalTask, TreeKind } from "./types";

const PACKAGE = "@y-core/forge";

const COMMITTER = ["-c", "user.name=forge-eval", "-c", "user.email=forge-eval@localhost", "-c", "commit.gpgsign=false"];

/** Runs a command in `cwd`, returning its stdout and throwing with its stderr on a non-zero exit. */
export function step(command: string, args: string[], cwd: string, spawn?: SpawnSync): string {
  const result = captureStreams(command, args, { cwd, maxBuffer: 256 * 1024 * 1024 }, spawn);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.code} in ${cwd}\n${result.stderr}`);
  return result.stdout;
}

/** Reads HEAD and the checkout's changes against it. */
export function readHead(checkout: string, spawn: SpawnSync): CheckoutHead {
  const changes = step("git", ["status", "--porcelain"], checkout, spawn).trim();
  return { checkout, sha: headSha(checkout, spawn), changes };
}

/** Where rounds write their results; a result left uncommitted is not part of the tree a run measures, so the next round may start beside it. */
const RESULTS_PREFIX = "tests/evals/results/";

/** Refuses a checkout that had any change against HEAD when it was read, a round's result aside, since a run measures a commit and the tree it starts from is built from HEAD. */
export function assertCleanCheckout(head: CheckoutHead): void {
  const changes = head.changes
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.replace(/^\s*\S+\s+/, "").startsWith(RESULTS_PREFIX))
    .join("\n");
  if (changes !== "") throw new Error(`${head.checkout} has uncommitted changes — commit or set them aside before an eval run:\n${changes}`);
}

/** The commit HEAD names in `cwd`. */
export function headSha(cwd: string, spawn?: SpawnSync): string {
  return step("git", ["rev-parse", "HEAD"], cwd, spawn).trim();
}

/** Stages everything but `node_modules` — a symlink, an ignored directory or absent — and commits it, empty or not, returning the new commit. */
export function commitAll(tree: string, message: string, spawn: SpawnSync): string {
  step("git", ["add", "-A"], tree, spawn);
  // `node_modules/` in .gitignore matches a directory only, so a forge tree's symlinked node_modules is staged above and unstaged here.
  step("git", ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", "node_modules"], tree, spawn);
  step("git", [...COMMITTER, "commit", "-q", "--no-verify", "--allow-empty", "-m", message], tree, spawn);
  return headSha(tree, spawn);
}

function gitApply(tree: string, args: readonly string[], spawn: SpawnSync): boolean {
  return captureStreams("git", ["apply", "--whitespace=nowarn", ...args], { cwd: tree }, spawn).code === 0;
}

/** Applies a patch to the working copy, its changelog hunks by text inside `[Unreleased]`, leaving the tree unchanged when it does not apply. */
export function applyPatch(tree: string, patch: string, spawn: SpawnSync): boolean {
  const hunks = changelogHunks(readFileSync(patch, "utf-8"));
  if (hunks.length === 0) return gitApply(tree, [patch], spawn);
  const changelog = join(tree, CHANGELOG);
  const edited = existsSync(changelog) ? editUnreleased(readFileSync(changelog, "utf-8"), hunks) : undefined;
  if (edited === undefined || !gitApply(tree, [`--exclude=${CHANGELOG}`, patch], spawn)) return false;
  writeFileSync(changelog, edited, "utf-8");
  return true;
}

/** Puts the tree back at `sha`, removing what a later patch added but leaving the `node_modules` link alone. */
export function resetTree(tree: string, sha: string, spawn: SpawnSync): void {
  step("git", ["reset", "-q", "--hard", sha], tree, spawn);
  step("git", ["clean", "-fdq", "-e", "node_modules"], tree, spawn);
}

/** The diff between two commits of the tree. */
export function diffBetween(tree: string, from: string, to: string, spawn: SpawnSync): string {
  return step("git", ["diff", "--no-color", "--no-ext-diff", from, to], tree, spawn);
}

/** True when `bun run verify:unit` passes in the tree. */
export function verifyUnit(tree: string, spawn: SpawnSync): boolean {
  return capture("bun", ["run", "verify:unit"], { cwd: tree }, spawn).code === 0;
}

/** The argv after `bun` of one warden command in a tree of this kind; a consumer's adds the installed forge's consumer-facing documents, as its gate's warden rows do. */
export function wardenArgv(kind: TreeKind, command: string, ...rest: string[]): string[] {
  if (kind === "forge") return ["warden/src/bin.ts", command, ...rest];
  return [`node_modules/${PACKAGE}/warden/src/bin.ts`, command, "--dependency", ...rest];
}

/** Writes the MCP config every session in the round runs under — warden alone, so no session can reach the ledger. */
export function writeMcpConfig(env: EvalEnv, round: string, kind: TreeKind): string {
  const path = join(env.treesDir, round, `mcp-${kind}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const config = { mcpServers: { warden: { type: "stdio", command: "bun", args: wardenArgv(kind, "serve") } } };
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return path;
}

/** Builds the consumer template for a forge commit once: the fixture, the eval overlay, and this checkout packed and installed; a head read from a dirty checkout is refused, since its pack is not the commit. */
export function consumerTemplate(env: EvalEnv, head: CheckoutHead): string {
  const template = join(env.cacheDir, `consumer-${head.sha}`);
  if (existsSync(template)) return template;
  assertCleanCheckout(head);
  const staging = `${template}.partial`;
  const tarball = join(env.cacheDir, `forge-${head.sha}.tgz`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(env.cacheDir, { recursive: true });
  try {
    cpSync(join(env.checkout, "tests", "fixtures", "workers-consumer"), staging, { recursive: true });
    cpSync(join(env.evalsDir, "consumer-base"), staging, { recursive: true });
    step("bun", ["pm", "pack", "--ignore-scripts", "--quiet", "--filename", tarball], env.checkout, env.spawn);
    const manifestPath = join(staging, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { dependencies?: Record<string, string> };
    manifest.dependencies = { ...manifest.dependencies, [PACKAGE]: `file:${tarball}` };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    step("bun", ["install"], staging, env.spawn);
    step("git", ["init", "-q"], staging, env.spawn);
    commitAll(staging, "consumer template", env.spawn);
    renameSync(staging, template);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return template;
}

/** Creates a throwaway tree at `at`: a detached forge worktree of HEAD, or a copy of the consumer template. */
export function createTree(env: EvalEnv, kind: TreeKind, head: CheckoutHead, at: string): void {
  removeTree(env, kind, at);
  mkdirSync(dirname(at), { recursive: true });
  if (kind === "forge") {
    step("git", ["worktree", "add", "-q", "--detach", at, head.sha], env.checkout, env.spawn);
    symlinkSync(join(env.checkout, "node_modules"), join(at, "node_modules"), "dir");
    return;
  }
  cpSync(consumerTemplate(env, head), at, { recursive: true, verbatimSymlinks: true });
}

/** Removes a throwaway tree and, for a forge worktree, git's record of it; a tree that is already gone is not an error. */
export function removeTree(env: EvalEnv, kind: TreeKind, at: string): void {
  if (kind === "forge") {
    captureStreams("git", ["worktree", "remove", "--force", at], { cwd: env.checkout }, env.spawn);
    rmSync(at, { recursive: true, force: true });
    captureStreams("git", ["worktree", "prune"], { cwd: env.checkout }, env.spawn);
    return;
  }
  rmSync(at, { recursive: true, force: true });
}

/** Indexes the tree's corpus, applies the task's bait and commits it, returning the commit every session starts from. */
export function prepareBase(env: EvalEnv, task: EvalTask, tree: string): string {
  step("bun", wardenArgv(task.tree, "index", "--root", tree), tree, env.spawn);
  for (const bait of task.bait) {
    if (!applyPatch(tree, join(task.dir, bait), env.spawn)) throw new Error(`${task.id}: bait ${bait} does not apply`);
  }
  return commitAll(tree, `eval base: ${task.id}`, env.spawn);
}
