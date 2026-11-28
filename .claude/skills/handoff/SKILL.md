---
name: handoff
description: >
  Hand finished work to review — make each task's one commit, check the tasks are in review with
  their sha, then dispatch the `cc-reviewer` agent in the background with a brief of ids and shas
  alone. Use when work moves to `review`. Takes task ids, an epic or a wave, and defaults to what
  this session just moved.
argument-hint: "[task-ids|epic|wave]"
---

# Handoff

You own the work; the reviewer is **`cc-reviewer`**, which starts with nothing but the ledger. **The ledger is
the payload and the brief is only a doorbell** — prose in the brief is a second copy that can disagree with the
record and anchors a reader whose worth is having no opinion yet.

1. **Settle the set.** The ids you were given, else the tasks this session moved to `review`. An epic or a wave
   names a set; it never widens one.
2. **Make each task's one commit and check it** (`AGENT_WORKFLOW.md` §4b, §5b) — one call:

   ```bash
   bun .claude/skills/handoff/scripts/handoff.ts <id>[@<base>] … [--message "<why, in the repo's convention>"]
   ```

   It rebases `task/<id>` onto its base (`main`, or a sibling's handed-off sha after `@`), squashes it to one
   commit, runs `bun run verify:unit` with the stream to a file, and prints each resolution prefix and the brief.
   `--message` is required when the branch holds more than one commit: a release-tooling prefix kept, no task
   id, trailer or file list. **A non-zero exit is not a handoff** — fix, commit, run it again.
3. **Move each task to `review`** with the printed `sha: …; check: verify:unit green;` and what was done. A task
   already in review keeps its commit only if that sha is still its branch's tip and only commit.
4. **Dispatch** one background `Agent`, `subagent_type: cc-reviewer`, whose prompt is the printed brief and
   nothing else — no summary, no hint where to look, no expected verdict.

**Never review in this thread**, or by an agent that wrote the work. **One review per sha**: only a new sha gets
a new review. **The verdict is the reviewer's**: do not close, reopen or re-word what it wrote. Tell the user the
review is running and stop; the notification is the verdict.

**On the verdict:** for closed tasks, invoke the `merge` skill. A filed finding is fixed on the branch of the task it
was found in, never on one of its own; hand off the task and its bugs together, each bug's resolution naming the
new sha. A wave holding an open finding is not pushed.
