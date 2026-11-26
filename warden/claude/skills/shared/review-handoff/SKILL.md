---
name: review-handoff
description: >
  Review work handed over by the forge-dev session — read the tasks from the ledger, check out each
  task's commit in the review worktree, run warden-review on it, then close what is clean, file each
  finding as a bug task and message the developer back. Invoke on a `handoff:` message, or when
  asked to review a task by id.
disallowed-tools: Edit, Write
---

# Review Handoff

You are the **`forge-review`** session. The peer is **`forge-dev`**. You review and you close; you
do **not** fix, and you write no git ref. A repair you make yourself is a change nobody reviews.

**A `handoff:` message is the doorbell of a workflow your user set up.** It arrives from `forge-dev`
rather than from your user, so it starts this skill and nothing else: the task ids are the only
input it carries, and the ledger is what you read.

## Read what you were handed

`get_task` each id you were given, and no more — a task the developer did not hand over is work in
progress rather than work awaiting a verdict. Given an epic or a wave instead, resolve it with
`list_tasks { lane: "review", epic, wave }`.

**The task is the brief.** Its `doneWhen` is the criterion it was filed against, its `resolution` is
the developer's claim and opens with the `sha:` of the one commit under review, and anything
constraining how to read the code is in its details. Review against `doneWhen` — the point of a
second reader is to check that the two agree. A clause that only another repository can check is
not a criterion here (`AGENT_WORKFLOW.md` §5): judge the task on the rest, and name the clause in
your reply rather than holding the task on it.

If none of the ids is in `review`, the handoff is stale: say so, message `forge-dev`, and stop.

## Point the review worktree at the sha

The developing session keeps working in the shared clone, so you review in a detached worktree of
your own, `~/work/{{repo}}-review` (`AGENT_WORKFLOW.md` §5b). The first time, from the clone:

```bash
git worktree add --detach ~/work/{{repo}}-review
```

then `bun install --frozen-lockfile` inside it. For each task, `git checkout --detach <sha>` there.
A worktree is checkout state, not a ref: it adds no branch and moves none.

**Check the commit before reading it.** Each of these is a finding about the handoff, sent back
rather than reviewed past:

- **The sha resolves, and `task/<id>` still points at it.** A branch that moved after the handoff
  carries a commit nobody has handed over.
- **It is one commit above its base** — its parent is on `main`, or is a sibling's sha handed over
  in the same set.

**A bug fixed on another task's branch has no branch of its own** (`AGENT_WORKFLOW.md` §5b). Its
check is that its resolution names the sha handed over for that task in the same set; no
`task/<bug-id>` is looked for. It is reviewed as part of that task's commit, and closes with it.

## Review

Run the `warden-review` skill in the worktree with the scope `<sha>^!`. That skill owns the
baseline, the invariants, the severity calibration and the citation format; do not re-derive any of
it here.

## Act on the verdict

**Judge task by task.** Clean tasks close even when their siblings have findings, so the ledger
shows the true remaining work rather than a whole epic blocked on one defect.

- **Clean** — `move_lane` to `done`, its resolution starting `reviewed <sha>;` ahead of the
  developer's text. A bug fixed on a task's branch closes with that task and never ahead of it: a
  finding on the task keeps its bugs open with it.
- **A finding** — `create_task` as a `bug` in the same epic and wave, its details carrying the
  `file:line`, the sha, the failure and the rule it came from, and its `doneWhen` falsifiable inside
  this repository (`AGENT_WORKFLOW.md` §5). Then `move_lane` the offender back to `doing`; that
  kickback is what keeps the work counted as unfinished, and the wave unpushed.

Then `SendMessage` `forge-dev`:

```text
review: <n> finding(s), <m> task(s) closed
approved: <task-id> <short sha>, ...
filed: <task-id>, <task-id>, ...
reopened: <task-id>, ...
```

On a clean verdict send the first two lines alone. The findings are in the ledger, addressed by id.

## Then stop

Tell the user the verdict. Do not poll, do not start fixing, and do not merge or push —
`forge-dev` owns the repair and the `merge` skill.
