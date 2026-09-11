---
title: Cloudflare Account and Zone Reconciliation
description: "Reconciles account bindings against what exists and zone rules against a site config, and generates the env schema from both."
audience: internal
---

# `@y-core/forge/tooling/cf`

Everything that talks to Cloudflare: reconciling account bindings against what exists,
reconciling zone rules against a site config, and generating the env schema from both.

```bash
forge cf sync                 # status for the account scope. Writes nothing
forge cf sync --commit        # create the missing remotes, write the resolved ids back
forge cf sync account         # the same, said explicitly
forge cf sync zone            # zone rules, read from config/site.ts
forge cf gen env              # emit env.schema.ts from wrangler.jsonc + .dev.vars
```

## The grammar

`cf · verb · object`, and the object is always nameable. `verify`, `release` and `assets`
stay at forge's top level because they act on the repository; **a bare verb takes the repo
as its object, a noun opens a domain where the verb and the object are both spelled out.**

**`account` and `zone` are Cloudflare's scopes, not names invented here.** They are the axis
the API paths divide on (`/accounts/{id}` versus `/zones/{id}`) and the axis API-token
permissions divide on, so learning the CLI teaches the thing you need anyway.

**A bare `cf sync` means `cf sync account`.** That default is legible only because the full
form exists beside it and `cf sync --help` lists both scopes — an implicit object is a wart
when there is no way to say it, and a convenience when there is. Both are built from one
flags object and one runner, not a second copy.

Note the asymmetry with `forge assets build`, which defaults to `build all`: that one
defaults to the **union**, so it cannot quietly do less than asked. `cf sync` defaults to
**one of two peers**, so each report names its scope in the header, and a defaulted run
says so when a zone config exists that it did not touch.

## Two modes, everywhere

Every verb here reports by default and changes nothing. `--commit` is the single switch that
permits change.

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

## Rate limiters

A rate limiter has **no account-level API** — nothing to list, and nothing to
create. `namespace_id` is not the id of a remote resource: it is a positive-integer
string the developer picks to identify the namespace within the account, and
wrangler only type-checks it. (`/zones/{zone_id}/rate_limits` exists but is the
deprecated _zone_ WAF product, unrelated to the Workers `ratelimits` binding.)

A rate limiter is observable on a **deployed Worker**, as a `ratelimit` entry in its
settings. That is the only remote statement this tool can make about one, and it is
available for Worker targets only: a Pages `deployment_configs` carries no
rate-limit binding, and `ratelimits` is not among the config fields wrangler accepts
for a Pages project — a Pages config declaring one is rejected outright and binds
nothing.

## Worker or Pages, read from the config

The surface is detected from the config, never from a flag. `main` and
`pages_build_output_dir` are **mutually exclusive** and neither wins: wrangler
rejects a config carrying both, so such a config is already invalid. `detectTarget`
treats it as a Worker, matching wrangler's own advice to use `main` when deploying
a Worker.

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

**A Pages `secret_text` value is not readable.** `pages secret list` filters `env_vars` to
`type === "secret_text"` and prints the literal "Value Encrypted" for each; only a `plain_text`
entry has a readable `value`. So on a Pages target a secret can be compared by name and nothing
more, and the row says so rather than implying the values match. A Worker's secret list carries name
and type only, so the same holds there.

`.dev.vars` is read the way dotenv reads it, which is what wrangler pushes: an
unquoted value ends at the first ` #`, so `API_KEY=abc # prod key` sends `abc` and
not the comment. Double quotes suppress that cut and expand `\n` and `\r`; single
quotes are literal. A rotation rewrites the value and leaves the comment in place.

### Rotation

A secret this project generated — a `SESSION_SECRET`, say — can be replaced with 32
fresh bytes of hex, the shape `openssl rand -hex 32` produces. A third-party API key
cannot: overwrite it and it is gone. So rotation is opt-in per key, declared beside
the key it governs:

```bash
# .dev.vars

# foundry:generate
SESSION_SECRET=ab3f…

STRIPE_API_KEY=sk_live_…   # unmarked — never rotated
```

```bash
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
| --- | --- |
| `in-sync` | verified present on both sides; nothing to do |
| `local-only` | by design never goes remote — an unmarked `.dev.vars` key |
| `deploy-pushes` | the next `wrangler deploy` puts it there; this tool never writes it |
| `drift` | present on both sides, and the two disagree |
| `would-create` | `--commit` would create it here |
| `would-rotate` | `--commit` would generate a new value remotely — the local one is never sent |
| `created` | a write happened — it did not exist and now does |
| `updated` | a write happened — it existed and its value was changed |
| `rotated` | a write happened — a freshly generated value replaced the remote one |
| `remote-only` | present remotely and declared nowhere locally |
| `unavailable` | the remote target does not exist, or the surface cannot carry this binding |
| `error` | the operation failed; the detail carries the cause |

`unavailable` is reserved for a missing **remote target** — a Pages project or Worker script that is
not there. A binding a `--commit` would create is `would-create`, not `unavailable`.

A row saying `in-sync` has either queried the remote or explains in its detail why
there is nothing to query. No handler claims a remote resource is present without
having looked — a registry-wide test enforces this.

`created` and `updated` are per-row claims about **that** row: a `sync zone` phase the
commit loop skipped because it was already in step reads `in-sync`, even on a run where
another phase was written.

`Remote` is presence, not success. A write that failed against a name the listing
already proved was there still says `Remote: yes` — the old value is untouched on the
remote, and sending an operator to look for a secret that is there is the worse error.

## Credentials

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, or `--account-id` / `--api-token`.

The token needs one account permission per resource type it touches — **Read** for a
status run, **Edit** for `--commit`:

| touching | permission |
| --- | --- |
| a Pages project's vars and secrets | Cloudflare Pages |
| a Worker's settings, secrets, rate limits | Workers Scripts |
| KV namespaces | Workers KV Storage |
| D1 databases | D1 |
| R2 buckets | Workers R2 Storage |
| queues | Queues |

The Workers token templates do **not** grant Cloudflare Pages, so a token that reads
a Worker's settings fails on a Pages project. Cloudflare returns one code for a
rejected token and for a valid token missing a permission, so the row names both.

## The zone scope — rules, not bindings

The account scope reconciles resources extracted from `wrangler.jsonc`. Zone rules are neither: a
different Cloudflare scope, and a different config file. So `zone` is a **sibling scope under the
same verb**, reusing the client, the error classification and the table renderer — not another
`ResourceHandler`, whose `extract(config: WranglerConfig)` signature does not fit.

That sharing is what the directory layout now says: `api/`, `config/`, `table.ts` and `target.ts`
sit at the root of this namespace because both scopes use them, with `account/`, `zone/` and
`gen/` as consumers.

```bash
forge sync zone --config config/site.ts   # read-only report, the default
forge sync zone --commit                  # writes the entry point rulesets
forge sync zone --check                   # exit non-zero on drift, for the gate
```

It reads the `zone` block of a [`@y-core/forge/site`](../../site/README.md) config and reconciles
two phase entry point rulesets: `http_request_firewall_custom` for the route-derived allow-list,
and `http_request_dynamic_redirect` for a host-to-apex redirect.

The redirect **consolidates a zone onto its apex** — every source host must be a subdomain of it,
and a source outside it or equal to it is refused when the rule is built rather than after it is
committed. Why, and the once-stated apex the rule reads, are
[`@y-core/forge/site`](../../site/README.md)'s.

**A `PUT` replaces the phase's whole rule list.** A rule this config does not describe does not
survive a `--commit` — including one authored by hand in the dashboard. That is the point of one
source of truth, and it is also the thing to know before the first commit.

**Sync before you push** — the order is always `forge sync zone --commit` → push → deploy, and the
asymmetry that makes it one-directional is [`@y-core/forge/site`](../../site/README.md)'s. `--check`
in the gate turns "you forgot" into a local failure, which is the only place it is cheap to catch.

Credentials are `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`, read from the environment; either
missing is refused before any call is made. `--zone-id` / `--api-token` exist for a one-off, but a
value on a command line lands in shell history, so the environment is the intended route.

**No single permission covers both phases:** the firewall phase needs Zone → _Zone WAF: Edit_, the
redirect phase Zone → _Dynamic Redirect: Edit_, and both need Zone → _Zone: Read_.

**Zone read access is not ruleset access.** Probed live against a token that returns a
full `GET /zones/{zone_id}` for the same zone: both `/rulesets/phases/{phase}/entrypoint` reads
answered HTTP 403, code 10000 "Authentication error". A token can be valid, active and scoped to the
right zone and still read nothing here, and the failure carries no hint that a _different_
permission is what is missing. The permission that unlocks both phases at once is account-scoped:
**Account → _Account Rulesets: Edit_**. That it is account-level, on an endpoint addressed entirely
by zone, is the part nothing in the response suggests — and the reason both phases fail together,
where a missing per-phase zone permission would fail only one.

**An expression is capped at 4096 characters per rule**, and that — not the per-phase rule count —
is the ceiling a generated allow-list grows into. The cap is enforced and tested where the
expression is built, so both the limit and the two ways out of it are
[`@y-core/forge/site`](../../site/README.md)'s.

**An auth failure does not tell you which.** Cloudflare returns one code for a token it rejects and
for a valid token missing a permission, so the failure row names both and prints Cloudflare's own
message beneath the table. To separate them without guessing, ask Cloudflare about the token
itself:

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify; echo "EXIT:$?"
```

A `success: false` there is the token; a `success: true` alongside a failing `sync zone` is a
missing permission.

This is a **CLI credential, not a Worker secret.** Nothing here is a `.dev.vars` key: `forge cf sync`
pushes marked keys from that file to Cloudflare, and a token with edit rights on the zone is the
last thing that should be sitting in a file with that machinery pointed at it.

## Generating the env schema

`forge cf gen env` reads the `wrangler.jsonc` config plus the `.dev.vars` secrets file and emits a
single committed module containing a runtime valibot `EnvSchema` and a compile-time
`type Env = v.InferOutput<typeof EnvSchema>` — a schema-first replacement for the env half of
`wrangler types`. It is one third of the **standard three-part env setup** (the full guide is
[src/config/README.md](../../config/README.md)):

1. **`src/app/env.config.ts`** — optional hand-written policy, a `Partial<GenOptions>`: e.g.
   `optional: new Set(["RATE_LIMITER"])` for bindings absent under `wrangler dev`, or
   `refinements: { SESSION_SECRET: { minLength: 32 } }` for per-var constraints.
2. **`src/app/env.schema.ts`** — the **generated** module (`EnvSchema` + `type Env`), committed and
   regenerated whenever `wrangler.jsonc` bindings change.
3. **`validateBindings(EnvSchema)`** ([`@y-core/forge/app`](../../app/README.md)) — registered as
   middleware so the contract is enforced on the first request.

Run it as a `package.json` script:

```json
{ "scripts": { "gen:env": "forge cf gen env" } }
```

```bash
bun run gen:env
```

| Flag | Default | Description |
| --- | --- | --- |
| `--wrangler` | `wrangler.jsonc` | Path to the wrangler config. |
| `--dev-vars` | `.dev.vars` | Path to the `.dev.vars` secrets file. |
| `--out` | `src/app/env.schema.ts` | Output module path. |
| `--config` | `src/app/env.config.ts` | Host-policy module exporting a `Partial<GenOptions>`; built-in `DEFAULT_OPTIONS` are used when this file is absent. |

The command reads the wrangler bindings and dev-vars keys, collects entries, emits the module, and
runs an oxfmt format pass so the generated file passes the lint gate. A typical generated module:

```ts
/** env.schema.ts — GENERATED — do not edit; run `bun run gen:env`. */
import { v } from "@y-core/forge/validation";

export const EnvSchema = v.object({
  MY_KV: v.custom<KVNamespace>((x) => typeof x === "object" && x !== null, "MY_KV must be a KV namespace binding"),
  ASSETS: v.custom<Fetcher>((x) => typeof x === "object" && x !== null, "ASSETS must be a Fetcher binding"),
  API_BASE_URL: v.string(),
});

export type Env = v.InferOutput<typeof EnvSchema>;
```

Override generation policy with a `--config` module exporting a `Partial<GenOptions>` (as `options`
or `default`), merged over `DEFAULT_OPTIONS`:

```ts
// src/app/env.config.ts
import type { GenOptions } from "@y-core/forge/tooling/cf";

export const options: Partial<GenOptions> = { optional: new Set(["ANALYTICS"]), refinements: { API_BASE_URL: { minLength: 8 } } };
```

### Generator API

| Export | Signature | Description |
| --- | --- | --- |
| `createGenEnvCommand` | `() => CommandBase` | Builds the `gen-env` command (read wrangler + dev-vars → collect → emit → format). Pass to `execute`; it is also the `forge cf gen env` bin entry. |
| `readWranglerConfig` | `(path: string) => Record<string, unknown>` | Reads and parses a `wrangler.jsonc` file (JSONC comments and trailing commas stripped). |
| `loadOptions` | `(configPath?: string) => Promise<GenOptions>` | Loads a `--config` policy module and merges it over `DEFAULT_OPTIONS`; returns the defaults when no path is given. |
| `GenOptions` | `{ optional: Set<string>; refinements: Record<string, { minLength?: number }>; bindingCheck: string }` | The host-policy shape a `--config` module exports. The only public type of the three generator modules. |

The generator core behind those is `@internal` and barrel-exports nothing: `cf-env-registry.ts`
holds the data (the `REGISTRY` binding-kind table in wrangler's collection order, the
`DEFAULT_OPTIONS` policy default, the baked `HEADER` comment, and the `BindingDef` / `Entry`
shapes), and `cf-env-gen.ts` holds the codegen (`collectBindings`, `collectVars`, `emit`,
`stripJsonc`). **Drive generation through `createGenEnvCommand`** — there is no supported way to
assemble a schema from the internal pieces.

## Programmatic use

```ts
import { createSyncAccountCommand, syncBindings, loadWranglerConfig } from "@y-core/forge/tooling/cf";
```

`createSyncAccountCommand()` returns the `Command` the `forge` binary attaches under `sync`, and
`createSyncZoneCommand()` the one attached beneath it; the rest of
the barrel is the engine, the handler registry, the Cloudflare API client, and the JSONC
round-trip writer, so an application can drive reconciliation without the command layer.
