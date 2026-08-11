# `@y-core/forge/pkg`

Release automation utilities for `package.json`-based projects: semantic-version
parsing, git tag/commit inspection, Keep a Changelog promotion, and a ready-made
`release` CLI command that bumps the version, updates `package.json`, promotes
`CHANGELOG.md`, commits, and tags — driven by commit message conventions.

> **Node.js / Bun only.** This namespace shells out to `git` via
> `node:child_process` and reads/writes files via `node:fs`. It is intended for
> release scripts and local tooling. **Do not import it into Cloudflare Workers
> or any client bundle** — it depends on Node built-ins that do not exist there.

```ts
import { createReleaseCommand, resolveVersion } from "@y-core/forge/pkg";
```

---

## Features

- **Automatic version resolution** (`resolveVersion`) — derives the next version
  from the latest git tag plus commit history. Every commit subject in
  `<latest-tag>..HEAD` is scanned and the highest bump wins: `major:` → major,
  `minor:` → minor, otherwise patch.
- **Drop-in `release` command** (`createReleaseCommand`) — a complete CLI command
  that checks the working tree, resolves the next version, promotes the changelog,
  updates `package.json`, commits the change, and creates the git tag. Supports
  `--dry`/`-n`, `--allow-dirty`, and `--allow-empty-changelog`.
- **Changelog promotion** (`parseChangelog`, `promoteUnreleased`,
  `formatReleaseDate`) — a zero-dependency Keep a Changelog parser and transform.
  `[Unreleased]` becomes a dated version section, a fresh empty `[Unreleased]`
  takes its place, and a compare-link definition is appended.
- **SemVer primitives** — parse, format, compare, and bump strict
  `major.minor.patch` versions (leading zeros and `v` prefixes handled).
- **Git helpers** — list tags, list commits since a tag, read the last commit
  message, create tags, and check whether the working tree is clean.
- **`package.json` and changelog IO** — read and write the `version` field while
  preserving the file's existing indentation, read the `repository` URL, and read
  and write the changelog verbatim.
- **Structured errors** (`ReleaseError`) — every failure carries a discriminated
  `kind` so callers can react programmatically.

---

## Usage

### Wire up a `release` command

`createReleaseCommand` returns a forge `Command` you can register with your CLI.
It only needs the project's working directory.

```ts
import { createReleaseCommand } from "@y-core/forge/pkg";
import { runCli } from "@y-core/forge/cli";

const release = createReleaseCommand({ cwd: process.cwd() });

runCli({ commands: { release } }, process.argv.slice(2));
```

Running the command:

```bash
# Auto-resolve the next version from git history, then commit + tag
node ./scripts/release.js release

# Preview without writing anything
node ./scripts/release.js release --dry

# Force an explicit version (must be greater than the latest tag)
node ./scripts/release.js release 2.1.0

# Bypass the clean-working-tree check
node ./scripts/release.js release --allow-dirty

# Release even though [Unreleased] carries no entry
node ./scripts/release.js release --allow-empty-changelog
```

The command derives the bump from the commit subjects since the latest tag, taking
the highest one it finds:

```bash
git commit -m "minor: add export panel"   # → next minor release
git commit -m "major: rewrite kernel ABI" # → next major release
git commit -m "fix snapping tolerance"    # → next patch release (default)
```

A range holding both `major:` and `fix …` releases as a **major** — the scan reads
every subject in the range, not just the tip.

### Promote the changelog on release

Given a `CHANGELOG.md` whose `[Unreleased]` section carries entries, the command
retitles that heading with the resolved version and today's local date, inserts a
fresh empty `[Unreleased]` above it, and appends a compare-link definition built
from `package.json`'s `repository` URL. Both files land in one commit when the
changelog is staged:

```ts
createReleaseCommand({ cwd, stageFiles: ["package.json", "CHANGELOG.md"] });
```

`changelogFile` defaults to `"CHANGELOG.md"`; a project without one releases
unchanged — the promotion step is skipped, not failed.

The command refuses to release when `[Unreleased]` is empty (whitespace only,
`---` separators only, or just the `_Nothing yet._` placeholder) while commits
exist since the tag. `--allow-empty-changelog` overrides that, and still promotes —
the released section ships carrying `_Nothing yet._`. It does **not** override a
changelog that fails to parse; that refusal has no escape.

### Transform a changelog directly

```ts
import { formatReleaseDate, parseChangelog, promoteUnreleased, writeChangelog } from "@y-core/forge/pkg";

const parsed = parseChangelog(source);
if (parsed.ok) {
  console.log(parsed.unreleased.empty);        // false
  console.log(parsed.versions[0]?.version);    // "0.0.82"
}

const result = promoteUnreleased(source, {
  version: "0.0.83",
  date: formatReleaseDate(new Date()),
  tagPrefix: "v",
  compareUrlBase: "https://github.com/y-core/forge",
});
if (result.ok) writeChangelog(cwd, "CHANGELOG.md", result.source);
```

### Resolve a version programmatically

```ts
import { resolveVersion } from "@y-core/forge/pkg";

const result = resolveVersion({ cwd: process.cwd(), tagPrefix: "v" });
console.log(result.version);  // e.g. "1.3.0"
console.log(result.reason);   // "auto-minor"
console.log(result.previous); // "v1.2.4" | null
```

### Work with versions directly

```ts
import { bumpSemVer, formatSemVer, parseSemVer } from "@y-core/forge/pkg";

const v = parseSemVer("v1.2.3");     // { major: 1, minor: 2, patch: 3 }
const next = bumpSemVer(v!, "minor"); // { major: 1, minor: 3, patch: 0 }
formatSemVer(next);                   // "1.3.0"
```

### Handle failures by `kind`

```ts
import { ReleaseError } from "@y-core/forge/pkg";

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

#### `createReleaseCommand(config, deps?)`

Builds the `release` CLI `Command`. The returned command supports a single
optional positional argument (an explicit version) plus the `--dry`/`-n`,
`--allow-dirty` and `--allow-empty-changelog` flags.

| Parameter | Type | Description |
|---|---|---|
| `config` | `ReleaseCommandConfig` | Project configuration (see below). |
| `deps` | `ReleaseDeps` | Optional dependency overrides for testing; defaults to the real git/pkg/version functions. |

`ReleaseCommandConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository working directory. Required. |
| `tagPrefix` | `string` | `"v"` | Prefix for git tags (e.g. `v1.2.3`). |
| `stageFiles` | `string[]` | `["package.json"]` | Files staged into the release commit. Add the changelog to keep the bump, the promotion and the tag in one commit. |
| `changelogFile` | `string` | `"CHANGELOG.md"` | Changelog to promote, relative to `cwd`. A missing file skips promotion. |

Flags:

| Flag | Short | Effect |
|---|---|---|
| `--dry` | `-n` | Report the resolved version and the promotion that would happen; write nothing, and skip the clean-tree check. |
| `--allow-dirty` | — | Skip the clean-working-tree refusal. |
| `--allow-empty-changelog` | — | Release despite an empty `[Unreleased]`. Promotion still runs; a malformed changelog is still refused. |

### Version resolution

#### `resolveVersion(options, deps?)`

Computes the next version from git state and returns a `VersionResult`. Throws
`ReleaseError` on invalid or non-monotonic versions.

| Parameter | Type | Description |
|---|---|---|
| `options.explicit` | `string?` | Forces a specific version; must be greater than the latest tag. |
| `options.cwd` | `string` | Repository working directory. |
| `options.tagPrefix` | `string` | Tag prefix used to strip/match tags. |
| `deps` | `VersionDeps?` | Optional git/pkg overrides for testing. |

`VersionResult`:

| Field | Type | Description |
|---|---|---|
| `version` | `string` | Resolved version string (no prefix), e.g. `"1.3.0"`. |
| `reason` | `"explicit" \| "auto-patch" \| "auto-minor" \| "auto-major" \| "first-release" \| "in-sync"` | How the version was derived. |
| `previous` | `string \| null` | The latest tag, or `null` for a first release. |

Resolution rules:

- **No tags** → `0.0.1` (`first-release`).
- **Explicit version** → used as-is after a greater-than check (`explicit`).
- **No commits since the latest tag** → returns the current version; throws
  `version-mismatch` if `package.json` and the tag disagree (`in-sync`).
- **Commits since the latest tag** → bumps from the tag by the highest bump any
  subject in the range asks for (`auto-major` / `auto-minor` / `auto-patch`).

### SemVer

| Function | Signature | Description |
|---|---|---|
| `parseSemVer` | `(str: string) => SemVer \| null` | Parses `major.minor.patch` (optional `v` prefix). Rejects leading zeros, negatives, and malformed input by returning `null`. |
| `formatSemVer` | `(v: SemVer) => string` | Formats a `SemVer` back to `"major.minor.patch"`. |
| `compareSemVer` | `(a: SemVer, b: SemVer) => -1 \| 0 \| 1` | Orders two versions. |
| `isGreaterThan` | `(next: SemVer, prev: SemVer) => boolean` | `true` when `next` is strictly greater than `prev`. |
| `bumpSemVer` | `(v: SemVer, kind: BumpKind) => SemVer` | Returns a new version bumped by `kind`, zeroing lower components. |

`SemVer` is `{ major: number; minor: number; patch: number }`.
`BumpKind` is `"major" | "minor" | "patch"`.

### Changelog

Pure string transforms — no filesystem, no clock, no git. Failures are **returned,
not thrown**, so a caller can report every malformed heading in one pass.

| Function | Signature | Description |
|---|---|---|
| `parseChangelog` | `(source: string) => ChangelogParse` | Reads the structure without changing it. |
| `promoteUnreleased` | `(source, opts: PromoteOptions) => { ok: true; source: string } \| { ok: false; errors: readonly string[] }` | Retitles `[Unreleased]`, inserts a fresh empty one above it, and appends the compare-link definition. |
| `formatReleaseDate` | `(date: Date) => string` | `YYYY-MM-DD` in the **local** calendar — not UTC. |

`PromoteOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `version` | `string` | — | Version being promoted to — bare semver, no leading `v`. |
| `date` | `string` | — | Already-formatted release date. |
| `tagPrefix` | `string` | `"v"` | Prefix used in the compare URL's tag names. |
| `compareUrlBase` | `string?` | — | Repository base URL. Omit to skip the link definition entirely. |

`ChangelogParse` is `{ ok: true; unreleased: UnreleasedSection; versions: readonly VersionHeading[]; linkRefs: readonly string[] }`
or `{ ok: false; errors: readonly string[] }`.

| Type | Shape |
|---|---|
| `VersionHeading` | `{ version: string; date: string; line: number }` — bare semver, ISO date, zero-indexed line. |
| `UnreleasedSection` | `{ line: number; body: readonly string[]; empty: boolean }` — verbatim body up to the next `## ` heading. |

A parse fails on: no `[Unreleased]` section, more than one, an entry heading above
it, an entry heading not matching `[X.Y.Z]` followed by an **em dash** (U+2014) and
an ISO date, or a date whose shape is right but whose calendar day does not exist.
`empty` is `true` when the body holds only blank lines, `---` separators, or the
`_Nothing yet._` placeholder.

`promoteUnreleased` leaves every byte below the insertion point untouched, so a
document with no trailing newline round-trips exactly. The compare link is omitted
when `compareUrlBase` is absent or there is no earlier released version.

### Git helpers

Each helper takes the repository `cwd` as its first argument and throws
`ReleaseError` (`kind: "git-error"`) when the underlying `git` invocation fails.

| Function | Signature | Description |
|---|---|---|
| `gitExec` | `(args: string[], cwd: string) => string` | Runs `git <args>` and returns trimmed stdout. |
| `isWorkingTreeClean` | `(cwd: string) => boolean` | `true` when `git status --porcelain` is empty. |
| `getLatestTag` | `(cwd: string, prefix: string) => string \| null` | Highest version tag matching `prefix*`, or `null`. |
| `getCommitsSinceTag` | `(cwd: string, tag: string) => string[]` | One-line commit summaries in `tag..HEAD`. |
| `getLastCommitMessage` | `(cwd: string) => string` | Subject (`%s`) of the most recent commit. |
| `tagExists` | `(cwd: string, tag: string) => boolean` | `true` when `tag` already exists. |
| `createTag` | `(cwd: string, tag: string) => void` | Creates a lightweight git tag. |

### File IO

| Function | Signature | Description |
|---|---|---|
| `readPackageVersion` | `(cwd: string) => string` | Reads the `version` field from `<cwd>/package.json`. Throws `ReleaseError` (`kind: "invalid-version"`) when missing or unreadable. |
| `updatePackageVersion` | `(version: string, cwd: string) => void` | Writes `version` into `<cwd>/package.json`, preserving existing indentation. Throws `ReleaseError` (`kind: "pkg-update"`) on IO failure. |
| `readRepositoryUrl` | `(cwd: string) => string \| null` | The `repository` URL with any `git+` prefix and `.git` suffix stripped, or `null` when the field is absent or unusable. |
| `readChangelog` | `(cwd: string, file: string) => string \| null` | Reads `<cwd>/<file>`, or `null` when it does not exist. Throws `ReleaseError` (`kind: "pkg-update"`) on a genuine read failure. |
| `writeChangelog` | `(cwd: string, file: string, source: string) => void` | Writes `source` verbatim — no trailing-newline normalisation. Throws `ReleaseError` (`kind: "pkg-update"`) on IO failure. |

### Errors

#### `ReleaseError`

Extends `Error` with a discriminated `kind` field for programmatic handling.

| `kind` | Raised when |
|---|---|
| `invalid-version` | A version string cannot be parsed, or `package.json` has no `version`. |
| `version-not-greater` | An explicit version is not greater than the latest tag. |
| `version-mismatch` | `package.json` and the latest tag disagree with no new commits. |
| `git-error` | A `git` command exits non-zero. |
| `pkg-update` | Reading or writing `package.json` or the changelog fails. |
| `working-tree-dirty` | The working tree has uncommitted changes and `--allow-dirty` was not passed. |
| `changelog-empty` | `[Unreleased]` carries no entry while commits exist since the tag, and `--allow-empty-changelog` was not passed. |
| `changelog-malformed` | The changelog does not parse. No flag overrides this. |
