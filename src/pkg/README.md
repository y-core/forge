# `@y-core/forge/pkg`

Release automation utilities for `package.json`-based projects: semantic-version
parsing, git tag/commit inspection, and a ready-made `release` CLI command that
bumps the version, updates `package.json`, commits, and tags — driven by commit
message conventions.

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
  from the latest git tag plus commit history. The most recent commit message
  drives the bump: `major:` → major, `minor:` → minor, anything else → patch.
- **Drop-in `release` command** (`createReleaseCommand`) — a complete CLI command
  that checks the working tree, resolves the next version, updates `package.json`,
  commits the change, and creates the git tag. Supports `--dry`/`-n` and
  `--allow-dirty`.
- **SemVer primitives** — parse, format, compare, and bump strict
  `major.minor.patch` versions (leading zeros and `v` prefixes handled).
- **Git helpers** — list tags, list commits since a tag, read the last commit
  message, create tags, and check whether the working tree is clean.
- **`package.json` IO** — read and write the `version` field while preserving the
  file's existing indentation.
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
```

The command derives the bump from the most recent commit message:

```bash
git commit -m "minor: add export panel"   # → next minor release
git commit -m "major: rewrite kernel ABI" # → next major release
git commit -m "fix snapping tolerance"    # → next patch release (default)
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
optional positional argument (an explicit version) plus the `--dry`/`-n` and
`--allow-dirty` flags.

| Parameter | Type | Description |
|---|---|---|
| `config` | `ReleaseCommandConfig` | Project configuration (see below). |
| `deps` | `ReleaseDeps` | Optional dependency overrides for testing; defaults to the real git/pkg/version functions. |

`ReleaseCommandConfig`:

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | — | Repository working directory. Required. |
| `tagPrefix` | `string` | `"v"` | Prefix for git tags (e.g. `v1.2.3`). |
| `stageFiles` | `string[]` | `["package.json"]` | Files staged into the release commit. |

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
- **Commits since the latest tag** → bumps from the tag based on the last commit
  message prefix (`auto-major` / `auto-minor` / `auto-patch`).

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

### `package.json` IO

| Function | Signature | Description |
|---|---|---|
| `readPackageVersion` | `(cwd: string) => string` | Reads the `version` field from `<cwd>/package.json`. Throws `ReleaseError` (`kind: "invalid-version"`) when missing or unreadable. |
| `updatePackageVersion` | `(version: string, cwd: string) => void` | Writes `version` into `<cwd>/package.json`, preserving existing indentation. Throws `ReleaseError` (`kind: "pkg-update"`) on IO failure. |

### Errors

#### `ReleaseError`

Extends `Error` with a discriminated `kind` field for programmatic handling.

| `kind` | Raised when |
|---|---|
| `invalid-version` | A version string cannot be parsed, or `package.json` has no `version`. |
| `version-not-greater` | An explicit version is not greater than the latest tag. |
| `version-mismatch` | `package.json` and the latest tag disagree with no new commits. |
| `git-error` | A `git` command exits non-zero. |
| `pkg-update` | Reading or writing `package.json` fails during an update. |
