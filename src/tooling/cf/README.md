---
title: Cloudflare Account and Zone Reconciliation
description: "Reconciles account bindings against what exists and zone rules against a site config, and generates the env schema from both."
audience: internal
---

# `@y-core/forge/tooling/cf`

Bindings drift. A `wrangler.jsonc` declares a KV namespace, a D1 database and three secrets; what is actually on the account is whatever a sequence
of half-remembered dashboard clicks left behind. This namespace reconciles the two, in both scopes Cloudflare divides on — account resources and
zone rules — and generates the env schema from the same config.

Reach for it before a deploy, and in the gate.

```bash
forge cf sync                 # status for the account scope. Writes nothing
forge cf sync --commit        # create the missing remotes, write the resolved ids back
forge cf sync zone            # zone rules, read from config/site.ts
forge cf gen env              # emit env.schema.ts from wrangler.jsonc + .dev.vars
```

---

## Getting started

**Every verb here reports by default and changes nothing.** Run it bare, read the table, then decide.

```bash
forge cf sync                 # a report: what is declared, what exists, what differs
forge cf sync --commit        # the same run, permitted to write
```

`--commit` is the single switch that permits change, and it covers **both** kinds: creating resources on Cloudflare and editing your
`wrangler.jsonc`. No combination of other flags mutates anything — `--force` without `--commit` is an error rather than a no-op, since a flag about
_how_ to write should not be silently ignored on a run that cannot write.

There is deliberately no separate `status` command and no `--dry-run`. Both were spellings of the default, and a second way to say "do nothing" is a
second thing to keep honest.

---

## Knowing what to type

The grammar is `cf · verb · object`, and the object is always nameable. `verify`, `release` and `assets` stay at forge's top level because they act
on the repository; **a bare verb takes the repo as its object, a noun opens a domain where the verb and the object are both spelled out.**

**`account` and `zone` are Cloudflare's scopes, not names invented here.** They are the axis the API paths divide on (`/accounts/{id}` versus
`/zones/{id}`) and the axis API-token permissions divide on, so learning the CLI teaches the thing you needed anyway.

**A bare `cf sync` means `cf sync account`.** That default is legible only because the full form exists beside it and `cf sync --help` lists both
scopes — an implicit object is a wart when there is no way to say it, and a convenience when there is.

Note the asymmetry with `forge assets build`, which defaults to `build all`: that one defaults to the **union**, so it cannot quietly do less than
asked. `cf sync` defaults to **one of two peers**, so each report names its scope in the header, and a defaulted run says so when a zone config
exists that it did not touch.

---

## Reading the report

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

What the vocabulary is precise about, because each has been misread:

- **`unavailable` means a missing remote _target_** — a Pages project or Worker script that is not there. A binding a `--commit` would create is
  `would-create`.
- **A row saying `in-sync` has either queried the remote or explains why there was nothing to query.** No handler claims a remote resource is
  present without having looked, and a registry-wide test enforces it.
- **`created` and `updated` are per-row claims about that row.** A `sync zone` phase the commit loop skipped because it was already in step reads
  `in-sync`, even on a run where another phase was written.
- **`Remote` is presence, not success.** A write that failed against a name the listing already proved was there still says `Remote: yes` — the old
  value is untouched, and sending an operator to look for a secret that is there is the worse error.

---

## Reconciling account bindings

A binding declared locally and not matched remotely is **offered to be created**, and its resolved remote id is **written back** into the config.
Once a binding has a matching remote id it never needs creating again.

**The id is the identity.** A KV namespace, D1 database or queue is looked up first by the id in the config, and only then by name. A resource found
by id already exists whatever it happens to be called, so nothing is created and nothing is written back — the name this run would have computed is
not a reason to provision a second copy of a resource the worker already binds. When the id resolves to nothing, the lookup falls back to the name
and the row says which id failed. An R2 bucket has no id, so an explicit `bucket_name` plays that role; so does an explicit `database_name` or
`queue`.

Naming follows what the resource is:

- A value that lives **under** the project — a var, a secret — is created with its local name. It is not a binding: nothing assigns it an id, so
  there is nothing to write back.
- A binding created **independently and then linked** — D1, KV, R2, a queue — is created as `PROJECT_BINDINGNAME`, e.g. `MYAPP_MAIN_LIMITER`.
  Resource types whose names must be DNS-shaped (R2 buckets, queues) get the lowercase, hyphenated form of the same name.

A project name is not an identifier, so every character that is not a word character becomes `_` before it is used as a prefix: `my.app` yields
`MY_APP_CACHE`, and `my-app-assets` in DNS form.

---

## Pushing secrets

Secrets are read from `.dev.vars` beside the config and pushed by `--commit` — a deploy does not carry them. The rules governing the push:

- **A name declared in both `vars` and `.dev.vars` is never pushed.** One name cannot be both a `plain_text` var and a `secret_text` secret on the
  same worker, so the row says so and the write is refused, `--rotate` included.
- **A value never reaches a row, a log line or the terminal** — including in failure details, since Cloudflare's error messages can echo the
  rejected payload.

`.dev.vars` is read the way dotenv reads it, which is what wrangler pushes: an unquoted value ends at the first ` #`, so `API_KEY=abc # prod key`
sends `abc` and not the comment. Double quotes suppress that cut and expand `\n` and `\r`; single quotes are literal.

---

## Rotating a secret

A secret this project generated — a `SESSION_SECRET`, say — can be replaced with 32 fresh bytes of hex, the shape `openssl rand -hex 32` produces. A
third-party API key cannot: overwrite it and it is gone. So **rotation is opt-in per key, declared beside the key it governs**:

```bash
# .dev.vars

# forge:generate
SESSION_SECRET=ab3f…

STRIPE_API_KEY=sk_live_…   # unmarked — never rotated
```

```bash
forge sync --commit --rotate SESSION_SECRET           # new value on Cloudflare
forge sync --commit --local --rotate SESSION_SECRET   # new value in .dev.vars
```

The two are separate acts because **a remote secret is never kept on this machine**. `--rotate` generates a value, pushes it, and does not print it
or write it to `.dev.vars`; `--local --rotate` replaces the development value and touches no API, so it needs no credentials. The local and remote
values of one name are expected to differ. A rotation rewrites the value and leaves the comment in place.

Naming an unmarked or unknown key refuses the whole run before any request is made. Both are writes, so both need `--commit`.

---

## Setting up credentials

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, or `--account-id` / `--api-token`. The token needs one account permission per resource type it
touches — **Read** for a status run, **Edit** for `--commit`:

| touching | permission |
| --- | --- |
| a Pages project's vars and secrets | Cloudflare Pages |
| a Worker's settings, secrets, rate limits | Workers Scripts |
| KV namespaces | Workers KV Storage |
| D1 databases | D1 |
| R2 buckets | Workers R2 Storage |
| queues | Queues |

The Workers token templates do **not** grant Cloudflare Pages, so a token that reads a Worker's settings fails on a Pages project.

**An auth failure does not tell you which.** Cloudflare returns one code for a token it rejects and for a valid token missing a permission, so the
row names both and prints Cloudflare's own message beneath the table. To separate them without guessing, ask Cloudflare about the token itself:

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify; echo "EXIT:$?"
```

A `success: false` there is the token; a `success: true` alongside a failing sync is a missing permission.

This is a **CLI credential, not a Worker secret.** Nothing here is a `.dev.vars` key: `forge cf sync` pushes marked keys from that file to
Cloudflare, and a token with edit rights is the last thing that should sit in a file with that machinery pointed at it.

---

## Reconciling zone rules

```bash
forge sync zone --config config/site.ts   # read-only report, the default
forge sync zone --commit                  # writes the entry point rulesets
forge sync zone --check                   # exit non-zero on drift, for the gate
```

It reads the `zone` block of a [`@y-core/forge/site`][site-readme] config and reconciles two phase entry point rulesets:
`http_request_firewall_custom` for the route-derived allow-list, and `http_request_dynamic_redirect` for a host-to-apex redirect.

**A `PUT` replaces the phase's whole rule list.** A rule this config does not describe does not survive a `--commit` — including one authored by
hand in the dashboard. That is the point of one source of truth, and it is the thing to know before the first commit.

**Sync before you push.** The order is always `forge sync zone --commit` → push → deploy; the asymmetry that makes it one-directional is
[`@y-core/forge/site`][site-readme]'s. `--check` in the gate turns "you forgot" into a local failure, which is the only place it is cheap to catch.

Credentials are `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`, read from the environment; either missing is refused before any call is made.
`--zone-id` / `--api-token` exist for a one-off, but a value on a command line lands in shell history.

**No single permission covers both phases:** the firewall phase needs Zone → _Zone WAF: Edit_, the redirect phase Zone → _Dynamic Redirect: Edit_,
and both need Zone → _Zone: Read_.

**Zone read access is not ruleset access.** Probed live against a token that returns a full `GET /zones/{zone_id}` for the same zone: both
`/rulesets/phases/{phase}/entrypoint` reads answered HTTP 403, code 10000 "Authentication error". A token can be valid, active and scoped to the
right zone and still read nothing here, and the failure carries no hint that a _different_ permission is missing. The permission that unlocks both
phases at once is account-scoped: **Account → _Account Rulesets: Edit_**. That it is account-level, on an endpoint addressed entirely by zone, is
what nothing in the response suggests — and the reason both phases fail together, where a missing per-phase zone permission would fail only one.

---

## Generating the env schema

`forge cf gen env` reads `wrangler.jsonc` plus `.dev.vars` and emits one committed module holding a runtime valibot `EnvSchema` and a compile-time
`type Env` — a schema-first replacement for the env half of `wrangler types`. It is one third of the standard three-part env setup, whose full guide
is [`src/config/README.md`][config-readme]:

1. **`src/app/env.config.ts`** — optional hand-written policy, a `Partial<GenOptions>`: `optional: new Set(["RATE_LIMITER"])` for bindings absent
   under `wrangler dev`, or `refinements: { SESSION_SECRET: { minLength: 32 } }` for per-var constraints.
2. **`src/app/env.schema.ts`** — the generated module, committed and regenerated whenever `wrangler.jsonc` bindings change.
3. **`validateBindings(EnvSchema)`** ([`@y-core/forge/app`][app-readme]) — registered as middleware, so the contract is enforced on the first
   request.

Run it as a script:

```json
{ "scripts": { "gen:env": "forge cf gen env" } }
```

| Flag | Default | Description |
| --- | --- | --- |
| `--wrangler` | `wrangler.jsonc` | Path to the wrangler config. |
| `--dev-vars` | `.dev.vars` | Path to the `.dev.vars` secrets file. |
| `--out` | `src/app/env.schema.ts` | Output module path. |
| `--config` | `src/app/env.config.ts` | Host-policy module exporting a `Partial<GenOptions>`; built-in `DEFAULT_OPTIONS` apply when absent. |

A typical generated module:

```ts
/** env.schema.ts — GENERATED — do not edit; run `bun run gen:env`. */
import { v } from "@y-core/forge/validation";

export const EnvSchema = v.object({
  MY_KV: v.custom<KVNamespace>((x) => typeof x === "object" && x !== null, "MY_KV must be a KV namespace binding"),
  API_BASE_URL: v.string(),
});

export type Env = v.InferOutput<typeof EnvSchema>;
```

The command emits the module and runs an oxfmt pass, so the generated file passes the lint gate.

---

## Driving it without the CLI

```ts
import { createGenEnvCommand, createSyncAccountCommand, createSyncZoneCommand } from "@y-core/forge/tooling/cf";
```

Each `create*Command` returns the `Command` the `forge` binary attaches, ready to hand to `execute`. Beneath them the barrel publishes the engine,
the handler registry, the Cloudflare API client and the JSONC round-trip writer, so an application can drive reconciliation without the command
layer.

**Drive generation through `createGenEnvCommand`.** The generator core is `@internal` and exports nothing from the barrel — there is no supported
way to assemble a schema from the internal pieces.

---

## Gotchas

**A rate limiter has no account-level API** — nothing to list, and nothing to create. `namespace_id` is not the id of a remote resource: it is a
positive-integer string you pick to identify the namespace within the account, and wrangler only type-checks it. (`/zones/{zone_id}/rate_limits`
exists but is the deprecated _zone_ WAF product, unrelated to the Workers `ratelimits` binding.) A rate limiter is observable on a **deployed
Worker**, as a `ratelimit` entry in its settings, and on Worker targets only — a Pages config declaring one is rejected outright and binds nothing.

**Vars are reported, never written.** A var lives in the wrangler config and `wrangler deploy` is what puts it on the remote, so `sync` compares and
stops there, `--commit` included. A var that is absent or has drifted is reported as `skipped` with both values in the detail, and the next deploy
pushes it. Writing one here would only be undone by that deploy.

**A Pages `secret_text` value is not readable.** `pages secret list` filters `env_vars` to `type === "secret_text"` and prints the literal "Value
Encrypted"; only a `plain_text` entry has a readable `value`. So on a Pages target a secret is compared by name and nothing more, and the row says
so rather than implying the values match. A Worker's secret list carries name and type only, so the same holds there.

**Worker or Pages is detected from the config, never from a flag.** `main` and `pages_build_output_dir` are mutually exclusive and neither wins:
wrangler rejects a config carrying both, so such a config is already invalid. `detectTarget` treats it as a Worker, matching wrangler's own advice.

**A config write-back is a surgical splice.** The original file is parsed with byte offsets retained and only the bytes of the value being written
are replaced, so comments, blank lines, key order, indentation and line endings survive byte-for-byte — a `git diff` after a successful `sync
--commit` shows inserted `"id"` lines and nothing else. Guarantees hold around it: an **inexpressible edit refuses** (an added array, a removed
key, a changed type) and names the exact paths and how many comments were at risk, with `--force` taking the destructive whole-file rewrite and
reporting what it destroyed; and a **splice is verified before it lands** — the spliced text is reparsed and compared against the intended config,
and a mismatch writes nothing, not even under `--force`, because a bug in the writer must not be resolved by falling back to the destructive path.
Writes are atomic: a temp file beside the config, then a rename.

---

## See also

- [`src/site/README.md`][site-readme] — the zone block this reconciles, and the allow-list rulings behind it
- [`src/config/README.md`][config-readme] — the three-part env setup `gen env` is one third of
- [`src/app/README.md`][app-readme] — `validateBindings`, which enforces the generated schema
- [`docs/SOURCE_OF_TRUTH.md`][sot-2f] §2f — why this README, and not a `docs/` document, owns the rulings above

[app-readme]: ../../app/README.md
[config-readme]: ../../config/README.md
[site-readme]: ../../site/README.md
[sot-2f]: ../../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows
