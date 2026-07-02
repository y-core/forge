# `@y-core/forge/cli`

A small, dependency-free toolkit for building **typed, hierarchical command-line tools** in
TypeScript — the framework behind forge's own build and tooling scripts. Declare commands with typed
flags, compose them into a sub-command tree, and run them with a single `execute` call that handles
parsing, validation, `--help`, and error reporting. Bundled alongside it are node-only **process and
PATH primitives** (`run`, `requireTools`, `hasTool`, `insertPath`) and a `[scope]`-prefixed logger
for script output.

```ts
import {
  createCommand,
  addCommand,
  execute,
  run,
  requireTools,
  scopeLogger,
} from "@y-core/forge/cli";
```

> **Runtime:** this namespace is **node-only**. `execute` reads `node:process`; `proc.ts` uses
> `node:child_process`, `node:fs`, and `node:path`. It is intended for build scripts and CLIs, not
> the browser or Worker bundle.

---

## Features

- **Typed flags** — declare a flag map once; `ResolvedFlags<F>` infers each flag's runtime type. A
  `boolean` flag resolves to `boolean`; a `string` flag with a `default` or `required: true` resolves
  to `string`; every other `string` flag resolves to `string | undefined`. No casts in your handler.
- **Hierarchical commands** — compose commands into a tree with `addCommand`. `execute` walks the
  tree by matching leading non-flag tokens to sub-command names, then dispatches to the deepest match.
- **Persistent flags** — a flag marked `persistent: true` is inherited by every descendant command,
  letting a root command define global flags (e.g. `--verbose`) once.
- **Argument validation** — declare an `ArgValidator` (`exact`, `min`, `max`, `range`, or `none`) and
  `execute` enforces the positional-argument count before invoking your handler.
- **Auto-generated help** — `formatHelp` and `formatUsage` render Cobra-style help text; `--help` /
  `-h` is handled for free, and group commands invoked without a sub-command print their help.
- **Structured errors** — `CliError` carries a discriminated `kind`; `execute` formats it to stderr
  and exits non-zero. User-facing messages never leak stack traces.
- **Process primitives** — `run` spawns child processes with inherited stdio; `requireTools` asserts
  external tools are on `PATH` with install hints; `insertPath` prepends a directory to `PATH`.
- **Injectable IO** — `execute` accepts a `CliIO` ( `stdout` / `stderr` / `exit` ) so tests can drive
  a command and capture its output without touching the real console or process.

---

## Usage

A complete two-level CLI: a root `build` command with a persistent `--verbose` flag and a `wasm`
sub-command that requires external tools and takes a typed `--profile` flag.

```ts
import {
  createCommand,
  addCommand,
  execute,
  run,
  requireTools,
  scopeLogger,
} from "@y-core/forge/cli";

// 1. Root command — defines a persistent flag shared by all sub-commands.
const root = createCommand({
  name: "forge-build",
  description: "Build the forge project",
  flags: {
    verbose: { type: "boolean", short: "v", description: "Verbose output", persistent: true },
  },
});

// 2. Sub-command — its own typed flags plus the inherited `verbose`.
const wasm = createCommand({
  name: "wasm",
  description: "Compile the Rust kernel to WASM",
  args: { kind: "none" },
  flags: {
    profile: {
      type: "string",
      short: "p",
      description: "Cargo profile",
      default: "release",
    },
  },
  run: async (args, flags) => {
    // flags.profile : string     (has a default → never undefined)
    // flags.verbose : boolean    (inherited persistent boolean flag)
    const log = scopeLogger("wasm");

    requireTools({
      cargo: "install Rust: https://rustup.rs",
      "wasm-opt": "npm i -g binaryen",
    });

    log.info(`building with profile=${flags.profile}`);
    run("cargo", ["build", "--profile", flags.profile]);
    log.done("build complete");
  },
});

// 3. Compose and run.
addCommand(root, wasm);
await execute(root); // reads process.argv.slice(2)
```

Running it:

```bash
forge-build wasm --profile dev --verbose
forge-build wasm --help        # prints sub-command help
forge-build                    # group command → prints root help
```

### Testing a command

Pass an explicit `argv` and a fake `CliIO` to capture output without spawning the real process:

```ts
import { execute, type CliIO } from "@y-core/forge/cli";

const out: string[] = [];
const err: string[] = [];
const io: CliIO = {
  stdout: (m) => out.push(m),
  stderr: (m) => err.push(m),
  exit: ((code: number) => {
    throw new Error(`exit ${code}`);
  }) as CliIO["exit"],
};

await execute(root, ["wasm", "--profile", "dev"], io);
```

---

## Core Components & APIs

### Defining commands

#### `createCommand(config)`

Creates a command definition from a `CommandDefinition`. The generic flag type `F` is inferred from
`config.flags`, so the `flags` argument passed to `run` is fully typed.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Command name (matched against argv tokens). **Required.** |
| `description` | `string` | One-line description shown in help. Defaults to `""`. |
| `flags` | `FlagDefs` | Map of long-flag name → `FlagDef`. Defaults to `{}`. |
| `args` | `ArgValidator` | Positional-argument count rule. Defaults to `{ kind: "none" }`. |
| `run` | `(args, flags) => void \| Promise<void>` | Handler invoked when this command is selected. |

Returns a `Command<F>` with an empty `commands` array, ready to receive sub-commands via
`addCommand`.

#### `addCommand(parent, child)`

Attaches `child` as a sub-command of `parent`: sets `child.parent` and pushes it onto
`parent.commands`. Throws `Error: Duplicate command name: "<name>"` if a sibling with the same name
already exists. Returns `void` — it mutates `parent`.

```ts
const root = createCommand({ name: "tool" });
addCommand(root, createCommand({ name: "build", run: () => {} }));
addCommand(root, createCommand({ name: "test", run: () => {} }));
```

---

### Running a command

#### `execute(root, argv?, io?)`

The main entry point. Resolves the target command and dispatches to its `run` handler. Returns
`Promise<void>`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `root` | `CommandBase` | — | The root of the command tree. |
| `argv` | `string[]` | `process.argv.slice(2)` | Raw argument tokens. |
| `io` | `CliIO` | console-backed IO | Injectable output/exit sink. |

Behavior, in order:

1. **Descend the tree** — consumes leading non-flag tokens, matching each to a sub-command name,
   stopping at the first token that starts with `-` or matches no sub-command.
2. **Help** — if the remaining tokens include `--help` or `-h`, prints `formatHelp(current)` to
   stdout and returns.
3. **Parse** — collects the effective flag set (own + inherited persistent) via `collectFlags`, then
   parses the remaining tokens with `parseArgs`.
4. **Validate args** — enforces the command's `ArgValidator`; a mismatch throws
   `CliError("invalid-args", …)`.
5. **Dispatch** — calls `run(args, flags)` (awaited). A command with no `run` but with sub-commands
   prints its help; a leaf command with no `run` throws `CliError("missing-command", …)`.
6. **Errors** — a `CliError` is formatted via `formatError` to stderr; any other `Error` prints
   `Error: <message>`; then `io.exit(1)` is called.

---

### Parsing

#### `parseArgs(argv, flagDefs)`

Parses raw tokens against a flag map, returning `{ args, flags }` where `args` is the positional
array and `flags` is a typed `ResolvedFlags<F>`. Used internally by `execute`, exported for direct
use and testing.

Parsing rules:

| Form | Meaning |
|---|---|
| `--name value`, `-n value` | String flag with a separate value token. |
| `--name=value`, `-n=value` | String flag with an inline value. |
| `--flag`, `-f` | Boolean flag set to `true`. |
| `--flag=false`, `--flag=0` | Boolean flag set to `false`; any other inline value is `true`. |
| `--` | Stops flag parsing; all later tokens are positionals. |
| `-` | Treated as a positional (e.g. stdin). |

After parsing, unset boolean flags default to `false`, unset string flags fall back to their
`default`, and a missing `required` string flag throws `CliError("missing-value", …)`. An unknown
flag throws `CliError("unknown-flag", …)`; a string flag with no value throws
`CliError("missing-value", …)`.

#### `collectFlags(command)`

Walks the command's ancestor chain and returns the effective `FlagDefs`: the command's own flags
plus any ancestor flag marked `persistent`. Child definitions override an inherited flag of the same
name.

---

### Process & tool primitives

#### `run(cmd, args, opts?)`

Spawns `cmd args` synchronously with **inherited** stdio (child output goes straight to the parent's
terminal). Returns the exit code (`0`) on success; throws
`` Error: `<cmd> <args>` failed (exit <code>) `` on a non-zero exit.

| Parameter | Type | Description |
|---|---|---|
| `cmd` | `string` | Executable to run. |
| `args` | `string[]` | Arguments. |
| `opts.cwd` | `string` | Optional working directory; defaults to `process.cwd()`. |

```ts
run("cargo", ["build", "--release"]);
run("git", ["status"], { cwd: "/src/forge" });
```

#### `requireTools(tools)`

Asserts that every tool in a `ToolHints` map is present on `PATH`, in insertion order. Throws on the
first missing tool with `Error: <cmd> not found — <hint>`, surfacing the install hint verbatim so
`execute` reports it on stderr and exits 1.

```ts
requireTools({
  "wasm-snip": "cargo install wasm-snip",
  "wasm-opt": "npm i -g binaryen",
});
```

#### `hasTool(cmd)`

Returns `true` when `cmd --version` exits 0 — i.e. the tool is present and runnable. Non-throwing;
use it for optional-tool branching.

#### `insertPath(dir)`

Idempotently prepends `dir` to `process.env.PATH` for subsequent child processes. A no-op when `dir`
is empty, does not exist on disk, or is already on `PATH`.

```ts
insertPath(`${process.cwd()}/node_modules/.bin`);
```

---

### Logging

#### `scopeLogger(scope)`

Returns a `ScopedLogger` whose every line is prefixed with `[scope]`. `info` and `done` write to
stdout; `warn` writes to stderr.

| Method | Stream | Output |
|---|---|---|
| `info(msg)` | stdout | `[scope] msg` — progress line |
| `warn(msg)` | stderr | `[scope] msg` — warning line |
| `done(msg)` | stdout | `[scope] msg` — completion line |

```ts
const log = scopeLogger("build");
log.info("compiling…");
log.warn("optional tool missing, skipping");
log.done("done");
```

---

### Help & usage

#### `formatHelp(command)`

Renders the full help text for a command: description, usage line, an alphabetised
**Available Commands** list (when it has sub-commands), and a **Flags** section that always appends
`--help`. Required string flags are marked `(required)`.

#### `formatUsage(command)`

Renders just the usage line, e.g. `Usage:\n  tool wasm [flags]`. Appends `[command]` when the
command has sub-commands and `[args]` when its `ArgValidator` is not `{ kind: "none" }`.

---

### Errors

#### `class CliError extends Error`

A structured CLI error carrying a discriminated `kind`. Thrown by the framework (and throwable from
your own handlers) so `execute` can report it cleanly and exit non-zero.

```ts
new CliError(kind: CliErrorKind, message: string);
```

`CliErrorKind` is one of:

| Kind | Raised when |
|---|---|
| `unknown-flag` | An unrecognised flag token was passed. |
| `missing-value` | A string flag is missing its value, or a `required` flag was omitted. |
| `invalid-args` | The positional-argument count violates the command's `ArgValidator`. |
| `missing-command` | A leaf command has no `run` handler. |

#### `formatError(err)`

Formats a `CliError` for display as `Error: <message>`.

---

### Types

| Type | Description |
|---|---|
| `CommandDefinition<F>` | Input to `createCommand`: `name`, optional `description`, `flags`, `args`, `run`. |
| `Command<F>` | A command definition with a typed `run`; extends `CommandBase`. |
| `CommandBase` | Tree-structural command shape (`name`, `description`, `flags`, `args`, `parent`, `commands`) without the typed handler — used for parent/child links. |
| `FlagDef` | A flag definition: `BooleanFlagDef \| StringFlagDef`. |
| `BooleanFlagDef` | `{ type: "boolean"; short?; description?; persistent? }`. |
| `StringFlagDef` | `BooleanFlagDef` fields plus `default?` and `required?`. |
| `FlagDefs` | `Record<string, FlagDef>` — the long-flag name is the record key. |
| `ResolvedFlags<F>` | Maps a `FlagDefs` to its inferred runtime flag-value shape. |
| `ArgValidator` | Positional-count rule: `none`, `exact`, `min`, `max`, or `range`. |
| `ToolHints` | `Record<string, string>` — tool command → install hint for `requireTools`. |
| `ScopedLogger` | `{ info; warn; done }` — the `scopeLogger` return type. |
| `CliIO` | `{ stdout; stderr; exit }` — injectable IO for `execute`. |
| `CliErrorKind` | Discriminant union of `CliError.kind` values. |

> **Note on flag naming:** a flag's **long** name is its key in the `FlagDefs` record (e.g. `profile`
> → `--profile`); the optional **short** alias is the `short` field (e.g. `"p"` → `-p`). There is no
> separate `long` field on `FlagDef`.
