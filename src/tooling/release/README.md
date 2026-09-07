---
title: The Release Workflow
description: "Resolves the next version from git history, guards the public export surface against a silent shrink, promotes the changelog, commits and tags."
---

# `@y-core/forge/tooling/release`

**The release workflow** — `forge release` resolves the next version from git history, guards the
public export surface against a silent shrink, promotes `CHANGELOG.md`, updates `package.json`,
commits, and creates the tag.

`forge release` is a **command, not a script you write**: it stages exactly what it wrote, so the
common project needs no configuration at all. `createReleaseCommand` stays published for a release
registered inside a CLI of your own.

```ts
import { createReleaseCommand, ReleaseError, resolveVersion } from "@y-core/forge/tooling/release";
```

> **Node.js / Bun only.** This namespace shells out to `git` via `node:child_process` and reads and
> writes `package.json` and the changelog via `node:fs`. **Do not import it into a Cloudflare Worker
> or a client bundle.**

> **This namespace depends on [`@y-core/forge/tooling/gate`](../gate/README.md), never the reverse.**
> The gate owns the changelog parser, the semver primitives, and the barrel parser; the release
> workflow is built on them. `parseChangelog`, `promoteUnreleased`, `formatReleaseDate` and the
> `SemVer` functions are imported from the gate, not re-exported here.

> The release path and its refusals, and the export surface a release compares, are owned by
> [`BUILD_TOOLING.md`](../../../docs/BUILD_TOOLING.md) §2a
> and §2b.

---

## Features

- **Automatic version resolution** (`resolveVersion`) — derives the next version from the latest git
  tag plus commit history. Every commit subject in `<latest-tag>..HEAD` is scanned and the highest
  bump wins: `major:` → major, `minor:` → minor, otherwise patch. The winning commit is reported as
  evidence.
- **A `release` command** (`createReleaseCommand`) — checks the working tree, resolves the version,
  guards the export surface, promotes the changelog, updates `package.json`, commits, and creates
  the git tag. Supports `--dry`/`-n`, `--allow-dirty`, `--allow-empty-changelog` and
  `--allow-semver`.
- **A semver shrink guard** — a patch release that drops a public export is refused. The surface at
  the previous tag is compared against the working tree's, so removing a symbol has to be a
  deliberate `minor:` or an explicit version.
- **Changelog promotion** — `[Unreleased]` becomes a dated version section, a fresh empty
  `[Unreleased]` takes its place, and a compare-link definition is appended. Both files land in one
  commit.
- **Structured errors** (`ReleaseError`) — every failure carries a discriminated `kind` so callers
  can react programmatically.

---

## Usage

### Wire up `release`

**No file at all.** `forge release` stages exactly what it wrote — `package.json`, plus the changelog
when one was promoted:

```json
{ "scripts": { "release": "forge release" } }
```

A `config/release.ts` is for the cases that reach beyond what the release itself writes — a lockfile,
a monorepo's sibling manifests, a version constant in source:

```ts
// config/release.ts — optional; forge itself ships none
import type { ReleaseCommandConfig } from "@y-core/forge/tooling/release";

export default { stageFiles: ["package.json", "CHANGELOG.md", "bun.lock"] } satisfies Omit<ReleaseCommandConfig, "cwd">;
```

`stageFiles` is an **override, not an addition** — naming it replaces the derived list, so include
the changelog yourself if you still want it staged.

`cwd` is the one field the config may not set — it comes from `--root`, or from the working
directory. That keeps a config module portable: it describes the release, not where it happens.

Running the command:

```bash
# Auto-resolve the next version from git history, then commit + tag
bun run release

# Preview without writing anything
bun run release --dry

# Force an explicit version (must be greater than the latest tag)
bun run release 2.1.0

# Bypass the clean-working-tree check
bun run release --allow-dirty

# Release even though [Unreleased] carries no entry
bun run release --allow-empty-changelog

# Release a patch despite a shrinking export surface
bun run release --allow-semver
```

The command derives the bump from the commit subjects since the latest tag, taking the highest one
it finds:

```bash
git commit -m "minor: add export panel"   # → next minor release
git commit -m "major: rewrite kernel ABI" # → next major release
git commit -m "fix snapping tolerance"    # → next patch release (default)
```

A range holding both `major:` and `fix …` releases as a **major** — the scan reads every subject in
the range, not just the tip. The subject that won is printed as the `because:` row, so the resolved
bump is traceable to one commit rather than to a rule the reader has to reapply by hand.

**`createReleaseCommand` stays published** for a release registered inside a CLI of your own, and it
is the only path that takes `deps` for testing:

```ts
const release = createReleaseCommand({ cwd: process.cwd() });
```

### What the run prints

Before writing anything, the command reports the resolution as a definition list — previous tag,
next version with its reason, the commit that justified it, the tag it will create, and what happens
to the changelog. `--dry` stops there. An existing tag also stops the run, without an error: there
is nothing to release.

### Promote the changelog on release

Given a `CHANGELOG.md` whose `[Unreleased]` section carries entries, the command retitles that
heading with the resolved version and today's local date, inserts a fresh empty `[Unreleased]` above
it, and appends a compare-link definition built from `package.json`'s `repository` URL. **Both files
land in one commit by default** — the promoted changelog is staged because the release wrote it, so
the bump, the promotion and the tag can never come apart.

`changelogFile` defaults to `"CHANGELOG.md"`; a project without one releases unchanged — the
promotion step is skipped, not failed.

The command refuses to release when `[Unreleased]` is empty (whitespace only, `---` separators only,
or just the `_Nothing yet._` placeholder) while commits exist since the tag.
`--allow-empty-changelog` overrides that, and still promotes — the released section ships carrying
`_Nothing yet._`. It does **not** override a changelog that fails to parse; that refusal has no
escape.

The parser and promoter themselves are [`@y-core/forge/tooling/gate`](../gate/README.md)'s, and
usable directly from there.

### Resolve a version programmatically

```ts
import { resolveVersion } from "@y-core/forge/tooling/release";

const result = resolveVersion({ cwd: process.cwd(), tagPrefix: "v" });
console.log(result.version); // e.g. "1.3.0"
console.log(result.reason); // "auto-minor"
console.log(result.previous); // "v1.2.4" | null
console.log(result.evidence?.commit?.subject); // "minor: add export panel"
```

### Handle failures by `kind`

```ts
import { ReleaseError } from "@y-core/forge/tooling/release";

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

---

## Core Components & APIs

### Release command

#### `forge release`

Resolves an optional config module and runs the release. `createReleaseBinCommand()` builds it, and
the `forge` binary attaches it.

| Flag | Default | Effect |
| --- | --- | --- |
| `--config <path>` | `config/release.ts` | Module default-exporting `Omit<ReleaseCommandConfig, "cwd">`. **Optional** — an absent default path releases with the built-in defaults. |
| `--root <path>` | the working directory | The repository the release happens in, supplied as `cwd`. |

Plus `--dry`/`-n`, `--allow-dirty`, `--allow-empty-changelog` and `--allow-semver`, and the optional
positional version, all delegated to `createReleaseCommand`. `DEFAULT_RELEASE_CONFIG` is the exported
default path.

**The config module may not set `cwd`.** It comes from `--root` or the working directory, so the
module describes _the release_ and stays portable across checkouts. A `--config` naming a missing
file is still an error — only the unnamed default is allowed to be absent, because that absence is
the zero-config case rather than a mistake.

#### `createReleaseCommand(config, deps?)`

Builds the `release` CLI `Command`. The returned command takes a single optional positional argument
— an explicit version — plus the four flags below.

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `ReleaseCommandConfig` | Project configuration (see below). |
| `deps` | `ReleaseDeps` | Optional dependency overrides for testing; defaults to the real git/pkg/version functions. |

`ReleaseCommandConfig`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `cwd` | `string` | — | Repository working directory. Required. |
| `tagPrefix` | `string` | `"v"` | Prefix for git tags (e.g. `v1.2.3`). |
| `stageFiles` | `string[]` | what the release wrote | `["package.json"]`, plus `changelogFile` when a changelog was promoted. Naming it **replaces** the derived list rather than adding to it. |
| `changelogFile` | `string` | `"CHANGELOG.md"` | Changelog to promote, relative to `cwd`. A missing file skips promotion. |

Flags:

| Flag | Short | Effect |
| --- | --- | --- |
| `--dry` | `-n` | Report the resolved version and the promotion that would happen; write nothing, and skip the clean-tree check. |
| `--allow-dirty` | — | Skip the clean-working-tree refusal. |
| `--allow-empty-changelog` | — | Release despite an empty `[Unreleased]`. Promotion still runs; a malformed changelog is still refused. |
| `--allow-semver` | — | Release a patch despite a shrinking public export surface. |

### Version resolution

#### `resolveVersion(options, deps?)`

Computes the next version from git state and returns a `VersionResult`. Throws `ReleaseError` on
invalid or non-monotonic versions.

| Parameter | Type | Description |
| --- | --- | --- |
| `options.explicit` | `string?` | Forces a specific version; must be greater than the latest tag. |
| `options.cwd` | `string` | Repository working directory. |
| `options.tagPrefix` | `string` | Tag prefix used to strip and match tags. |
| `deps` | `VersionDeps?` | Optional git/pkg overrides for testing. |

`VersionResult`:

| Field | Type | Description |
| --- | --- | --- |
| `version` | `string` | Resolved version string (no prefix), e.g. `"1.3.0"`. |
| `reason` | `"explicit" \| "auto-patch" \| "auto-minor" \| "auto-major" \| "first-release" \| "in-sync"` | How the version was derived. |
| `previous` | `string \| null` | The latest tag, or `null` for a first release. |
| `evidence` | `BumpEvidence?` | Set only on an `auto-*` reason — no other path reads commits. |

`BumpEvidence` is `{ commit?: { sha: string; subject: string }; commitCount: number }`. `commit` is
absent for a patch, which no commit asks for.

Resolution rules:

- **No tags** → `0.0.1` (`first-release`).
- **Explicit version** → used as-is after a greater-than check (`explicit`).
- **No commits since the latest tag** → returns the current version; throws `version-mismatch` if
  `package.json` and the tag disagree (`in-sync`).
- **Commits since the latest tag** → bumps from the tag by the highest bump any subject in the range
  asks for (`auto-major` / `auto-minor` / `auto-patch`).

A latest tag that cannot be parsed is fatal rather than skipped: the not-greater guard reads
`prev !== null && …`, so an unparseable tag would make it vacuous and wave a downgrade through.

### The export-surface guard

Before an `auto-patch` release, the command compares the `<specifier>#<exportName>` set the previous
tag published against the working tree's. Any entry that has gone refuses the release, naming each
one, and pointing at the three ways forward: prefix a commit `minor:`, pass an explicit version, or
pass `--allow-semver`. The check runs only on `auto-patch` with a previous tag — an explicit version
and a `minor:`/`major:` bump have already said what they are.

### Errors

#### `ReleaseError`

Extends `Error` with a discriminated `kind` field for programmatic handling.

| `kind` | Raised when |
| --- | --- |
| `invalid-version` | A version string cannot be parsed, or `package.json` has no `version`. |
| `version-not-greater` | An explicit version is not greater than the latest tag. |
| `version-mismatch` | `package.json` and the latest tag disagree with no new commits. |
| `git-error` | A `git` command exits non-zero, including a tag that could not be created after the commit landed. |
| `pkg-update` | Reading or writing `package.json` or the changelog fails. |
| `manifest-malformed` | A `package.json` the surface guard reads cannot be parsed. |
| `working-tree-dirty` | The working tree has uncommitted changes and `--allow-dirty` was not passed. |
| `changelog-empty` | `[Unreleased]` carries no entry while commits exist since the tag, and `--allow-empty-changelog` was not passed. |
| `changelog-malformed` | The changelog does not parse, or cannot be promoted. No flag overrides this. |
| `surface-shrink` | A patch release drops a public export and `--allow-semver` was not passed. |

A tag that fails to create after the commit landed says so in the message — the commit is named as
unpushed and untagged, because that is the state the reader has to clean up.

---

## See also

- [`@y-core/forge/tooling/gate`](../gate/README.md) — the changelog parser, the semver primitives,
  and the barrel parser this namespace builds on.
- [`@y-core/forge/tooling/cli`](../cli/README.md) — the command framework `createReleaseCommand`
  returns a `Command` of.
- [`BUILD_TOOLING.md`](../../../docs/BUILD_TOOLING.md) §2a, §2b, §2c, §2d and §2e — the release
  workflow, the compared surface, the git and manifest internals, the unreleased contract, and the
  changelog gate invariants.
