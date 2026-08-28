# `@y-core/forge/cli/sync`

Reconcile the Cloudflare bindings declared in a `wrangler.jsonc` against what
actually exists on the account, and provision what does not.

```sh
forge sync                    # status: what is declared vs what is out there. Writes nothing
forge sync --commit           # create the missing remotes, write the resolved ids back
```

There is one command and two modes. `sync` on its own is the status report — it
performs only the reads needed to compare local bindings against the remote, and
prints the plan. `--commit` is the single switch that permits change.

There is deliberately no separate `status` command and no `--dry-run`: both were
spellings of the default, and a second way to say "do nothing" is a second thing to
keep honest.

## The model

A binding declared locally and not matched remotely is **offered to be created**,
and its resolved remote id is **written back** into the config. Once a binding has
a matching remote id it never needs creating again.

**The id is the identity.** A KV namespace, D1 database or queue is looked up first
by the id in the config, and only then by name. A resource found by id already
exists whatever it happens to be called, so nothing is created and nothing is
written back — the name this run would have computed is not a reason to provision a
second copy of a resource the worker already binds. When the id resolves to nothing
on the account, the lookup falls back to the name and the row says which id failed.
An R2 bucket has no id, so an explicit `bucket_name` plays that role; so does an
explicit `database_name` or `queue`.

Naming follows what the resource is:

- A value that lives **under** the project — a var, a secret — is created with its
  local name. It is not a binding: nothing assigns it an id, so there is nothing to
  write back into the config.
- A binding created **independently and then linked** — D1, KV, R2, a queue — is
  created as `PROJECT_BINDINGNAME`, e.g. `CORNELLAW_MAIN_LIMITER`. Resource types
  whose names must be DNS-shaped (R2 buckets, queues) get the lowercase, hyphenated
  form of the same name.

A project name is not an identifier, so every character that is not a word character
becomes `_` before it is used as a prefix: `my.app` yields `MY_APP_CACHE`, and
`my-app-assets` in DNS form.

## Vars are reported, never written

A var lives in the wrangler config, and `wrangler deploy` is what puts it on the
remote. So `sync` compares each declared var against what the remote currently holds
and stops there — under `--commit` too. A var that is absent or has drifted is
reported as `skipped`, with both values in the detail, and the next deploy pushes it.
Writing one here would only be undone by that deploy.

## Secrets

Secrets are read from `.dev.vars` beside the config, and are pushed by `--commit` —
a deploy does not carry them. Two rules govern that push:

- **A name declared in both `vars` and `.dev.vars` is never pushed.** One name cannot
  be both a `plain_text` var and a `secret_text` secret on the same worker, so the
  row says so and the write is refused, `--rotate` included.
- **A value never reaches a row, a log line or the terminal** — including in failure
  details, since Cloudflare's error messages can echo the payload that was rejected.

### Rotation

A secret this project generated — a `SESSION_SECRET`, say — can be replaced with 32
fresh bytes of hex, the shape `openssl rand -hex 32` produces. A third-party API key
cannot: overwrite it and it is gone. So rotation is opt-in per key, declared beside
the key it governs:

```sh
# .dev.vars

# foundry:generate
SESSION_SECRET=ab3f…

STRIPE_API_KEY=sk_live_…   # unmarked — never rotated
```

```sh
forge sync --commit --rotate SESSION_SECRET           # new value on Cloudflare
forge sync --commit --local --rotate SESSION_SECRET   # new value in .dev.vars
```

The two are separate acts because **a remote secret is never kept on this machine**.
`--rotate` generates a value, pushes it, and does not print it or write it to
`.dev.vars`; `--local --rotate` replaces the development value in `.dev.vars` and
touches no API, so it needs no credentials. The local and remote values of one name
are expected to differ — neither surface returns a secret's value, so secrets are
compared by name in any case.

Naming an unmarked or unknown key refuses the whole run before any request is made.
Both are writes, so both need `--commit`; without it each prints what it would do.

The deployment surface is detected from the config, never from a flag: a config with
`pages_build_output_dir` and no `main` is a Pages project, and vars and secrets are
read from `deployment_configs.production.env_vars`. Anything else is
a Worker script, addressed through `workers/scripts/<name>/settings`.

## Nothing changes without `--commit`

`--commit` covers **both** kinds of change: creating resources on Cloudflare and
editing your `wrangler.jsonc`. There is no combination of other flags that mutates
anything — `--force` without `--commit` is an error rather than a no-op, since a
flag about how to write should not be silently ignored on a run that cannot write.

## Config write-back

When `--commit` writes an id back, it does so as a **surgical splice**: the original
file is parsed with byte offsets retained, and only the bytes belonging to the value
being written are replaced. Comments, blank lines, key order, indentation and line
endings survive byte-for-byte. A `git diff` after a successful `sync --commit` shows
inserted `"id"` lines and nothing else.

Two guarantees hold around that:

- **An inexpressible edit refuses.** If the change is not a primitive-valued set —
  an added array, a removed key, a changed type — the writer writes nothing and names
  the exact paths involved and how many comments were at risk. `--force` will take
  the old whole-file JSON rewrite instead, and reports what that destroyed.
- **A splice is verified before it lands.** The spliced text is reparsed and
  compared against the intended config. If it does not match exactly, nothing is
  written — not even under `--force`, because a bug in the writer must not be
  resolved by falling back to the destructive path.

Writes are atomic: a temp file beside the config, then a rename.

## What each action means

| action | meaning |
|---|---|
| `exists` | verified present remotely, or a local-only binding with nothing to verify |
| `created` / `updated` | a write happened |
| `skipped` | deliberately did nothing; the detail says why |
| `unavailable` | the remote target or resource does not exist |
| `error` | the operation failed; the detail carries the cause |

A row saying `exists` has either queried the remote or explains in its detail why
there is nothing to query. No handler claims a remote resource is present without
having looked — a registry-wide test enforces this.

## Credentials

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, or `--account-id` / `--api-token`.

The token needs one account permission per resource type it touches — **Read** for a
status run, **Edit** for `--commit`:

| touching | permission |
|---|---|
| a Pages project's vars and secrets | Cloudflare Pages |
| a Worker's settings, secrets, rate limits | Workers Scripts |
| KV namespaces | Workers KV Storage |
| D1 databases | D1 |
| R2 buckets | Workers R2 Storage |
| queues | Queues |

The Workers token templates do **not** grant Cloudflare Pages, so a token that reads
a Worker's settings fails on a Pages project. Cloudflare returns one code for a
rejected token and for a valid token missing a permission, so the row names both.

## Programmatic use

```ts
import { createSyncCommand, syncBindings, loadWranglerConfig } from "@y-core/forge/cli/sync";
```

`createSyncCommand()` returns the `Command` the `forge` binary attaches under `sync`; the rest of
the barrel is the engine, the handler registry, the Cloudflare API client, and the JSONC
round-trip writer, so an application can drive reconciliation without the command layer.
