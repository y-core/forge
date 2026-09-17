---
title: The CLI Toolkit
description: "Typed, hierarchical commands with declared flags, plus the process, PATH, JSONC-editing and scoped-logging primitives forge's own scripts run on."
audience: internal
---

# `@y-core/forge/tooling/cli`

A command-line tool here is **data, not registration**: you build a tree of command values, hand the root to `execute`, and it does the parsing,
the `--help`, the argument validation and the error reporting. Flags are declared once in a typed record, so a handler reads `flags.profile` as a
`string` with no cast and no runtime shape check.

Reach for this namespace when you are writing a build script, a `bin` entry, or anything else that has to read a terminal's arguments.

```ts
import { addCommand, createCommand, execute, requireTools, run, scopeLogger } from "@y-core/forge/tooling/cli";
```

> **Node.js / Bun only.** `execute` reads `node:process`, and the process primitives use `node:child_process`, `node:fs` and `node:path`. **Do not
> import this namespace into a Cloudflare Worker or a client bundle.**

> The decisions behind the surface are [`BUILD_TOOLING.md`][bt] §1's: commands as values (§1a), the typed flag record and why number parsing is
> absent (§1b), the kind-not-exit-code error contract (§1c), and why `CommandBase` and `Command` stay two interfaces (§1d).

---

## Getting started

A root command, a sub-command, and one `execute` call. The root's `persistent` flag is inherited by every descendant, which is how a tool declares
`--verbose` once.

```ts
import { addCommand, createCommand, execute, requireTools, run, scopeLogger } from "@y-core/forge/tooling/cli";

const root = createCommand({
  name: "forge-build",
  description: "Build the forge project",
  flags: { verbose: { type: "boolean", short: "v", description: "Verbose output", persistent: true } },
});

const wasm = createCommand({
  name: "wasm",
  description: "Compile the Rust kernel to WASM",
  args: { kind: "none" },
  flags: { profile: { type: "string", short: "p", description: "Cargo profile", default: "release" } },
  run: async (args, flags, ctx) => {
    // flags.profile : string   (has a default → never undefined)
    // flags.verbose : boolean  (inherited persistent boolean flag)
    const log = scopeLogger("wasm");
    requireTools({ cargo: "install Rust — https://rustup.rs", "wasm-opt": "npm i -g binaryen" });
    log.info(`building with profile=${flags.profile}`);
    run("cargo", ["build", "--profile", flags.profile]);
    log.done("build complete");
  },
});

addCommand(root, wasm);
await execute(root); // reads process.argv.slice(2)
```

```bash
forge-build wasm --profile dev --verbose
forge-build wasm --help        # sub-command help
forge-build                    # a group command with no handler prints its own help
forge-build wsam               # Unknown command "wsam" for "forge-build". Did you mean "wasm"?
```

`addCommand(parent, child)` mutates `parent` and throws on a duplicate sibling name, so a tree cannot hold two commands answering to one word.
`execute` walks the tree by matching leading non-flag tokens, stops at the first token starting with `-` or matching nothing, and dispatches to the
deepest match. A leaf with no `run` is a `missing-command` error; a branch with no `run` prints its help.

The third handler argument is the **context**: `ctx.io` (the `stdout`, `stderr` and `exit` sink), `ctx.out` and `ctx.err` (stylers resolved
separately for each stream, so `tool > log.txt` stays plain on the file and coloured on the terminal), and `ctx.width` (columns available on
stdout). It is optional — a handler that only spawns things can ignore it.

---

## Declaring flags

A flag's **long name is its key** in the record; `short` is the optional one-letter alias. There is no `long` field. The type you get back is
inferred, so the shape of the declaration is the whole contract:

| Declaration | `flags.x` resolves to |
| --- | --- |
| `{ type: "boolean" }` | `boolean` — `false` when the flag was not passed |
| `{ type: "string" }` | `string \| undefined` |
| `{ type: "string", default: "release" }` | `string` |
| `{ type: "string", required: true }` | `string` — a run that omits it throws `missing-value` |
| `{ type: "string", multiple: true as const }` | `string[]` — `[]` when the flag was not passed |
| `{ …, persistent: true }` | inherited by every descendant command |

On the command line, the forms the parser accepts:

| Form | Meaning |
| --- | --- |
| `--name value`, `-n value` | String flag taking the next element. A `-`-leading element is refused rather than swallowed. |
| `--name=value`, `-n=value` | String flag with an inline value. |
| `--flag`, `-f` | Boolean flag set to `true`. |
| `--flag=false`, `--flag=0` | Boolean flag set to `false`; any other inline value reads as `true`. |
| `-abc`, `-ab=cd` | A cluster, expanded to `-a -b -c` and `-a -b=cd`. |
| `--` | Stops flag parsing; every later element is a positional. |
| `-`, `-5` | Positionals — stdin by convention, and a negative number through the tokenizer's digit guard. |

**Repeating a flag that is not `multiple` is refused, not last-wins**, and the error quotes the values that would have been dropped. An unknown long
flag is refused with the nearest known name offered; an unknown short flag is refused without a guess, because with one-letter names every other
short is one edit away.

`parseArgs(argv, flagDefs)` and `collectFlags(command)` are published for driving the parser directly — `collectFlags` is what merges a command's
own flags with its ancestors' persistent ones, and `tokenize(argv)` is the classification pass beneath both, for a tool that wants tokens rather
than a resolved record.

---

## Validating positional arguments

Declare `args` and `execute` enforces the count before your handler runs, so a handler never opens with a length check:

```ts
createCommand({ name: "copy", args: { kind: "exact", count: 2 }, run: ([from, to]) => {} });
```

`{ kind: "none" }` (the default) takes no arguments at all, `exact` takes a `count`, `min` and `max` take a bound apiece, and `range` takes both. A
mismatch throws `invalid-args` naming the command, the rule and the count it got.

---

## Reporting a failure

Throw a `CliError` from a handler and `execute` prints `Error: <message>` to stderr and exits 1. **The `kind` is the classification, never an exit
code** — every failure is exit 1, and a user-facing message never carries a stack trace.

| Kind | Throw it when |
| --- | --- |
| `unknown-flag` | An unrecognised flag token was passed. |
| `missing-value` | A string flag is missing its value, or a `required` flag was omitted. |
| `invalid-args` | The positional count violates the command's rule, or a confirmation was declined. |
| `missing-command` | A leaf command has no handler, or a word matched no sub-command. |
| `external` | A command this tool ran — `wrangler`, say — failed, or answered in a shape it cannot read. |

The first four are thrown by the framework itself; `external` is yours. Any non-`CliError` throw still reaches stderr as `Error: <message>` and
still exits 1, so a thrown `Error` from a spawned tool is never silently swallowed.

---

## Running other programs

The primitive to reach for follows from what you intend to do with the outcome:

| You want to | Reach for |
| --- | --- |
| Run a tool, let its output reach the terminal, and abort the script on failure | `run(cmd, args, { cwd? })` |
| Run a tool, keep its output, and report the failure rather than abort | `capture(cmd, args, { cwd? })` |
| Assert several tools up front, each with its own install hint | `requireTools({ cmd: hint })` |
| Ask whether an executable is on `PATH` | `hasTool(cmd)` |
| Ask whether the thing a tool needs is actually there | `probeOk(cmd, args)` |
| Make `node_modules/.bin` resolvable to everything you spawn afterwards | `insertPath(dir)` |

```ts
const { code, output, ms } = capture("oxfmt", ["--check", "src/"], { cwd: repoRoot });
if (code !== 0) console.error(output.trimEnd().split("\n").slice(-20).join("\n"));
```

`capture` points both streams at **one** temp-file descriptor, so `output` matches what `cmd > log 2>&1` would have written; `stdio: "pipe"` returns
stdout and stderr as independent buffers whose relative order is lost. A spawn failure produces no child output, so its error message is appended to
`output` rather than leaving you with an empty capture, and `stdin` is ignored — a captured process must never block waiting on a terminal.

**Probe for the thing, not for the CLI that uses it.** `hasTool` answers `<cmd> --version`, which passes vacuously when the CLI is installed but the
browser, the service or the credential it needs is not. That case wants a command of its own, and `probeOk` is what runs one:

```ts
if (!probeOk("docker", ["compose", "ps", "--status=running", "--quiet"])) {
  throw new Error("no running container — docker compose up -d");
}
```

`requireTools` throws `<cmd> not found — <hint>` on the first missing tool, in insertion order, surfacing your hint verbatim so `execute` reports it
and exits 1. `insertPath` is idempotent and a no-op when the directory is empty, absent, or already on `PATH`.

---

## Writing to the terminal

`scopeLogger(scope)` prefixes every line with `[scope]`: `info` and `done` write to stdout, `warn` writes to stderr. That split is the whole point —
a progress line redirected to a log file leaves the warning on the terminal.

```ts
const log = scopeLogger("build");
log.info("compiling…");
log.warn("optional tool missing, skipping");
log.done("done");
```

Help text is rendered for you, but `formatHelp(command, { width, style })` and `formatUsage(command)` are published for a tool that wants to print
it somewhere else. Help lists the description, the usage line, an alphabetised **Available Commands** block, and a **Flags** block built from
`collectFlags` — inherited persistent flags included, because those are what actually work — always ending with `--help`. A required string flag is
marked `(required)` and one with a default is marked `(default: …)`.

**Pin `width` in a test.** It defaults to the terminal's columns, or 80 when there are none, so an exact-match assertion drifts with the window
unless the test states one.

---

## Confirming a destructive action

`confirm` asks `Continue? [y/N]` and returns a `Promise<void>`; a `n` answer throws `invalid-args`, so a declined run aborts rather than falling
through.

```ts
await confirm({
  verb: "reset",
  what: `${database} (local)`,
  consequence: "Its local state files are removed and nothing here restores them.",
  yes: flags.yes,
  cancelMessage: "Reset cancelled; the database is unchanged.",
});
```

You are choosing three pieces of a sentence: `verb` and `what` complete `About to <verb> <what>`, `detail` lists the things affected after a colon,
and `consequence` is the one line saying why it cannot be taken back. All three are reused verbatim in the refusal, so write them to read in both.

**A non-interactive run is refused, not assumed.** With no TTY and no `yes`, `confirm` throws naming the verb, the object and the consequence, and
says that `--yes` is how to mean it — so a CI job cannot silently take a destructive path. Pass `input`, `output`, `interactive` and `print` to
drive the prompt from a test.

---

## Finding the application root

`resolveAppRoot(explicit?)` returns the directory a consuming application lives in — the stated one if you pass it, otherwise everything before the
first `node_modules` segment of forge's own module path. It **throws** rather than guessing when forge is not installed under one, naming the fix.

```ts
const consumerRoot = resolveAppRoot();
// Inside forge itself there is no `node_modules` above this file, so the root is stated:
const forgeRoot = resolveAppRoot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
```

**Nothing here walks the disk looking for a marker file** — a root is stated or derived, never discovered ([`BUILD_TOOLING.md`][bt-2h] §2h).
`installedAppRoot()` is the derivation on its own, returning `undefined` instead of throwing, and `findAppRoot(modulePath)` is the pure string split
beneath both.

---

## Editing a jsonc file in place

A Worker config is JSONC — comments, trailing commas — and rewriting it through `JSON.parse`/`stringify` destroys both. `applyJsoncEdits` splices
the bytes each edit names and leaves every other byte alone.

```ts
import { applyJsoncEdits, countComments } from "@y-core/forge/tooling/cli";

const result = applyJsoncEdits(source, [{ path: ["vars", "LOG_LEVEL"], value: "debug" }]);
if (!result.ok) console.error(result.error.message); // carries the `path` that failed
```

A `path` is object keys and array indices, outermost first, and a missing key is **inserted** at the right indent rather than refused. Refusals
come back as [`Result`][result-readme] errors: writing a non-primitive, and overwriting a whole object or array with a single value — the message
renders the path as a reader would point at it, `kv_namespaces[0].id`. `parseJsoncTree` is the span tree beneath it, `stripJsonc` yields text
`JSON.parse` accepts, and `countComments` is what a tool reports when a write would have destroyed them.

---

## Testing a command

Pass an explicit `argv` and a fake `CliIO`, and nothing touches the real console or process:

```ts
import { execute, type CliIO } from "@y-core/forge/tooling/cli";

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

`exit` is typed `never`, so throwing from it is how a test observes a failure path without ending the run. For the layers beneath, `parseArgs`,
`collectFlags`, `tokenize`, `formatHelp` and `suggest` are all pure and assertable on their own.

---

## Gotchas

**`multiple: true` needs `as const` in a flag table.** Written `{ type: "string" as const, multiple: true }`, the field widens to `boolean`, the
conditional type stops matching `{ multiple: true }`, and the flag silently infers `string | undefined` instead of `string[]`.

**A flag with neither `default`, `required` nor `multiple` can be absent.** That is what `string | undefined` is telling you; there is no runtime
fallback to `""`.

**`--help` is answered before flags are parsed**, so a command with a `required` flag still prints its help rather than refusing.

**`run` throws and `capture` does not.** Choosing the wrong one is how a step runner ends up unwinding on the first red tool rather than reporting
it.

---

## Attribution

`tokenize.ts` adopts its token shape, argv-index rule and digit guards from `@visulima/command-line-args` (MIT), itself after `args-tokens` (MIT);
the file header names the upstream, and [`@y-core/forge/tooling/term`][term-readme] reproduces the MIT text these share.

---

## See also

- [`BUILD_TOOLING.md`][bt] §1 — the decisions behind this surface, and §2h for where a root comes from.
- [`@y-core/forge/tooling/term`][term-readme] — the terminal primitives help text and colour are rendered with.
- [`@y-core/forge/tooling/gate`][gate-readme] — the verification gate built on this framework.
- [`@y-core/forge/result`][result-readme] — the `Result` shape the JSONC functions return.

[bt]: ../../../docs/BUILD_TOOLING.md
[bt-2h]: ../../../docs/BUILD_TOOLING.md#2h-roots-are-stated-or-derived-never-discovered
[gate-readme]: ../gate/README.md
[result-readme]: ../../result/README.md
[term-readme]: ../term/README.md
