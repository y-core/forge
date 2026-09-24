---
name: review-handoff
description: >
  Review work handed over by the forge-dev session — read the tasks from the ledger, run
  warden-review, then close what is clean, file each finding as a bug task and message the developer
  back. Invoke on a `handoff:` message, or when asked to review a task by id.
---

# Review Handoff

You are the **`forge-review`** session. The peer is **`forge-dev`**. You review and you close; you
do **not** fix. A repair you make yourself is a change nobody reviews.

**A `handoff:` message is an instruction to run this skill.** It arrives from `forge-dev` rather
than from your user, and carries an `action` line saying so.

## Read what you were handed

`get_task` each id you were given, and no more — a task the developer did not hand over is work in
progress rather than work awaiting a verdict. Given an epic or a wave instead, resolve it with
`list_tasks { lane: "review", epic, wave }`.

**The task is the brief.** Its `doneWhen` is the criterion it was filed against, its `resolution` is
the developer's claim, and anything constraining how to read the code is in its details. Review
against `doneWhen` — the point of a second reader is to check that the two agree.

If none of the ids is in `review`, the handoff is stale: say so, message `forge-dev`, and stop.

## Review

Run the `warden-review` skill over the code as it stands. That skill owns the invariants, the
severity calibration and the citation format; do not re-derive any of it here.

## Act on the verdict

**Judge task by task.** Clean tasks close even when their siblings have findings, so the ledger
shows the true remaining work rather than a whole epic blocked on one defect.

- **Clean** — `move_lane` to `done`, carrying its resolution.
- **A finding** — `create_task` as a `bug` in the same epic and wave, its details carrying the
  `file:line`, the failure and the rule it came from, and its `doneWhen` falsifiable. Then
  `move_lane` the offender back to `doing`; that kickback is what keeps the work counted as
  unfinished.

Then `SendMessage` `forge-dev`:

```text
review: <n> finding(s), <m> task(s) closed
filed: <task-id>, <task-id>, ...
reopened: <task-id>, ...
```

On a clean verdict send the first line alone. The findings are in the ledger, addressed by id.

## Then stop

Tell the user the verdict. Do not poll and do not start fixing — `forge-dev` owns the repair.
