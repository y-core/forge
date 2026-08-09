# CLAUDE.md — Architectural Constitution

> Namespace-based shared library for Cloudflare Workers.
> Ships raw TypeScript. No build step. Consumed via the `@y-core/forge/{namespace}` export map.

---

## Behavioral Rules (always enforced)

- ONLY do what has been asked — recommend and get approval before any additions
- NEVER add runtime dependencies without approval
- NEVER use Bun-specific or Node.js APIs in runtime source files (standard Web APIs only)
- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER provide deprecation shims or backward-compatible paths before v1.0.0
- ALWAYS add new public symbols to the namespace's `mod.ts` as a named export
- ALWAYS co-locate tests (`*.test.ts` / `*.test.tsx`) with the source they test
- ALWAYS enforce exact-match test assertions accounting for HTML entities — never substring matching
- ALWAYS run local verification after changes — **delegate every gate run to `cc-tester`** (see _Verification Delegation_)
- ALWAYS report a command's exit status with the one canonical suffix — never a variant (see _Shell Exit Checks_)
- ALWAYS reach the ledger over MCP, and never work from a remembered copy of the protocol — fetch `get_protocol` or `get_process` when one would settle the question in front of you (see _Ledger Maintenance_)
- Use `rg` for content search and `find` for file search

---

## Toolchain

| Tool | Role |
|---|---|
| `bun` | Package manager and test runner |
| `tsgo` (`@typescript/native-preview`) | Type checker (use instead of `tsc`) |
| `biome` | Linter and formatter (use instead of `eslint`/`prettier`) |

```bash
bun run check                  # the gate — every step must pass
bun run check --only lint      # one step, for the dev loop (any step label)
bun run check --list           # print the steps, run none
bun run check --fix            # every step's fixer (aliased as `bun run lint:fix`)
bun run verify                 # the release gate — check plus the browser set
```

`scripts/lib/steps.ts` is the single source of truth for the gate's steps and their gate
membership. Gate philosophy, the two verbs, and the flags:
[`TESTING.md`](.decisions/TESTING.md) §6.

**Avoid:** `tsc` (use `tsgo`), `bun-types` (use the custom stub), `eslint`/`prettier` (use `biome`).

### Shell Exit Checks

When a command's exit status must be stated explicitly, append **exactly** this suffix — same
spelling, same casing, same quoting, every time:

```bash
<command>; echo "EXIT:$?"
```

- Use `;`, never `&&` — with `&&` the echo is skipped precisely when the command fails, which is
  the only case worth checking.
- Never pipe within the same statement: `bun run check | tail -20; echo "EXIT:$?"` reports `tail`'s
  status, not the gate's. Redirect first, then inspect the file:
  `bun run check > /tmp/check.log 2>&1; echo "EXIT:$?"`.
- Never invent a variant — `exit=$?`, `RC=$?`, `---EXIT CODE $?---`, or a re-quoted spelling all
  miss the allowlist and cost a fresh permission prompt each time.
- Omit the suffix when the exit code is not actually in question; a bare failing command already
  surfaces its status. The suffix exists for the cases where that signal would otherwise be lost.

The matching allow rule is an **exact-string** entry (no `:*` prefix wildcard) in
`.claude/settings.local.json` — deviating by one character is what turns a silent run into a prompt.

### Verification Delegation

**`cc-tester` is the sole runner** of `bun run check` and any cross-cutting suite. It returns a
terse verdict — `✓ green`, or `✗` with the failing step and a minimal excerpt — **never the full
stream**. `cc-plan`, `cc-dev`, and `cc-doc` delegate every gate run to it; `cc-test` may smoke-run
only the single test file it just wrote.

On failure the **owning** agent fixes and re-delegates — the gate never re-runs inside the agent
that owns the fix, and `cc-tester` never edits the code it judges.

`cc-tester` declares a `tools:` allowlist without `Write`/`Edit`, but **enforcement is not
guaranteed**. Treat the whole split as convention: every agent obeys its stated boundaries because
it is told to, not because a mechanism stops it. No hook enforces the routing either — a decision,
not an omission.

### Ledger Maintenance

**Forge's work is tracked in the task-forge ledger, and the MCP tools are the only way in.**
`.mcp.json` connects it as `ledger`, and this repository is the `forge` project inside it. `cc-plan`,
`cc-dev`, `cc-test` and `cc-doc` each own the ledger entry for the work they carry, and every move
goes through those tools — never through a text editor. `cc-tester` is the one exception: it runs
gates and has **no ledger tools at all**, because a green gate is not by itself a decision that a
task is done. A docs-only change runs no gate, so the doc edit is its own evidence.

**Call `get_protocol` or `get_process` when there is something it would settle — when a refusal
cites a rule you do not hold, or before an operation you have not performed in this session — and
work from what it returns rather than from a remembered copy.** Neither is fetched up front. They
are the two largest documents the ledger serves, and a lifecycle of isolated contexts pays for them
once per agent whether or not the work ever needs them. Deferring costs nothing because the recovery
path is already load-bearing: a refusal quotes the `rule` it applied and the `requires` it failed,
and `check_transition` answers a hypothetical without touching the database — so no agent is ever
stuck for want of a document it did not prefetch.

Nothing they return is restated here — the protocol is the one document where a
second copy is indistinguishable from a rule change, because a stale paragraph and an amended rule
read identically and the reader cannot tell which they are holding.

---

## Architecture

Forge is a **facade** over its external dependencies (`valibot` via `validation`, `@remix-run/*`
via `router`, `app`, `http`, and `session`). The `jsx` namespace is an **in-house SSR runtime**,
not a facade for any third-party library. Consumers import from `@y-core/forge/{namespace}`, never
from a wrapped package directly.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests.

**Leaf vs integration:** every namespace is either a **leaf** (zero cross-namespace forge imports)
or an **integration** namespace (declared composition across namespaces). Classify before adding
code; never introduce an undeclared cross-namespace dependency.

For the namespace catalog, barrel rules, and growth recipes, consult the governing `.decisions/`
doc via the **Guide Index** — never duplicate that detail here.

---

## Guide Index

> Before writing code, consult the relevant governing document. Each begins with a
> `## 0. Quick Reference` listing every section, so you can pick a section without reading the
> whole file.

- [`AGENT_GUIDE.md`](.decisions/AGENT_GUIDE.md): how `.decisions/` docs are structured, numbered, sized, and cross-referenced; the single-home rule and source-of-truth register
- [`LIBRARY_ARCHITECTURE.md`](.decisions/LIBRARY_ARCHITECTURE.md): the dependency facade, the runtime-only no-build-step constraint, demand composition, Web-APIs-only
- [`NAMESPACE_DESIGN.md`](.decisions/NAMESPACE_DESIGN.md): barrel rules and the `export *` ban, the no-sibling-barrel guard, the authoritative subpath catalog, leaf/integration classification, naming conventions
- [`PRODUCTION_TS_RULES.md`](.decisions/PRODUCTION_TS_RULES.md): six coding rules — zero global state, explicit errors, validation first, testability, TSDoc, declarative style
- [`ROUTING_AND_MIDDLEWARE.md`](.decisions/ROUTING_AND_MIDDLEWARE.md): declarative route maps and controllers, `definePage`/`defineAction`, middleware ordering, the `context` namespace
- [`HTMX.md`](.decisions/HTMX.md): request detection, `HX-*` header readers and setters, `hxAttrs`, the pattern helpers, and the selector trust posture
- [`SECURITY_HARDENING.md`](.decisions/SECURITY_HARDENING.md): CSP nonce headers, CORS, origin-guard tiering, rate limiting, the `trustCfHeaders` trust boundary, the transport-layer boundary
- [`STRUCTURED_LOGGING.md`](.decisions/STRUCTURED_LOGGING.md): log channels and wrappers, `requestLogger`, KV persistence, the auth-gated log viewer, the no-PII rule
- [`ERROR_HANDLING.md`](.decisions/ERROR_HANDLING.md): the one `Result` primitive, fragment renderers, the router error boundary, the fail-closed posture
- [`INPUT_VALIDATION.md`](.decisions/INPUT_VALIDATION.md): the valibot `v` facade, form parsing and its byte cap, CSRF, honeypot, Turnstile, validate-at-boundary
- [`STORAGE_BINDINGS.md`](.decisions/STORAGE_BINDINGS.md): D1, KV, and R2 clients, the resolve/validate binding pattern, dev degradation
- [`UI_SSR_COMPONENTS.md`](.decisions/UI_SSR_COMPONENTS.md): the `ui/core` component contract, `ui/controls` bound variants, the signal-binding seam, `cn`/`asClass`/`cva`
- [`UI_CLIENT_RUNTIME.md`](.decisions/UI_CLIENT_RUNTIME.md): browser-only mount controllers, signals, lazy loading, the htmx side-effect import, and the hard SSR boundary
- [`ASSET_AND_BUILD_TOOLING.md`](.decisions/ASSET_AND_BUILD_TOOLING.md): the asset pipeline, the content-hash manifest, the CLI framework, release tooling
- [`TESTING.md`](.decisions/TESTING.md): test placement, HTML-entity exact-match assertions, fakes over mocks, security-test requirements, the gate
- [`CODE_REVIEW.md`](.decisions/CODE_REVIEW.md): blocking invariants, a detection command per rule, severity calibration, known false positives

---

## Growth Rules

Add new code in the namespace its concern belongs to; follow the recipe in the governing doc —
never duplicate a capability that already exists.

| Adding… | Goes to | Recipe |
|---|---|---|
| Authentication (JWT, OAuth, session login), permissions/RBAC, API-key lifecycle | NEW `auth` namespace — identity is application-layer, never `security` | `NAMESPACE_DESIGN.md` §5a |
| CORS middleware, webhook signature verification | `security` — transport-layer request/response hardening only | `NAMESPACE_DESIGN.md` §5a, `SECURITY_HARDENING.md` §7 |
| SSR component | `ui/core` (markup only); client behaviour goes in `ui/client` | `NAMESPACE_DESIGN.md` §5b, `UI_SSR_COMPONENTS.md` |
| Browser controller, signal, or lazy-loaded resource | `ui/client` — never imported from a Worker-executed file | `UI_CLIENT_RUNTIME.md` §5 |
| Third pipeline-builder variant (beyond `definePage`/`defineAction`) | extract ALL pipeline builders into a NEW `handler` namespace | `NAMESPACE_DESIGN.md` §5c |
| HTTP output concern (response builders, header classes, HTML escaping, streaming) | `http` — never `@remix-run/headers`/`@remix-run/html-template` directly | `NAMESPACE_DESIGN.md` §5d |

---

## Source-of-Truth Register

**A rule lives in exactly one file. Everywhere else is a link.** Never put in prose what drifts —
signatures, constant values, step counts, file inventories. These files own the following facts;
cite them rather than restating them:

| Owns | File |
|---|---|
| Export subpath names | `package.json` `exports` |
| Verification gate steps | `scripts/lib/steps.ts` |
| Side-effectful modules | `package.json` `sideEffects` |
| CSRF and honeypot field names | `src/form/constants.ts` |
| Per-namespace export lists | `src/{ns}/mod.ts` |
| `lib` and `types` configuration | `tsconfig.json` |
| Bash allowlist patterns (incl. the exit-check literal) | `.claude/settings.local.json` `permissions.allow` |
| Barrel rules as *enforced* | `scripts/validate-exports.ts` + `scripts/barrel-parse.ts` |
| Declared cross-namespace dependency graph | `scripts/namespace-graph.ts` |
| That graph as *enforced* | `scripts/validate-namespace-graph.ts` + `scripts/namespace-graph-parse.ts` |
| Governing-doc format as *enforced* | `scripts/validate-docs.ts` |
| `@source` coverage as *enforced* | `scripts/validate-css-sources.ts` |

The barrel row names two files because the rule genuinely spans two. `validate-exports.ts` remains
the entry point and retains every policy decision — what fails, in what order, with what message —
while `barrel-parse.ts` holds the matchers it decides on (the star-ban regex among them). Stating
the split is more honest than naming the entry point alone and sending a reader to the wrong file.

The namespace-graph rows split three ways for the same reason, and the first is the unusual one:
`namespace-graph.ts` is *data*, and it is authoritative over the prose. `NAMESPACE_DESIGN.md` §4
cites it and enumerates nothing, because a second copy of a graph is indistinguishable from an
amendment the moment the two disagree. The enforcement then splits as the barrel row does —
`validate-namespace-graph.ts` owns the policy (what fails, the namespace set it derives from
`exports`, the guard that the enumeration has not returned), while `namespace-graph-parse.ts` owns
the matchers and the diff (which files are walked, how an import resolves to a namespace, how edge
kind is decided). A reader chasing "why is this an edge at all" wants the parser; one chasing "why
did this fail" wants the entry point, and naming only one would send half of them wrong.

---

## Type System

- `"types": []` — prevents auto-inclusion of any `@types/*` packages
- `.types/bun-test.d.ts` — the minimal `bun:test` module stub
- **Source files see:** `ESNext` + `DOM` + `DOM.Iterable` (standard Web APIs only)
- **Test files see:** the above plus `bun:test` via the stub
- Do NOT install or use `bun-types` — it overrides DOM's `fetch` type with Bun-specific
  properties, causing type errors in test fakes
