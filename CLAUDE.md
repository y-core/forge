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
- NEVER exceed the comment budget — one line of TSDoc per export, the `@public`/`@internal` tags,
  and the rare inline *why*, nothing else
  ([`PRODUCTION_TS_RULES.md`](.decisions/governance/PRODUCTION_TS_RULES.md) §5)
- ALWAYS delete unbudgeted comments from any file you touch, routing rationale worth keeping to its
  single home ([`PRODUCTION_TS_RULES.md`](.decisions/governance/PRODUCTION_TS_RULES.md) §5c)
- ALWAYS add new public symbols to the namespace's `mod.ts` as a named export
- ALWAYS co-locate tests (`*.test.ts` / `*.test.tsx`) with the source they test
- ALWAYS enforce exact-match test assertions accounting for HTML entities — never substring matching
- ALWAYS run local verification after changes — **delegate every gate run to `cc-tester`** (see _Verification Delegation_)
- ALWAYS report a command's exit status with the one canonical suffix — never a variant (see _Shell Exit Checks_)
- ALWAYS reach the ledger over MCP, and never work from a remembered copy of its rules — the tool descriptions and the refusals carry them, and a refusal is acted on rather than guessed past (see _Ledger Maintenance_)
- Use `rg` for content search and `find` for file search

---

## Code Intelligence

When tracing where a symbol is defined or finding all references to
it, use LSP (goToDefinition, findReferences, hover) instead of Grep.
LSP gives exact results; Grep gives text matches.

Use Grep/Glob for discovery (finding files, searching patterns). Use
LSP for understanding (definitions, references, type info).

After locating a file with Grep/Glob, use LSP to navigate within it
rather than reading the whole file.

---

## Ledger

ledger tasks are tracked in the task-forge ledger via the `ledger` MCP tools.
Scope is a property of the URL, so no tool takes a `project` argument.

- Move a task to `doing` when you start it; call again only when its state
  actually changes, never to narrate progress.
- A read carries the `revision` a later edit must cite — read before you write.
- Record the resolution with, or before, the move to `done`.
- On a refusal, act on the payload: `rule` names what was applied, `requires`
  names the arguments to add, `retryable` says whether the call could succeed.

---

## Toolchain

| Tool | Role |
|---|---|
| `bun` | Package manager and test runner |
| `tsgo` (`@typescript/native-preview`) | Type checker (use instead of `tsc`) |
| `biome` | Linter and formatter (use instead of `eslint`/`prettier`) |

```bash
bun run verify                 # the gate — every step must pass
bun run verify --only lint     # one step, for the dev loop (any step label)
bun run verify --list          # print the steps, run none
bun run verify:full            # the release gate — adds the steps needing a machine prerequisite
bun run lint                   # check only, never write (`verify --only lint`)
bun run fix                    # every step's fixer (`verify --fix`) — lint is the only one today
```

Gate philosophy, the modes, and the flags: [`TESTING.md`](.decisions/implementation/TESTING.md) §6.
The step list itself is `config/steps.ts`.

**Avoid:** `tsc` (use `tsgo`), `bun-types` (use the custom stub), `eslint`/`prettier` (use `biome`).

### Shell Exit Checks

When a command's exit status must be stated explicitly, append **exactly** this suffix — same
spelling, same casing, same quoting, every time:

```bash
<command>; echo "EXIT:$?"
```

- Use `;`, never `&&` — with `&&` the echo is skipped precisely when the command fails, which is
  the only case worth checking.
- Never pipe within the same statement: `bun run verify | tail -20; echo "EXIT:$?"` reports `tail`'s
  status, not the gate's. Redirect first, then inspect the file:
  `bun run verify > /tmp/verify.log 2>&1; echo "EXIT:$?"`.
- Never invent a variant — `exit=$?`, `RC=$?`, `---EXIT CODE $?---`, or a re-quoted spelling all
  miss the allowlist and cost a fresh permission prompt each time.
- Omit the suffix when the exit code is not actually in question; a bare failing command already
  surfaces its status. The suffix exists for the cases where that signal would otherwise be lost.

The matching allow rule is an **exact-string** entry (no `:*` prefix wildcard) in
`.claude/settings.local.json` — deviating by one character is what turns a silent run into a prompt.

### Verification Delegation

**`cc-tester` is the sole runner** of `bun run verify` and any cross-cutting suite. It returns a
terse verdict — `✓ green`, or `✗` with the failing step and a minimal excerpt — **never the full
stream**. `cc-plan`, `cc-dev`, and `cc-doc` delegate every gate run to it; `cc-test` may smoke-run
only the single test file it just wrote.

On failure the **owning** agent fixes and re-delegates — the gate never re-runs inside the agent
that owns the fix, and `cc-tester` never edits the code it judges.

`cc-tester` declares a `tools:` allowlist without `Write`/`Edit`, but **enforcement is not
guaranteed**. Treat the whole split as convention: every agent obeys its stated boundaries because
it is told to, not because a mechanism stops it. No hook enforces the routing either — a decision,
not an omission.

---

## Architecture

Forge is a **facade** over its external dependencies (`valibot` via `validation`, `@remix-run/*`
via `router`, `app`, `http`, and `session`). The `jsx` namespace is an **in-house SSR runtime**,
not a facade for any third-party library. Consumers import from `@y-core/forge/{namespace}`, never
from a wrapped package directly.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests.

**Leaf vs integration:** classify a namespace before adding code, and never introduce an undeclared
cross-namespace dependency ([`NAMESPACE_DESIGN.md`](.decisions/governance/NAMESPACE_DESIGN.md) §3).

For the namespace catalog, barrel rules, and growth recipes, consult the governing `.decisions/`
doc via the **Guide Index** — never duplicate that detail here.

---

## Guide Index

> Before writing code, consult the relevant governing document. Each begins with a
> `## 0. Quick Reference` listing every section, so you can pick a section without reading the
> whole file.
>
> **Two tables, two directories.** `governance/` holds the portable rules shared with every forge
> sibling and is overwritten on sync; `implementation/` holds forge's own catalog and rulings and
> is never touched by a sync ([`AGENT_GUIDE.md`](.decisions/governance/AGENT_GUIDE.md) §6d). Both
> tables must agree with their directory in both directions.

### Governance — portable, overwrite-on-sync

- [`AGENT_GUIDE.md`](.decisions/governance/AGENT_GUIDE.md): how `.decisions/` docs are structured, numbered, sized, and cross-referenced; the governance/implementation boundary; the single-home rule
- [`LIBRARY_ARCHITECTURE.md`](.decisions/governance/LIBRARY_ARCHITECTURE.md): the dependency facade, the runtime-only no-build-step constraint, demand composition, Web-APIs-only, the Workers isolate model
- [`NAMESPACE_DESIGN.md`](.decisions/governance/NAMESPACE_DESIGN.md): barrel discipline and the `export *` ban, the no-sibling-barrel rule, leaf/integration classification, naming conventions, when to add a namespace
- [`PRODUCTION_TS_RULES.md`](.decisions/governance/PRODUCTION_TS_RULES.md): six coding rules — zero global state, explicit errors, validation first, testability, **the comment budget (§5 — the ceiling on prose)**, declarative style
- [`BOUNDARIES.md`](.decisions/governance/BOUNDARIES.md): SSR versus browser, transport versus application security, validate-at-boundary, no-PII logging, fail-closed
- [`ERROR_HANDLING.md`](.decisions/governance/ERROR_HANDLING.md): the one `Result` primitive, failures crossing a boundary, rendering a failure, the error taxonomy
- [`TESTING.md`](.decisions/governance/TESTING.md): co-location, exact-match assertions, fakes over mocks, security-test requirements, the one-command-two-modes gate
- [`CODE_REVIEW.md`](.decisions/governance/CODE_REVIEW.md): blocking invariants, tiered detection with a command per rule, severity calibration, known false positives

### Implementation — forge only

- [`SOURCE_OF_TRUTH.md`](.decisions/implementation/SOURCE_OF_TRUTH.md): the register naming which file owns each fact, and the rows that name more than one file
- [`NAMESPACES.md`](.decisions/implementation/NAMESPACES.md): the authoritative subpath catalog, sealed-internal `crypto`, the foundational primitives, and forge's growth rulings
- [`LIBRARY_ARCHITECTURE.md`](.decisions/implementation/LIBRARY_ARCHITECTURE.md): what forge wraps and what it authors, the named build-time exemptions, the peer-dependency set, the `@source` scope
- [`ROUTING_AND_MIDDLEWARE.md`](.decisions/implementation/ROUTING_AND_MIDDLEWARE.md): declarative route maps and controllers, `definePage`/`defineAction`, middleware ordering, the `context` namespace
- [`HTMX.md`](.decisions/implementation/HTMX.md): the selector and JSON trust posture, why URL-valued and `hx-on:*` attributes are unsanitized, and the `isHxRequest` not-a-boundary ruling
- [`SECURITY_HARDENING.md`](.decisions/implementation/SECURITY_HARDENING.md): CSP nonce headers, CORS, origin-guard tiering, rate limiting, the `trustCfHeaders` trust boundary
- [`STRUCTURED_LOGGING.md`](.decisions/implementation/STRUCTURED_LOGGING.md): log channels and wrappers, `requestLogger`, KV persistence, the auth-gated log viewer
- [`ERROR_HANDLING.md`](.decisions/implementation/ERROR_HANDLING.md): the published `Result` signatures, the fragment renderers, the router error boundary's header guarantees, the `serveObject` exception
- [`INPUT_VALIDATION.md`](.decisions/implementation/INPUT_VALIDATION.md): the valibot `v` facade, form parsing and its byte cap, CSRF, honeypot, Turnstile
- [`STORAGE_BINDINGS.md`](.decisions/implementation/STORAGE_BINDINGS.md): D1, KV, and R2 clients, the resolve/validate binding pattern, dev degradation
- [`UI_SSR_COMPONENTS.md`](.decisions/implementation/UI_SSR_COMPONENTS.md): the `ui/core` component contract, `ui/controls` bound variants, the signal-binding seam, `cn`/`asClass`/`cva`
- [`UI_CLIENT_RUNTIME.md`](.decisions/implementation/UI_CLIENT_RUNTIME.md): browser-only mount controllers, signals, lazy loading, the htmx side-effect import
- [`UI_DESIGN_GUIDANCE.md`](.decisions/implementation/UI_DESIGN_GUIDANCE.md): the `src/ui/design/` corpus — its Floor/Defaults tiers, the stable `forge-ui-` rule-id scheme, the anti-drift gate contract, the three-way doc boundary, and the dial defaults
- [`THEME_GENERATION.md`](.decisions/implementation/THEME_GENERATION.md): the dial model a colour scheme is generated from, the emission contract, and the audited contrast pairs the gate and the customiser share
- [`UI_SHOWCASE.md`](.decisions/implementation/UI_SHOWCASE.md): the `ui/show` surface — what an app supplies to mount it, and the coverage contract that fails the build when a published component has no demo
- [`ASSET_AND_BUILD_TOOLING.md`](.decisions/implementation/ASSET_AND_BUILD_TOOLING.md): the asset pipeline, the content-hash manifest, the CLI framework, release tooling
- [`TESTING.md`](.decisions/implementation/TESTING.md): the two runners and the browser set, the security matrix row-to-test map, the `testing` namespace fixtures, the gate's flags
- [`CODE_REVIEW.md`](.decisions/implementation/CODE_REVIEW.md): forge's `detect:` commands with their real globs, the icon-prop rule, and the full do-not-flag table

---

## Growth Rules

Add new code in the namespace its concern belongs to; follow the recipe in the governing doc —
never duplicate a capability that already exists.

| Adding… | Goes to | Recipe |
|---|---|---|
| Authentication (JWT, OAuth, session login), permissions/RBAC, API-key lifecycle | NEW `auth` namespace — identity is application-layer, never `security` | [`NAMESPACES.md`](.decisions/implementation/NAMESPACES.md) §5a |
| CORS middleware, webhook signature verification | `security` — transport-layer request/response hardening only | [`NAMESPACES.md`](.decisions/implementation/NAMESPACES.md) §5a, [`BOUNDARIES.md`](.decisions/governance/BOUNDARIES.md) §2 |
| SSR component | `ui/core` (markup only); client behaviour goes in `ui/client` | [`NAMESPACES.md`](.decisions/implementation/NAMESPACES.md) §5b, [`UI_SSR_COMPONENTS.md`](.decisions/implementation/UI_SSR_COMPONENTS.md) |
| Browser controller, signal, or lazy-loaded resource | `ui/client` — never imported from a Worker-executed file | [`BOUNDARIES.md`](.decisions/governance/BOUNDARIES.md) §1, [`UI_CLIENT_RUNTIME.md`](.decisions/implementation/UI_CLIENT_RUNTIME.md) §2 |
| Third pipeline-builder variant (beyond `definePage`/`defineAction`) | extract ALL pipeline builders into a NEW `handler` namespace | [`NAMESPACES.md`](.decisions/implementation/NAMESPACES.md) §5c |
| HTTP output concern (response builders, header classes, HTML escaping, streaming) | `http` — never `@remix-run/headers`/`@remix-run/html-template` directly | [`NAMESPACES.md`](.decisions/implementation/NAMESPACES.md) §5d |
| Design rule or UI anti-pattern (which component to reach for, what good looks like) | `src/ui/design/` — never `.decisions/` | [`UI_DESIGN_GUIDANCE.md`](.decisions/implementation/UI_DESIGN_GUIDANCE.md) §5a |
