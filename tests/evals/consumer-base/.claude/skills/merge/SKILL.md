---
name: merge
description: >
  Merge reviewed work into main and push it — fast-forward each reviewed sha onto local main, then,
  once the push unit is complete (a task under no epic, or every task of a wave), rebase onto
  origin/main, check the tip, squash the unit into one commit and push. Use on a `cc-reviewer` verdict
  that closed tasks, or when asked to merge or push. Takes task ids, an epic or a wave, and defaults
  to the tasks the verdict approved.
argument-hint: "[task-ids|epic|wave]"
---

# Merge

Merging and pushing are yours alone (`AGENT_WORKFLOW.md` §4b), and **what is merged is what was reviewed**
(§5b): the scripts keep each reviewed patch or stop and say which task goes back to review.

1. **Merge.** For the verdict's `approved:` ids, `get_task` each: only a `done` task whose resolution starts
   `reviewed <sha>;` is merged.

   ```bash
   bun .claude/skills/merge/scripts/merge.ts merge <id>=<reviewed sha> …
   ```

   A fast-forward, or a rebase of `task/<id>` onto a moved `main` kept only when its patch id is unchanged. A
   conflict or a changed patch is code nobody reviewed: fix it on the branch and hand it off again.

   **A history bug closes here, not in review** (§5a). For each open bug in the wave whose summary opens
   `history:`, check its `doneWhen` against the history as it stands after the merge — `git merge-base
   --is-ancestor`, `git rev-list --count`, the fast-forward the script made — and, where it holds, move it to
   `review` and then `done` with the command and its result as the resolution. One that does not hold is fixed in
   the history (a rebase under the patch rule), never sent back to `cc-reviewer`.
2. **Is the push unit complete?** A task under no epic is its own unit. A task in an epic pushes with its wave:
   any task of the wave in `backlog`, `todo`, `doing` or `review` holds it, and tasks with no wave push only when
   the whole epic is `done`. Local `main` is linear, so a push carries everything merged beneath it. **An
   incomplete unit stops here** — say what was merged and what the push waits on.
3. **Prepare the push** — one call; it never pushes:

   ```bash
   bun .claude/skills/merge/scripts/merge.ts push --message "<prefix: why>" --ids <id>,<id>
   ```

   It fetches, rebases `main` onto `origin/main` holding every unpushed commit's patch id in order, runs
   `verify:unit` on the tip, squashes to one commit and proves the squash's tree is the checked tip's. **The push
   that closes an epic** adds `--full`: the script stops after the rebase and names the tip; send `bun run verify`
   on it to `cc-tester`, then rerun with `--checked <sha>`. A red check is filed as a bug in the same wave.
   - The message is a short why in the repository's convention, `minor:` or `major:` when a published export
     changes, with no task id, trailer or file list.
   - **Separate changes** — a task under no epic carried in a wave's push — keep one commit per contiguous run;
     squash those by hand with `git commit-tree` in merged order. **Forge's release commit is its own change**,
     message `chore: release <version>` verbatim (`BUILD_TOOLING.md` §2a).
4. **Push** with the printed `git push origin main`, then delete the printed branches. Report the pushed range and
   the check it ran on.

**A refused push is information, never forced past:** not a fast-forward, rerun step 3; a dirty host tree, stop
and tell the user; anything else, report the server's words and stop.
