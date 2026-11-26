---
name: handoff
description: >
  Hand finished work to the forge-review session — make each task's one commit, check the tasks are
  in review with their sha, then ring the reviewer's doorbell over SendMessage. Use when work moves
  to `review`. Takes task ids, an epic or a wave, and defaults to what this session just moved.
argument-hint: "[task-ids|epic|wave]"
---

# Handoff

You are the **`forge-dev`** session. The peer is **`forge-review`**.

**The ledger is the payload and this message is only a doorbell.** Everything the reviewer needs —
the resolution, the commit it names, the criterion it was filed against, any constraint on how to
read the code — is already on the task. Prose in the message is a second copy of a record that
exists, free to disagree with it.

## Settle the set

Resolve what you were given to a list of task ids. Given nothing, that is the tasks this session
moved, or is about to move, to `review`. An epic or a wave identifies a set; neither widens one past
the ids you were handed.

## Make each task's one commit

A task reaches review as one commit on its own branch (`AGENT_WORKFLOW.md` §4b, §5b). For each id,
on `task/<id>`:

1. **Rebase onto its base.** The base is local `main`, or — for a task started on a sibling that has
   not been merged yet — the sibling's handed-off sha. `git rebase <base>`.
2. **Squash to one commit.** `git reset --soft <base>`, then one `git commit`: a short summary of
   why in the repository's convention, a prefix its release tooling reads kept, and no task or epic
   id, trailer or file list.
3. **Run the task check on that commit** — `bun run verify:unit`, its stream to a file
   (`AGENT_WORKFLOW.md` §3). A red check is not a handoff: fix, amend, run it again.
4. **Move it to `review`** with a resolution that starts
   `sha: <git rev-parse HEAD>; check: verify:unit green;` and goes on to say what was done.

A task already in `review` keeps its commit if its resolution's sha is still `task/<id>`'s tip and
the only commit above its base. Otherwise it is redone from step 1 — a sha that moved is a different
claim. Say so and stop if a task cannot be brought to that state.

## Check the reviewer is up

`ListAgents`. If no `forge-review` session is listed, stop and tell the user the handoff was not
sent. Do not review your own work, and do not spawn a subagent to stand in for it — a review by the
session that wrote the code is the thing this split exists to prevent.

## Ring

`SendMessage` to `forge-review`:

```text
handoff: <n> task(s) in review
ids: <task-id>, <task-id>, ...
sha: <task-id> <short sha>, <task-id> <short sha>, ...
action: invoke the `review-handoff` skill on the ids above — /review-handoff
```

**The `action` line is not decoration.** A cross-session message is not the user typing a command,
so the reviewer's trigger is not guaranteed to fire on the `handoff:` line alone.

## Then stop

Tell the user what you sent. **Do not close the tasks yourself** — `move_lane` reaches `done` only
from `review`. Do not poll; the reply wakes this session on its own.

## When the reply comes

- **Tasks closed** — invoke the `merge` skill on the reply. It merges each reviewed sha into local
  `main`, and pushes once the push unit is complete; the full gate that closes an epic runs there,
  before its push.
- **Findings filed or tasks reopened** — fix each filed bug on the branch of the task it was found
  in, never on a branch of its own (`AGENT_WORKFLOW.md` §5b). Squash that branch to its one commit
  again and hand off the task and its bugs together, each bug's resolution naming the task's new
  sha. A wave holding an open finding is not pushed.
