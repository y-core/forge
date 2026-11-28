import type { WorkflowEnv } from "./git";
import { handoff, type HandoffTask } from "./handoff";
import { mergeReviewed, preparePush } from "./merge";

function split(argv: readonly string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (["full", "structure-approved"].includes(arg.slice(2))) flags.set(arg.slice(2), "true");
    else flags.set(arg.slice(2), argv[++i] ?? "");
  }
  return { positional, flags };
}

const HANDOFF_USAGE = "usage: handoff.ts <task-id>[@<base>] … [--message <one commit's message>]";

const MERGE_USAGE =
  "usage: merge.ts merge <task-id>=<reviewed sha> …  |  merge.ts push [--message <msg>] [--ids a,b] [--full] [--checked <sha>] [--structure-approved]";

/** Runs the `handoff` skill's script over `argv`, printing the resolutions and the brief, and answering the exit code. @public */
export function handoffScript(argv: readonly string[], env: WorkflowEnv): number {
  const { positional, flags } = split(argv);
  const message = flags.get("message");
  if (positional.length === 0 || (message !== undefined && positional.length > 1)) {
    console.error(message === undefined ? HANDOFF_USAGE : `--message names one commit, so hand off one task with it\n${HANDOFF_USAGE}`);
    return 2;
  }
  const tasks = positional.map((arg): HandoffTask => {
    const [id = "", base] = arg.split("@");
    return { id, ...(base === undefined ? {} : { base }), ...(message === undefined ? {} : { message }) };
  });
  const result = handoff(env, tasks);
  if (!result.ok) {
    console.error(`handoff stopped: ${result.error}`);
    return 1;
  }
  for (const task of result.data.tasks) console.log(`${task.id} resolution: ${task.resolution} …   (check log: ${task.log})`);
  console.log(`\ncc-reviewer brief:\n${result.data.brief}`);
  return 0;
}

/** Runs the `merge` skill's script over `argv` — its `merge` or its `push` step — and answers the exit code; it never pushes. @public */
export function mergeScript(argv: readonly string[], env: WorkflowEnv): number {
  const [step, ...rest] = argv;
  const { positional, flags } = split(rest);
  if (step === "merge") {
    const tasks = positional.map((arg) => {
      const [id = "", sha = ""] = arg.split("=");
      return { id, sha };
    });
    if (tasks.length === 0 || tasks.some((task) => task.id === "" || task.sha === "")) {
      console.error(MERGE_USAGE);
      return 2;
    }
    const merged = mergeReviewed(env, tasks);
    if (!merged.ok) {
      console.error(`merge stopped: ${merged.error}`);
      return 1;
    }
    for (const task of merged.data) console.log(`merged ${task.id} ${task.sha.slice(0, 8)}${task.rebased ? " (rebased, patch id unchanged)" : ""}`);
    return 0;
  }
  if (step === "push") {
    const message = flags.get("message");
    const ids = flags.get("ids");
    const checked = flags.get("checked");
    const prepared = preparePush(env, {
      ...(message === undefined ? {} : { message }),
      ...(ids === undefined ? {} : { ids: ids.split(",").filter((id) => id !== "") }),
      ...(flags.has("full") ? { full: true } : {}),
      ...(checked === undefined ? {} : { checked }),
      ...(flags.has("structure-approved") ? { structureApproved: true } : {}),
    });
    if (!prepared.ok) {
      console.error(`push stopped: ${prepared.error}`);
      return 1;
    }
    if (prepared.data.state === "needs-full-gate") {
      console.log(`rebased; ${prepared.data.next}`);
      return 0;
    }
    console.log(
      `squashed to ${prepared.data.sha.slice(0, 8)}, identical to the checked tip ${prepared.data.checked.slice(0, 8)}. Run:\n${prepared.data.push.join("\n")}`,
    );
    return 0;
  }
  console.error(MERGE_USAGE);
  return 2;
}
