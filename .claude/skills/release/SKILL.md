---
name: release
description: >
  Cut a release the user asked for, the same way every time — preview it, run the release command on a
  task branch, take the release commit through handoff, review and merge as its own push unit, then
  re-run the command so it tags the pushed commit and pushes that one tag. Use only when the user asks
  to cut, make or publish a release; never offer one. Takes an optional version, which the command
  otherwise computes.
argument-hint: "[version]"
---

# Release

You are the **`forge-dev`** session, cutting a release **because the user asked for one** (`AGENT_WORKFLOW.md`
§4b). The release command holds every guard: the version, the gate, the changelog and the tag checks are its,
and this skill only puts them in order. **A refusal is reported, never worked around** — no override flag
the user did not name, no hand-typed version, no hand-made tag.

## 1. Preview

On an up-to-date `main` with a clean tree (`git switch main`, `git fetch origin`,
`git merge --ff-only origin/main`), run the preview:

```bash
bun run release --dry            # or: bun run release <version> --dry, when the user named one
```

It writes nothing. Read three things from it: the version, the bump that chose it, and the `commit:` row,
which must read `here; tagged once pushed to the publishing branch`. **A refusal ends the release here**:
report the command's words and its suggested fix to the user, and stop. Anything else — a version the user
did not expect, a `commit:` row that says something else — is also reported before going on.

## 2. Release on a task branch

File a chore under no epic for the release (`create_task`, summary `Release <version>`), move it to `doing`,
and branch from `main`, `git switch -c task/<id>`. Then:

```bash
bun run release --allow-branch > /tmp/release-<version>.log 2>&1   # add <version> only if the user named one
```

`--allow-branch` is the one flag this skill passes: the release is made on the task branch and tags the
publishing branch later, never HEAD. The command runs the gate — `verify:scheduled`, which needs every
runtime requirement up — writes the release files and commits `chore: release <version>`, and prints that it
waits on the push. **A red gate or a refusal stops the release**: report the minimal excerpt and leave the task
in `doing`; a defect it found is filed as its own bug.

## 3. The release commit is its own push unit

Hand it off with the `handoff` skill. **The commit keeps its subject verbatim**, `chore: release <version>`:
the command recognises the commit by it, so the handoff's one commit is the release's own, never re-worded.
The handoff's task check runs as for any task, and its resolution also names the release gate that passed.

On the reply, the `merge` skill merges and pushes it. A task under no epic is its own push unit, and the
release commit is a change of its own: the squash keeps `chore: release <version>` as the whole message
(`merge`, step 3).

## 4. Tag the pushed commit

On `main`, fast-forwarded to the push:

```bash
bun run release
```

It fetches, checks that the publishing branch's tip carries the gated tree and the release subject, tags that
tip and pushes only that tag. **This is the command's push, not yours** — never run a tag push yourself
(`AGENT_WORKFLOW.md` §4b).

- **`Tagged <branch>'s tip … and pushed the tag`** — the release is cut. Go on to step 5.
- **`The release commit has not reached <branch> yet`** — the push has not landed; finish step 3.
- **`publishing-mismatch`, `tag-push-failed` or any other refusal** — report the command's words and stop. A
  refused tag push has already deleted the local tag, so the same command is safe to run again once the
  user has fixed what it names.

## 5. Tell the user

Report the version, the release commit on `main`, and the tag. Then hand over the one step that is theirs —
publishing to the public remote, from the host:

```bash
git push && git push --tags
```

Do not run it, offer an alternative, or remind them later.
