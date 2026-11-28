import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import { git, isClean, runCheck, TASK_CHECK, type WorkflowEnv } from "./git";

/** One task to hand off: its id names its branch, `task/<id>`. @public */
export interface HandoffTask {
  readonly id: string;
  /** What the branch rebases onto: local `main`, or a sibling's handed-off sha. Defaults to `main`. */
  readonly base?: string;
  /** The one commit's message; required when the branch holds more than one commit, and replaces the message of one that does not. */
  readonly message?: string;
}

/** A task brought to its one checked commit. @public */
export interface HandedOff {
  readonly id: string;
  readonly sha: string;
  /** What the task's resolution starts with when it moves to `review`. */
  readonly resolution: string;
  /** Where the task check's whole stream was written. */
  readonly log: string;
}

/** The checked commits, and the brief the `cc-reviewer` dispatch carries verbatim. @public */
export interface HandoffReport {
  readonly tasks: readonly HandedOff[];
  readonly brief: string;
}

function oneTask(env: WorkflowEnv, task: HandoffTask): Result<HandedOff, string> {
  const { cwd } = env;
  const say = env.log ?? ((line: string) => console.log(line));
  const branch = `task/${task.id}`;
  const base = task.base ?? "main";
  if (!git(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).ok) return err(`${task.id}: there is no branch ${branch} to hand off`);
  if (!git(cwd, "rev-parse", "--verify", "--quiet", base).ok) return err(`${task.id}: the base \`${base}\` names no commit`);

  const switched = git(cwd, "switch", "--quiet", branch);
  if (!switched.ok) return err(`${task.id}: ${switched.error}`);
  const rebased = git(cwd, "rebase", "--quiet", base);
  if (!rebased.ok) {
    git(cwd, "rebase", "--abort");
    return err(`${task.id}: rebasing ${branch} onto ${base} stopped — resolve it on the branch, then hand it off again. ${rebased.error}`);
  }

  const above = git(cwd, "rev-list", "--count", `${base}..HEAD`);
  if (!above.ok) return err(`${task.id}: ${above.error}`);
  const commits = Number(above.data);
  if (commits === 0) return err(`${task.id}: ${branch} holds no commit above ${base}, so there is nothing to review`);
  if (commits > 1 && task.message === undefined)
    return err(`${task.id}: ${branch} holds ${commits} commits above ${base} — pass --message with the one commit's message to squash them`);
  if (task.message !== undefined) {
    const unsquashed = git(cwd, "rev-parse", "HEAD");
    if (!unsquashed.ok) return err(`${task.id}: ${unsquashed.error}`);
    const reset = git(cwd, "reset", "--soft", base);
    if (!reset.ok) return err(`${task.id}: ${reset.error}`);
    const committed = git(cwd, "commit", "--quiet", "--no-verify", "-m", task.message);
    if (!committed.ok) {
      git(cwd, "reset", "--soft", unsquashed.data);
      return err(`${task.id}: the squash commit failed, so ${branch} is back at ${unsquashed.data.slice(0, 8)} — ${committed.error}`);
    }
  }

  say(`${task.id}: one commit on ${base}; running \`${(env.check ?? TASK_CHECK).join(" ")}\``);
  const checked = runCheck(env, task.id);
  if (!checked.ok) return err(`${task.id}: not handed off — ${checked.error}`);
  const sha = git(cwd, "rev-parse", "HEAD");
  if (!sha.ok) return err(`${task.id}: ${sha.error}`);
  const label = env.check === undefined ? "verify:unit" : env.check.join(" ");
  return ok({ id: task.id, sha: sha.data, resolution: `sha: ${sha.data}; check: ${label} green;`, log: checked.data });
}

/** Rebases each task's branch onto its base, squashes it to one commit, runs the task check on it, and returns the reviewer's brief. @public */
export function handoff(env: WorkflowEnv, tasks: readonly HandoffTask[]): Result<HandoffReport, string> {
  if (tasks.length === 0) return err("name at least one task id to hand off");
  if (!isClean(env.cwd)) return err("the work tree has uncommitted changes — commit them to their task's branch first");
  const start = git(env.cwd, "rev-parse", "--abbrev-ref", "HEAD");
  const done: HandedOff[] = [];
  try {
    for (const task of tasks) {
      const result = oneTask(env, task);
      if (!result.ok) return result;
      done.push(result.data);
    }
  } finally {
    if (start.ok && start.data !== "HEAD") git(env.cwd, "switch", "--quiet", start.data);
  }
  const brief = [
    `handoff: ${done.length} task(s) in review`,
    `ids: ${done.map((task) => task.id).join(", ")}`,
    `sha: ${done.map((task) => `${task.id} ${task.sha.slice(0, 8)}`).join(", ")}`,
  ].join("\n");
  return ok({ tasks: done, brief });
}
