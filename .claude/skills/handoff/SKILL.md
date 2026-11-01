---
name: handoff
description: >
  Hand finished work to the forge-review session — check the tasks are in review, then ring the
  reviewer's doorbell over SendMessage. Use after moving work to `review`. Takes task ids, an epic
  or a wave, and defaults to what this session just moved.
---

# Handoff

You are the **`forge-dev`** session. The peer is **`forge-review`**.

**The ledger is the payload and this message is only a doorbell.** Everything the reviewer needs —
the resolution, the criterion it was filed against, any constraint on how to read the code — is
already on the task. Prose in the message is a second copy of a record that exists, free to
disagree with it.

## Settle the set

Resolve what you were given to a list of task ids. Given nothing, that is the tasks you moved to
`review` in this session. An epic or a wave identifies a set; neither widens one past the ids you
were handed.

Every task must be in `review`, its task check — `bun run verify:unit` — green on the tree as it
stands; the lane is what offers it for a verdict. Say so and stop if one is not.

## Check the reviewer is up

`ListAgents`. If no `forge-review` session is listed, stop and tell the user the handoff was not
sent. Do not review your own work, and do not spawn a subagent to stand in for it — a review by the
session that wrote the code is the thing this split exists to prevent.

## Ring

`SendMessage` to `forge-review`:

```text
handoff: <n> task(s) in review
ids: <task-id>, <task-id>, ...
action: invoke the `review-handoff` skill on the ids above — /review-handoff
```

**The `action` line is not decoration.** A cross-session message is not the user typing a command,
so the reviewer's trigger is not guaranteed to fire on the `handoff:` line alone.

## Then stop

Tell the user what you sent. **Do not close the tasks yourself** — `move_lane` reaches `done` only
from `review`. Do not poll; the reply wakes this session on its own.

## When the reply comes

- **Findings filed or tasks reopened** — work them, move them to `review`, and hand off again.
- **No task of the epic left open** — the epic is closed; for tasks filed under no epic, the set you
  handed off is. Send the full gate — `bun run verify` — to `cc-tester` once and report its
  verdict. A red verdict is filed as a task and worked like any other.
- **Tasks of the epic still open elsewhere** — report the verdict and stop; the gate waits for the
  last of them.

**The user commits, and that is the end of your part.** Never commit, ask to, or remind
(`AGENT_WORKFLOW.md` §4b).
