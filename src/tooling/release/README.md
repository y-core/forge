---
title: The Release Workflow
description: "Resolves the next version from git history, guards the public export surface against a silent shrink, promotes the changelog, commits and tags."
audience: internal
---

# `@y-core/forge/tooling/release`

`forge release` cuts a release from what git already knows. It resolves the next version from the commit subjects since the latest tag, refuses a
few things that should not ship, promotes `CHANGELOG.md`, updates `package.json`, commits both, and creates the tag. It never pushes.

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

**The promoted changelog ships in the same commit as the bump**, because `stageFiles` defaults to exactly what the release wrote. The bump, the
promotion and the tag cannot come apart.

A project with no changelog releases unchanged — promotion is skipped, not failed. `changelogFile` renames the file the release looks for.

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
| HEAD is not on the branch the remote publishes from | Switch branch; `--allow-branch` for a deliberate release branch |
| The gate failed | Fix what it reported; `--allow-unverified` tags a tree no gate has passed |
| The gate could not be run | Name this project's gate with `gateCommand`; `--allow-unverified` releases without one |
| The commit failed with the version already written | `git checkout -- package.json CHANGELOG.md`, which the error names |
| The release commit changed a path it never staged, or none | `git reset HEAD^`, which the error names; no tag is cut — no flag reaches this one |

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
([`BUILD_TOOLING.md`][bt-2b] §2b). The ancestry and push checks are the amend floor's ([`BUILD_TOOLING.md`][bt-2j] §2j).

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

`forge release` commits and tags. Pushing the tag is what publishes: `.github/workflows/release.yml` re-runs the gate's `unit` tier, packs the
tag with `bun pm pack`, attests the tarball's build provenance, and attaches it to a GitHub Release. The command's last line is the push to run.

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

**A tag that fails to create after the commit landed says so.** The message names the commit as unpushed and untagged, because that is the state you
have to clean up.

---

## See also

- [`@y-core/forge/tooling/gate`][gate-readme] — the changelog parser, the semver primitives and the barrel parser this namespace builds on
- [`@y-core/forge/tooling/cli`][cli-readme] — the command framework `createReleaseCommand` returns a `Command` of
- [`BUILD_TOOLING.md`][bt-2a] §2a–§2e — the rulings behind the release workflow

[bt-2a]: ../../../docs/BUILD_TOOLING.md#2a-createreleasecommand--automated-release-workflow
[bt-2b]: ../../../docs/BUILD_TOOLING.md#2b-the-export-surface-a-release-compares
[bt-2c]: ../../../docs/BUILD_TOOLING.md#2c-git-and-manifest-internals
[bt-2d]: ../../../docs/BUILD_TOOLING.md#2d-changelog-promotion--the-unreleased-contract
[bt-2j]: ../../../docs/BUILD_TOOLING.md#2j-trunk-only-development-and-the-amend-floor
[cli-readme]: ../cli/README.md
[fc-4c]: ../../../warden/canon/apps/FORGE_CONSUMPTION.md#4c-upgrading-the-library
[gate-readme]: ../gate/README.md
