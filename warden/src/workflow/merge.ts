import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import { git, isClean, patchId, patchIds, runCheck, type WorkflowEnv } from "./git";

/** A task the reviewer closed, and the sha its resolution names as `reviewed <sha>`. @public */
export interface ReviewedTask {
  readonly id: string;
  readonly sha: string;
}

/** How each reviewed sha reached local `main`. @public */
export interface MergedTask {
  readonly id: string;
  readonly sha: string;
  /** Whether `main` had moved, so the branch was rebased and its patch id proved unchanged. */
  readonly rebased: boolean;
}

/** Fast-forwards local `main` to each reviewed sha, rebasing a task whose base moved only where its patch id holds. @public */
export function mergeReviewed(env: WorkflowEnv, tasks: readonly ReviewedTask[], main = "main"): Result<MergedTask[], string> {
  const { cwd } = env;
  if (tasks.length === 0) return err("name at least one reviewed task as <id>=<sha>");
  if (!isClean(cwd)) return err("the work tree has uncommitted changes — commit or stash them first");
  const merged: MergedTask[] = [];
  for (const { id, sha } of tasks) {
    const switched = git(cwd, "switch", "--quiet", main);
    if (!switched.ok) return err(switched.error);
    if (git(cwd, "merge", "--ff-only", "--quiet", sha).ok) {
      merged.push({ id, sha, rebased: false });
      continue;
    }

    const branch = `task/${id}`;
    const reviewed = patchId(cwd, sha);
    if (!reviewed.ok) return err(`${id}: ${reviewed.error}`);
    const rebased = git(cwd, "rebase", "--quiet", main, branch);
    if (!rebased.ok) {
      git(cwd, "rebase", "--abort");
      git(cwd, "switch", "--quiet", main);
      return err(
        `${id}: rebasing ${branch} onto ${main} stopped on a conflict — that resolution is code nobody reviewed, so resolve it on the branch, run the task check and hand ${id} off again`,
      );
    }
    const above = git(cwd, "rev-list", "--count", `${main}..${branch}`);
    const now = patchId(cwd, branch);
    git(cwd, "switch", "--quiet", main);
    if (!above.ok || above.data !== "1") return err(`${id}: ${branch} holds more than its one reviewed commit above ${main} — hand it off again`);
    if (!now.ok || now.data !== reviewed.data)
      return err(
        `${id}: rebased onto ${main}, ${branch}'s patch is no longer the reviewed ${sha.slice(0, 8)} — hand it off again with the new sha`,
      );
    const forwarded = git(cwd, "merge", "--ff-only", "--quiet", branch);
    if (!forwarded.ok) return err(`${id}: ${forwarded.error}`);
    merged.push({ id, sha, rebased: true });
  }
  return ok(merged);
}

/** What the push step does once the unit is complete. @public */
export interface PushOptions {
  /** The one squashed commit's message; required when more than one commit is unpushed. */
  readonly message?: string;
  /** The task ids whose branches the pushed commit carries, for the clean-up line. */
  readonly ids?: readonly string[];
  /** The push that closes an epic: the full gate is cc-tester's, so the script stops after the rebase until it is given the tip it checked. */
  readonly full?: boolean;
  /** The tip `cc-tester` ran `bun run verify` on, green. */
  readonly checked?: string;
  /** The user approved the new root files and directories the unit adds; without it the push stops and lists them. */
  readonly structureApproved?: boolean;
  readonly remote?: string;
  readonly main?: string;
}

/** Either the tip still needs its full gate, or the unit is squashed and checked, with the commands that push it. @public */
export type PushReport =
  | { readonly state: "needs-full-gate"; readonly tip: string; readonly next: string }
  | { readonly state: "ready"; readonly checked: string; readonly sha: string; readonly log: string; readonly push: readonly string[] };

function treeEntries(cwd: string, ref: string, ...args: string[]): Result<Set<string>, string> {
  const listed = git(cwd, "ls-tree", "--name-only", ...args, ref);
  return listed.ok ? ok(new Set(listed.data.split("\n").filter((line) => line !== ""))) : err(listed.error);
}

// A layout change outlives every task that made it, so no agent's judgement stands in for the user's.
/** What `main` adds over `upstream`: each new root-level file, and each new directory at any depth. @internal */
export function addedStructure(cwd: string, upstream: string, main: string): Result<string[], string> {
  const lists = [treeEntries(cwd, upstream), treeEntries(cwd, upstream, "-r", "-d"), treeEntries(cwd, main), treeEntries(cwd, main, "-r", "-d")];
  const failed = lists.find((listed) => !listed.ok);
  if (failed !== undefined && !failed.ok) return err(failed.error);
  const [rootBefore, dirsBefore, rootAfter, dirsAfter] = lists.map((listed) => (listed.ok ? listed.data : new Set<string>()));
  const had = (set: Set<string> | undefined, name: string): boolean => set?.has(name) === true;
  const rootFiles = [...(rootAfter ?? [])].filter((name) => !had(rootBefore, name) && !had(dirsAfter, name));
  const dirs = [...(dirsAfter ?? [])].filter((dir) => !had(dirsBefore, dir));
  return ok([
    ...(rootFiles.length === 0 ? [] : [`new root file(s): ${rootFiles.sort().join(", ")}`]),
    ...(dirs.length === 0 ? [] : [`new director(ies): ${dirs.sort().join(", ")}`]),
  ]);
}

/** Rebases local `main` onto the remote with each commit's patch id held, checks the tip, squashes the unit, proves the squash is what was checked, and prints the push. @public */
export function preparePush(env: WorkflowEnv, options: PushOptions = {}): Result<PushReport, string> {
  const { cwd } = env;
  const remote = options.remote ?? "origin";
  const main = options.main ?? "main";
  const upstream = `${remote}/${main}`;
  if (!isClean(cwd)) return err("the work tree has uncommitted changes — commit or stash them first");
  const switched = git(cwd, "switch", "--quiet", main);
  if (!switched.ok) return err(switched.error);
  const fetched = git(cwd, "fetch", "--quiet", remote);
  if (!fetched.ok) return err(fetched.error);

  if (!git(cwd, "merge-base", "--is-ancestor", upstream, main).ok) {
    const fork = git(cwd, "merge-base", upstream, main);
    if (!fork.ok) return err(fork.error);
    const before = patchIds(cwd, `${fork.data}..${main}`);
    if (!before.ok) return err(before.error);
    const unrebased = git(cwd, "rev-parse", main);
    if (!unrebased.ok) return err(unrebased.error);
    const rebased = git(cwd, "rebase", "--quiet", upstream);
    if (!rebased.ok) {
      git(cwd, "rebase", "--abort");
      return err(
        `rebasing ${main} onto ${upstream} stopped on a conflict — nothing is pushed; send the conflicting task back to review. ${rebased.error}`,
      );
    }
    const after = patchIds(cwd, `${upstream}..${main}`);
    if (!after.ok) return err(after.error);
    if (after.data.join() !== before.data.join()) {
      git(cwd, "reset", "--hard", "--quiet", unrebased.data);
      return err(
        `rebasing onto ${upstream} changed the unpushed commits' patches — nothing is pushed, and ${main} is back at ${unrebased.data.slice(0, 8)}; send the task whose patch moved back to review`,
      );
    }
  }

  if (options.structureApproved !== true) {
    const added = addedStructure(cwd, upstream, main);
    if (!added.ok) return err(added.error);
    if (added.data.length > 0)
      return err(
        `the unit adds structure the user has not approved — ${added.data.join("; ")}. Nothing is pushed: ask the user, and rerun with --structure-approved only once they say yes`,
      );
  }

  const tip = git(cwd, "rev-parse", "HEAD");
  if (!tip.ok) return err(tip.error);
  let checked: string;
  let log = "";
  if (options.full === true) {
    if (options.checked === undefined)
      return ok({
        state: "needs-full-gate",
        tip: tip.data,
        next: `send \`bun run verify\` on ${tip.data} to cc-tester, then rerun with --checked=${tip.data}`,
      });
    if (options.checked !== tip.data)
      return err(`--checked names ${options.checked}, but the rebased tip is ${tip.data} — the gate must run on this tip`);
    checked = tip.data;
  } else {
    const ran = runCheck(env, "push");
    if (!ran.ok) return err(`not pushed — ${ran.error}`);
    checked = tip.data;
    log = ran.data;
  }

  const unpushed = git(cwd, "rev-list", "--count", `${upstream}..${main}`);
  if (!unpushed.ok) return err(unpushed.error);
  if (unpushed.data === "0") return err(`${main} holds nothing ${upstream} does not, so there is nothing to push`);
  if (unpushed.data !== "1" || options.message !== undefined) {
    if (options.message === undefined) return err(`${unpushed.data} commits are unpushed — pass --message with the squashed commit's message`);
    const reset = git(cwd, "reset", "--soft", upstream);
    if (!reset.ok) return err(reset.error);
    const committed = git(cwd, "commit", "--quiet", "--no-verify", "-m", options.message);
    if (!committed.ok) {
      git(cwd, "reset", "--soft", checked);
      return err(`the squash commit failed, so ${main} is back at the checked tip ${checked.slice(0, 8)} — ${committed.error}`);
    }
  }
  if (!git(cwd, "diff", "--quiet", checked, "HEAD").ok) {
    git(cwd, "reset", "--hard", "--quiet", checked);
    return err(`the squash differs from the checked tip ${checked.slice(0, 8)}, so main was reset to it — squash again`);
  }

  const sha = git(cwd, "rev-parse", "HEAD");
  if (!sha.ok) return err(sha.error);
  const branches = (options.ids ?? []).map((id) => `git branch -D task/${id}`);
  return ok({ state: "ready", checked, sha: sha.data, log, push: [`git push ${remote} ${main}`, ...branches] });
}
