---
title: The Release Workflow
description: "Resolves the next version from git history, guards the public export surface against a silent shrink, promotes the changelog, commits and tags."
audience: internal
---

# `@y-core/forge/tooling/release`

`forge release` cuts a release from what git already knows. It resolves the next version from the commit subjects since the latest tag, refuses a
few things that should not ship, promotes `CHANGELOG.md`, updates `package.json`, commits both, and creates the tag. It pushes nothing but the
release tag, and that only under `tagOn: "pushed"`.

It stages exactly what it wrote, so the common project configures nothing at all.

**Node.js / Bun only.** This namespace shells out to `git` and reads and writes `package.json` and the changelog. Do not import it into a Cloudflare
Worker or a client bundle.

```bash
forge release --dry     # resolve the version and print what would happen; write nothing
forge release           # bump, promote, commit, tag
forge release 2.1.0     # force the version, which must be greater than the latest tag
```

The release path, its refusals and the surface it compares are [`BUILD_TOOLING.md`][bt-2a] §2a and §2b's; this file teaches the use.

---

## Getting started

```json
{ "scripts": { "release": "forge release" } }
```

Run the preview first. It resolves the version and prints what would happen, writing nothing:

```bash
bun run release --dry
bun run release
```

`forge release --help` lists the flags. Each `--allow-*` flag gets past one refusal, and [Getting past a refusal](#getting-past-a-refusal) says
when that is right.

**Commit before you dry-run.** The resolution reads `<latest-tag>..HEAD`, so a preview taken with the work still uncommitted reports "nothing to
release" rather than the version a real release would produce.

---

## Choosing the next version

The bump comes from commit subjects, and the highest one in the range wins:

```bash
git commit -m "major: rewrite kernel ABI"    # → next major
git commit -m "minor: add export panel"      # → next minor
git commit -m "fix snapping tolerance"       # → next patch, the default
```

A range holding both a `major:` and a later `fix …` releases as a major — every subject in the range is read, not just the tip. The run prints the
commit that won as a `because:` row beside the version, so the bump traces to one commit instead of to a rule you have to reapply by hand.

Pass a version explicitly when the derivation would be wrong — a `1.0.0` that no subject prefix can ask for, say. An explicit version is rejected
unless it is greater than the latest tag.

Some resolutions write nothing and are not failures: **no tags yet** releases `0.0.1`, **no commits since the latest tag** reports "already at" and
stops, and **a tag that already exists** stops before any write.

---

## Writing the changelog entry

Write entries under `[Unreleased]` as you go; the release promotes that section in place, retitles it with the resolved version and the releaser's
local date, inserts a fresh empty `[Unreleased]` above it, and appends a compare link built from `package.json`'s `repository` URL. The heading
grammar and the round-trip guarantees are [`BUILD_TOOLING.md`][bt-2d] §2d's.

**The promoted changelog ships in the release commit with the bump**, because `stageFiles` defaults to exactly what the release writes. A file
you have already committed yourself is left out of it, since the release commits only what still differs from HEAD.

A project with no changelog releases unchanged — promotion is skipped, not failed. `changelogFile` renames the file the release looks for.

---

## Finishing a release over several runs

A release stays open until its tag exists. You can keep working after the first run, and each run brings the release up to date with the
working tree. This sequence is supported:

1. Run `bun run release`. It runs the gate, bumps `package.json` and promotes `[Unreleased]` into `[<version>]`. With `.git` read-only it
   stops at the host steps instead of committing and tagging, which leaves the release open.
2. Commit more work, with or without the release files.
3. Add changelog entries, under `[Unreleased]` or straight into `[<version>]`.
4. Run `bun run release` again. It folds every new entry into the one `[<version>]` section, writes only the files that changed, runs the gate
   over them, and prints fresh host steps.
5. Run the printed host steps on the host.
6. Run `bun run release` once more to confirm. It prints `Already at <version> — nothing to release.`

**The date on `[<version>]` stays put unless the content changed.** A rerun with no new entry keeps it; a rerun that folds one in, or finds
an entry written into `[<version>]` itself, takes today's date. **A release file you have already committed is not committed again**, and
when every one of them is, the host step tags HEAD with no commit. The states behind this are [`BUILD_TOOLING.md`][bt-2a] §2a's.

**When `.git` is read-only, the summary's `commit:` row reads `on the host (.git is read-only)` rather than `here`**, before the gate runs and
under `--dry` too. The printed commands carry the real HEAD, version and blob ids, and name only the release files that differ from HEAD. On a
first run of forge's own release the output reads:

```text
.git is read-only here, so commit and tag v<version> on the host:
  test "$(git rev-parse HEAD)" = <sha> && git hash-object package.json CHANGELOG.md config/changelog-sections.json   # expect <ids>
  git commit -m "chore: release <version>" -- package.json CHANGELOG.md config/changelog-sections.json
  git tag v<version>
  git push && git push --tags
Then run `bun run release` here to confirm.
```

Run the indented lines on the host, one at a time. **If the first line prints nothing, or ids other than the ones it expects, stop**: HEAD or a
release file has changed since the run, and committing now would release something the gate never saw. Run the release again for fresh steps.
The commit names its paths, so nothing else you have staged goes into it, and repeating any of these commands does no harm.

When HEAD already holds every release file, the steps tag HEAD after checking it is the commit the run saw:

```text
.git is read-only here, so tag v<version> on the host:
  test "$(git rev-parse HEAD)" = <sha> && git tag v<version>
  git push && git push --tags
Then run `bun run release` here to confirm.
```

When HEAD is the release commit and only the tag was missed, the check is dropped:

```text
.git is read-only here, so tag v<version> on the host:
  git tag v<version>
  git push && git push --tags
Then run `bun run release` here to confirm.
```

With `.git` writable, the run commits and tags itself and prints only the push, unless `tagOn` is `"pushed"`.

### A clone that tags after the push

A clone whose push flow may give the release commit a new sha says so in its release config:

```ts
// config/release.config.ts
export default defineReleaseConfig({ tagOn: "pushed" });
```

The release then runs in this order:

1. Run `bun run release` in the clone. It runs the gate, writes and commits the release, and cuts no tag. The summary's `commit:` row reads
   `here; tagged once pushed to the publishing branch`.
2. Push the release commit to the publishing branch through the repository's push flow. In an agent clone, the `merge` skill pushes it as its own
   unit and keeps its subject, `chore: release <version>`.
3. Run `bun run release` in the clone again. It fetches `origin`, checks the publishing branch's tip, tags that tip and pushes only the tag.
4. Run `git push && git push --tags` on the host.

The first run prints:

```text
Committed "chore: release <version>" here; v<version> is cut once it reaches <publishing>.
Push it to <publishing> through the repository's push flow (in an agent clone, the `merge` skill), keeping its subject, then run `bun run release` here again.
```

A run before the push has landed prints `The release commit has not reached <publishing> yet, so v<version> was not cut.` and the same second line.
Once it has landed:

```text
Tagged <publishing>'s tip <sha> as v<version> and pushed the tag. Publish from the host:
  git push && git push --tags
```

`<publishing>` is the branch the remote publishes from, `origin/HEAD`, never the branch the clone is on: a release run on `task/<id>` under
`--allow-branch` still tags the publishing branch. Its tip is tagged only when it holds the tree the gate passed and the release subject; the push
may give the commit a new sha, so no sha is compared. When the release files were already committed under another subject, the tree alone is
checked.

The run refuses as `publishing-mismatch`, cutting no tag, when the tip:

- **is the release commit over another tree**: the push carried other work in. Release again on that tip, which gates the pushed tree.
- **carries the gated tree under another subject**: check the tip and tag it on the host by hand.
- **has moved past the release commit**: check the commit the error names and tag it on the host by hand.

When the tag is cut but the remote lacks it, the run prints `git tag -d v<version>`: delete the local tag and release again, and the run checks the
tip and pushes it. When the tag is already on the remote and the clone lacks it, the run writes nothing and prints:

```text
v<version> is already on the remote. Run `git fetch --tags` and `bun run release` here to confirm.
```

---

## Getting past a refusal

Each refusal has a flag or it has none, and the ones with none are the ones worth reading twice.

| Refused because | Say instead |
| --- | --- |
| The working tree is dirty | Commit or stash; `--allow-dirty` defeats the guard's only purpose |
| `[Unreleased]` is empty and commits exist | Write the entry; `--allow-empty-changelog` is for a genuinely entry-free tooling release |
| A patch release drops a public export | Give the removing commit a `minor:` subject prefix (`major:` from 1.0); `--allow-semver` if a patch is genuinely right |
| The changelog does not parse | Fix the document — no flag reaches this one |
| The previous tag is not an ancestor of HEAD | Recover the rewritten commits with `git reflog` and rebuild HEAD on the tag — no flag reaches this one |
| A reachable remote does not carry the previous tag | `git push --tags`, then release |
| HEAD is detached | Check out the branch you are releasing; `--allow-branch` if you meant it |
| The remote names no publishing branch, with `tagOn: "pushed"` | `git remote set-head origin --auto`, then release — no flag reaches this one |
| `publishing-mismatch`: the publishing branch's tip is not the gated release commit | Act on what the error names; no tag is cut — no flag reaches this one |
| `tag-push-failed`: the server refused the tag | Release again once the server accepts it; the local tag is already deleted |
| HEAD is not on the branch the remote publishes from | Switch branch; `--allow-branch` for a deliberate release branch |
| The gate failed | Fix what it reported; `--allow-unverified` tags a tree no gate has passed |
| The gate could not be run | Name this project's gate with `gateCommand`; `--allow-unverified` releases without one |
| The commit failed with the version already written | Fix the cause (a pre-commit hook, most often) and run the release again; it writes only what still differs |
| `release-partial`: `package.json` changes more than its version, or the changelog edits a section that already shipped | Commit a `package.json` change of your own first, or restore the file from HEAD with `git show HEAD:./<file> > <file>`, which works with `.git` read-only — no flag reaches this one |
| `version-mismatch`: another version is already written, or committed and untagged | Run the release again with that version to finish it, then release the next one |
| The release commit changed a path it never staged, or none | `git reset HEAD^`, which the error names; no tag is cut — no flag reaches this one |

**Run the release again after any failure.** Every run re-derives the release from the working tree and never promotes the changelog twice
([Finishing a release over several runs](#finishing-a-release-over-several-runs)). When the version is already tagged and a reachable remote
lacks the tag, the run prints `git push --tags` rather than refusing.

**Every refusal except the clean-tree check, the branch check and the gate fires under `--dry` too**, so a preview never hides the refusal it is
previewing. Those three are skipped because a dry run writes nothing for them to protect. A remote that cannot be reached at all is reported and
non-fatal.

**A gate that could not be run is refused differently from a gate that failed**, because every package runner reports a missing script the same way
a failing one exits. The refusal names `gateCommand` rather than telling you to fix what nothing reported.

**The branch check reports rather than refuses when the remote names no publishing branch.** `refs/remotes/origin/HEAD` is written by `git clone`
and by `git remote set-head`, so a repository created locally and pushed has none. **A detached HEAD is refused either way**: the printed
`git push` would push nothing while `git push --tags` published a tag no branch carries.

The surface guard compares the exports the previous tag published against the working tree's and names each entry that has gone. It runs only on an
auto-patch with a previous tag — an explicit version and a `minor:`/`major:` bump have already said what they are
([`BUILD_TOOLING.md`][bt-2b] §2b). The ancestry and tag-push checks enforce the tag floor ([`BUILD_TOOLING.md`][bt-2j] §2j).

---

## Staging files the release did not write

Add a config module only when a release has to touch something beyond `package.json` and the changelog — a lockfile, a monorepo's sibling manifests,
a version constant in source:

```ts
// config/release.config.ts — optional
import { defineReleaseConfig } from "@y-core/forge/tooling/release";

export default defineReleaseConfig({ stageFiles: ["package.json", "CHANGELOG.md", "bun.lock"] });
```

**`stageFiles` replaces the derived list rather than adding to it**, so name the changelog yourself if you still want it staged. The one file it
does not replace is `sectionsFile`: the section manifest is forge's own write, and it is staged on every run that promotes a changelog.

`cwd` is the one field the module may not set: it comes from `--root` or the working directory. A `--config` naming a missing file is an error; only
the unnamed default may be absent.

---

## Publishing the tagged tarball

`forge release` commits and tags. Pushing the tag to the public remote is what publishes: `.github/workflows/release.yml` re-runs the gate's `unit`
tier, packs the tag with `bun pm pack`, attests the tarball's build provenance, and attaches it to a GitHub Release. The command's last line is the
push to run.

**The job runs in the `release` environment, which protects nothing until you configure it.** Add its protection rules — required reviewers, the
tags allowed to deploy — under the repository's Settings → Environments. A consumer checks the tarball with
`gh attestation verify y-core-forge-<version>.tgz --repo <owner>/<repo>`.

**The gate that decides the release runs here, before the tag exists.** CI's run is a backstop on a different machine: by the time it fails, the tag
is already public with no asset attached, so a consumer pinning that version ([`FORGE_CONSUMPTION.md`][fc-4c] §4c) has nothing to install and
no version is left to reuse.

The gate is `bun run verify` unless the release config names another, so a project whose script is called something else says so once:

```ts
// config/release.config.ts
export default defineReleaseConfig({ gateCommand: ["bun", "run", "check"] });
```

A consumer then depends on that tarball by URL, in the form [`FORGE_CONSUMPTION.md`][fc-4c] §4c names.

---

## Calling it from your own code

`resolveVersion` answers "what would the next version be?" without releasing anything:

```ts
import { resolveVersion } from "@y-core/forge/tooling/release";

const result = resolveVersion({ cwd: process.cwd(), tagPrefix: "v" });
result.version; // "1.3.0"
result.reason; // "auto-minor"
result.previous; // "v1.2.4" | null
result.evidence?.commit?.subject; // "minor: add export panel" — set only on an auto-* reason
```

Every failure is a `ReleaseError` carrying a discriminated `kind`, so a caller can branch instead of matching on message text. The kinds are the
`ReleaseErrorKind` union in `src/tooling/release/types.ts`:

```ts
import { ReleaseError, resolveVersion } from "@y-core/forge/tooling/release";

try {
  resolveVersion({ cwd, tagPrefix: "v", explicit: "0.9.0" });
} catch (err) {
  if (err instanceof ReleaseError && err.kind === "version-not-greater") {
    console.error("Pick a version higher than the latest tag.");
  } else {
    throw err;
  }
}
```

To register a release inside a CLI of your own, `createReleaseCommand({ cwd })` returns the `Command` — the same one `forge release` runs, minus the
config-module lookup and the `--config` and `--root` flags.

---

## Gotchas

**A refusal throws; it does not exit.** `execute` renders the error and exits 1, so the operator sees the same output while the guard stays
reachable from a test that mocks no process.

**The changelog parser and the semver primitives are imported from [`@y-core/forge/tooling/gate`][gate-readme], not from here**, because the gate's
own changelog and export-surface checks read them too.

**The git and `package.json` helpers are deliberately unpublished** ([`BUILD_TOOLING.md`][bt-2c] §2c). What forge publishes is the release command
itself.

**A tag that fails to create after the commit landed is resumed, not cleaned up.** The message names the commit as unpushed and untagged. Run
the release again: it finds the release commit at HEAD, writes and commits nothing, and cuts only the tag. It runs the gate again only when no
gate record covers that commit.

---

## See also

- [`@y-core/forge/tooling/gate`][gate-readme] — the changelog parser, the semver primitives and the barrel parser this namespace builds on
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework `createReleaseCommand` returns a `Command` of
- [`BUILD_TOOLING.md`][bt-2a] §2a–§2e — the rulings behind the release workflow

[bt-2a]: ../../../docs/BUILD_TOOLING.md#2a-createreleasecommand--automated-release-workflow
[bt-2b]: ../../../docs/BUILD_TOOLING.md#2b-the-export-surface-a-release-compares
[bt-2c]: ../../../docs/BUILD_TOOLING.md#2c-git-and-manifest-internals
[bt-2d]: ../../../docs/BUILD_TOOLING.md#2d-changelog-promotion--the-unreleased-contract
[bt-2j]: ../../../docs/BUILD_TOOLING.md#2j-task-branches-and-the-amend-floor
[cli-readme]: ../cli/README.md
[fc-4c]: ../../../warden/canon/apps/FORGE_CONSUMPTION.md#4c-upgrading-the-library
[gate-readme]: ../gate/README.md
