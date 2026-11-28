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

Only **because the user asked** (`AGENT_WORKFLOW.md` §4b). The release command holds every guard — version,
gate, changelog, tag — and this skill only orders them. **A refusal is reported, never worked around**: no
override flag the user did not name, no hand-typed version, no hand-made tag.

1. **Preview** on an up-to-date, clean `main`: `bun run release --dry` (add `<version>` only if the user named
   one). Read the version, the bump that chose it, and the `commit:` row, which must read `here; tagged once
   pushed to the publishing branch`. A refusal, an unexpected version or another `commit:` row is reported
   before going on.
2. **Release on a task branch.** File a chore under no epic, `Release <version>`, move it to `doing`, branch
   `task/<id>` from `main`, and run `bun run release --allow-branch > /tmp/release-<version>.log 2>&1` — the one
   flag this skill passes. It runs `verify:scheduled`, writes the release files and commits
   `chore: release <version>`. A red gate or a refusal stops the release with the task in `doing`; a defect it
   found is filed as its own bug.
3. **Its own push unit.** Hand it off with the `handoff` skill and merge it with the `merge` skill. **The subject
   stays `chore: release <version>` verbatim**, through the handoff and the squash, because the command finds the
   commit by it. The resolution also names the release gate that passed.
4. **Tag** on `main`, fast-forwarded to the push: `bun run release`. It tags the publishing branch's tip and pushes
   only that tag — **the command's push, never yours**. `The release commit has not reached <branch> yet` means
   finish step 3; any refusal is reported, and a refused tag push has already deleted the local tag.
5. **Tell the user** the version, the release commit and the tag, and hand over the step that is theirs, from the
   host: `git push && git push --tags`. Do not run it or offer an alternative.
