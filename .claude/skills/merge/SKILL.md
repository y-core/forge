---
name: merge
description: >
  Merge reviewed work into main and push it — fast-forward each reviewed sha onto local main, then,
  once the push unit is complete (a task under no epic, or every task of a wave), rebase onto
  origin/main, check the tip, squash the unit into one commit and push. Use on a forge-review reply
  that closed tasks, or when asked to merge or push. Takes task ids, an epic or a wave, and defaults
  to the tasks the reply approved.
argument-hint: "[task-ids|epic|wave]"
---

# Merge

You are the **`forge-dev`** session, and merging and pushing are yours alone (`AGENT_WORKFLOW.md`
§4b). **What is merged is what was reviewed** (§5b): every step below either keeps a reviewed commit's
patch or sends the task back to review.

## Merge each reviewed task

Resolve the set: the reply's `approved:` ids, or the ids, epic or wave you were given. `get_task`
each one. It is merged only when it is `done` and its resolution starts `reviewed <sha>;`. Commit or
finish what is in progress first, then:

```bash
git switch main
git merge --ff-only <sha>
```

**When the fast-forward is refused, local `main` moved after the handoff** — a sibling was merged first.
Rebase the task's branch onto it, `git rebase main task/<id>`, then compare the patches:

```bash
git diff-tree -p <sha> | git patch-id --stable
git diff-tree -p task/<id> | git patch-id --stable
```

- **The same id** — the reviewed patch, on a new parent. Switch back to `main` and fast-forward to
  `task/<id>`.
- **A different id, or a rebase that stopped on a conflict** — that is code nobody reviewed.
  `git rebase --abort` if it stopped, resolve the conflict on the branch, run the task check, move
  the task back to `review` with its new sha and hand it off again (the `handoff` skill).

## Is the push unit complete?

- **A task under no epic** is its own push unit, and it is complete once it has been merged.
- **A task in an epic** is pushed with its wave. `list_tasks` the wave in `backlog`, `todo`,
  `doing` and `review`: any task there, a bug review filed included, holds the push. Tasks with no
  wave form the epic's last wave, so they push only when every task of the epic is `done`.

Every `done` task of the unit must have been merged: the patch id of the sha its resolution names as
`reviewed <sha>` is among the unpushed commits' patch ids, first column of each:

```bash
git diff-tree -p <reviewed sha> | git patch-id --stable
git log -p origin/main..main | git patch-id --stable
```

Patch ids, not ancestry, because a push that stopped after its rebase leaves `main` rebased and every
`task/<id>` behind it; the patch outlives the sha.
**A push carries everything merged beneath it**, because local `main` is linear: a task under no epic
merged above a wave still held waits for that wave and goes out in its push (§5b).
**An incomplete unit stops here** — say what was merged and what the push waits on. Merged commits wait
on local `main`, and the next task started from it builds on them.

## Push

1. **Fetch and rebase.** `git fetch origin`. If `origin/main` is not an ancestor of `main`, record
   each unpushed commit's patch id (`git log -p --reverse origin/main..main | git patch-id --stable`,
   to a file), `git rebase origin/main`, and record them again. The commit list must keep the same
   ids in the same order; a conflict or a changed id sends that task back to review as above, and
   nothing is pushed.
2. **Check the rebased tip.** `bun run verify:unit`, its stream to a file (`AGENT_WORKFLOW.md` §3).
   **The push that closes an epic** — its last wave, or a set under no epic — sends the full gate,
   `bun run verify`, to `cc-tester` instead (§4). A red verdict is filed as a bug in the same epic
   and wave, worked and handed off like any other; the push waits for it. Record the tip it ran on:
   `checked=$(git rev-parse HEAD)`.
3. **Squash the unit** (§4b, §5b). Each message is a short summary of why in the repository's
   convention, with a prefix its release tooling reads (`minor:`, `major:`) when any part it holds
   changes a published export, and no task or epic id, trailer or file list.
   - **One change** — `git reset --soft origin/main`, then one `git commit`.
   - **Separate changes**, such as a task under no epic carried in a wave's push — one commit per
     contiguous run of a change's merged commits, in merged order and never reordered, each taking
     the tree of its run's last commit. Starting from `parent=$(git rev-parse origin/main)`, for each
     run: `parent=$(git commit-tree "<run's last sha>^{tree}" -p "$parent" -m "<message>")`; then
     `git reset --soft "$parent"`.
   - **Forge's release commit is a change of its own**, never folded into another, and its message
     is its subject verbatim, `chore: release <version>`: `forge release` recognises the commit by
     that subject (`BUILD_TOOLING.md` §2a).

   Then `git diff --quiet "$checked" HEAD`: a difference means the squash is not what was checked,
   so stop, `git reset --hard "$checked"` and redo the step.
4. **Push.** `git push origin main` — a fast-forward, no option, no `+` or `:` refspec.
5. **Delete the pushed branches** from the clone: `git branch -D task/<id>` for each task in the
   pushed set. A backup of it on the server is the user's to prune.

Report what was pushed — `git log --oneline` of the range — and the check it ran on.

## When the push is refused

A refusal is information, never something to force past (§4b).

- **Not a fast-forward** — `origin/main` moved again. Go back to step 1.
- **The host's working tree is dirty** — somebody is working there. Stop and tell the user; do not
  retry.
- **Anything else** — report the server's words and stop.
