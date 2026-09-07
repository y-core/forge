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
  and the rare inline _why_, nothing else
  ([`CODE_RULES.md`](warden/canon/libs/CODE_RULES.md) §5)
- ALWAYS delete unbudgeted comments from any file you touch, routing rationale worth keeping to its
  single home ([`CODE_RULES.md`](warden/canon/libs/CODE_RULES.md) §5c)
- ALWAYS add new public symbols to the namespace's `mod.ts` as a named export
- ALWAYS co-locate tests (`*.test.ts` / `*.test.tsx`) with the source they test
- ALWAYS enforce exact-match test assertions accounting for HTML entities — never substring matching
- ALWAYS run local verification after changes — **the full gate goes to `cc-tester`**; a single scoped step is yours to run (see _Verification Delegation_)
- ALWAYS write for the reader, not the record — a governing document and a message to a person are
  both judged on whether their reader gets what they need, can find it, can understand it, and can
  act on it (`governance/PLAIN_LANGUAGE.md` §2). Lead with the outcome, match length to substance,
  and never compress away a caveat that would change what the reader does next
  (`governance/PLAIN_LANGUAGE.md` §3d, §8)
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
| --- | --- |
| `bun` | Package manager and test runner |
| `tsc` (`typescript` 7) | Type checker — the native compiler |
| `oxlint` | Linter, incl. type-aware rules (use instead of `eslint`) |
| `oxfmt` | Formatter and import sorter (use instead of `prettier`) |

```bash
bun run verify                 # the gate — the `standard` tier, what a task closes on
bun run verify:fast            # the inner loop (`verify --mode fast`) — typecheck, lint, format, test
bun run verify:full            # the release gate (`verify --full`) — everything, prerequisites included
bun run verify --only lint     # one step, for the dev loop (any step label)
bun run verify --list          # print the steps of the selected mode, run none
bun run lint                   # check only, never write (`verify --only lint`)
bun run fix                    # every step's fixer (`verify --fix`) — lint and format today
```

Gate philosophy, the three modes, and the flags: [`TESTING.md`](docs/TESTING.md) §6.
The step list itself is `config/steps.ts`.

**Avoid:** `bun-types` (use the custom stub), `eslint` (use `oxlint`), `prettier` (use `oxfmt`), `biome` (retired — use `oxfmt`).

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

**The full gate goes to `cc-tester`** — `bun run verify` and any cross-cutting suite. It returns a
terse verdict — `✓ green`, or `✗` with the failing step and a minimal excerpt — **never the full
stream**.

**The reason is context isolation, not distrust.** A gate stream is thousands of lines the owning
agent would otherwise carry for the rest of its turn, so the rule follows the size of the output
rather than the question of who may be trusted to read a result: cross-cutting or voluminous goes
to `cc-tester`; a single scoped step — `bun run verify --only lint`, or the one test file you just
wrote — is yours to run, because routing a handful of lines through a second agent buys nothing
([`PLAIN_LANGUAGE.md`](warden/canon/shared/PLAIN_LANGUAGE.md) §12). `cc-plan`, `cc-dev` and
`cc-doc` each run scoped steps on that basis, and `cc-test` smoke-runs the single test file it
just wrote. **A scoped green is never reported as a green gate**, whoever ran it.

On failure the **owning** agent fixes and re-delegates — the gate never re-runs inside the agent
that owns the fix, and `cc-tester` never edits the code it judges. The baseline it established
is part of its verdict.

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
cross-namespace dependency ([`NAMESPACE_DESIGN.md`](warden/canon/libs/NAMESPACE_DESIGN.md) §3).

For the namespace catalog, barrel rules, and growth recipes, consult the governing `docs/`
doc via the **Guide Index** — never duplicate that detail here.

---

## Guide Index

> Before writing code, consult the relevant governing document. Each begins with a
> `## 0. Quick Reference` listing every section, so you can pick a section without reading the
> whole file.
>
> **The canon is not in this table, and not on disk in a consumer.** The fleet's portable rules —
> AGENT_GUIDE, PLAIN_LANGUAGE, LIBRARY_ARCHITECTURE, NAMESPACE_DESIGN, CODE_RULES, BOUNDARIES,
> ERROR_HANDLING, TESTING, CODE_REVIEW — live in warden and are reached by search, not by path:
> the `knowledge_search`, `knowledge_read` and `knowledge_outline` MCP tools, or `warden show <id>`
> from a terminal. Forge is the canon's home, so here alone they are also readable under
> `warden/canon/`. Cite one in prose (`CODE_RULES.md §5c`), never by a path a consumer would not
> have.

- [`SOURCE_OF_TRUTH.md`](docs/SOURCE_OF_TRUTH.md): the register naming which file owns each fact, and the rows that name more than one file
- [`NAMESPACES.md`](docs/NAMESPACES.md): the authoritative subpath catalog, sealed-internal `crypto`, the foundational primitives, and forge's growth rulings
- [`LIBRARY_ARCHITECTURE.md`](docs/LIBRARY_ARCHITECTURE.md): what forge wraps and what it authors, the named build-time exemptions, the peer-dependency set, the `@source` scope
- [`ROUTING_AND_MIDDLEWARE.md`](docs/ROUTING_AND_MIDDLEWARE.md): declarative route maps and controllers, `definePage`/`defineAction`, middleware ordering, the `context` namespace
- [`HTMX.md`](docs/HTMX.md): the selector and JSON trust posture, why URL-valued and `hx-on:*` attributes are unsanitized, and the `isHxRequest` not-a-boundary ruling
- [`SECURITY_HARDENING.md`](docs/SECURITY_HARDENING.md): CSP nonce headers, CORS, origin-guard tiering, rate limiting, the `trustCfHeaders` trust boundary
- [`STRUCTURED_LOGGING.md`](docs/STRUCTURED_LOGGING.md): log channels and wrappers, `requestLogger`, KV persistence, the auth-gated log viewer
- [`ERROR_HANDLING.md`](docs/ERROR_HANDLING.md): the published `Result` signatures, the fragment renderers, the router error boundary's header guarantees, the `serveObject` exception
- [`INPUT_VALIDATION.md`](docs/INPUT_VALIDATION.md): the valibot `v` facade, form parsing and its byte cap, CSRF, honeypot, Turnstile
- [`STORAGE_BINDINGS.md`](docs/STORAGE_BINDINGS.md): D1, KV, and R2 clients, the resolve/validate binding pattern, dev degradation
- [`UI_SSR_COMPONENTS.md`](docs/UI_SSR_COMPONENTS.md): the `ui/core` component contract, `ui/controls` bound variants, the signal-binding seam
- [`UI_CLASS_COMPOSITION.md`](docs/UI_CLASS_COMPOSITION.md): `cn`/`cva`, the conflict table and its derivation, the `@utility` recipe layer, the colour-scheme declaration contract
- [`STATE_ATTRIBUTES.md`](docs/STATE_ATTRIBUTES.md): the `data-*` vocabulary a forge element emits — the state hooks both tiers share, the presentational enums, the island payload, the `data-slot` token, and the closed-world conformance sweep
- [`UI_CLIENT_RUNTIME.md`](docs/UI_CLIENT_RUNTIME.md): browser-only mount controllers, signals, lazy loading, the htmx side-effect import
- [`UI_DESIGN_GUIDANCE.md`](docs/UI_DESIGN_GUIDANCE.md): the `src/ui/design/` corpus — its Floor/Defaults tiers, the stable `forge-ui-` rule-id scheme, the anti-drift gate contract, the three-way doc boundary, and the dial defaults
- [`THEME_GENERATION.md`](docs/THEME_GENERATION.md): the dial model a colour scheme is generated from, the emission contract, and the audited contrast pairs the gate and the customiser share
- [`UI_SHOWCASE.md`](docs/UI_SHOWCASE.md): the `ui/show` surface — what an app supplies to mount it, and the coverage contract that fails the build when a published component has no demo
- [`ASSET_PIPELINE.md`](docs/ASSET_PIPELINE.md): the asset pipeline and its config, change detection, the content-hash manifest, the generated assets module
- [`BUILD_TOOLING.md`](docs/BUILD_TOOLING.md): the CLI framework, the published verification gate and its check contract, release tooling
- [`TESTING.md`](docs/TESTING.md): the two runners and the browser set, the security matrix row-to-test map, the `testing` namespace fixtures, the gate's flags
- [`CODE_REVIEW.md`](docs/CODE_REVIEW.md): forge's `detect:` commands with their real globs, the icon-prop rule, and the full do-not-flag table

---

## Growth Rules

Add new code in the namespace its concern belongs to; follow the recipe in the governing doc —
never duplicate a capability that already exists.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| Authentication (JWT, OAuth, session login), permissions/RBAC, API-key lifecycle | NEW `auth` namespace — identity is application-layer, never `security` | [`NAMESPACES.md`](docs/NAMESPACES.md) §5a |
| CORS middleware, webhook signature verification | `security` — transport-layer request/response hardening only | [`NAMESPACES.md`](docs/NAMESPACES.md) §5a, [`BOUNDARIES.md`](warden/canon/libs/BOUNDARIES.md) §2 |
| SSR component | `ui/core` (markup only); client behaviour goes in `ui/client` | [`NAMESPACES.md`](docs/NAMESPACES.md) §5b, [`UI_SSR_COMPONENTS.md`](docs/UI_SSR_COMPONENTS.md) |
| Browser controller, signal, or lazy-loaded resource | `ui/client` — never imported from a Worker-executed file | [`BOUNDARIES.md`](warden/canon/libs/BOUNDARIES.md) §1, [`UI_CLIENT_RUNTIME.md`](docs/UI_CLIENT_RUNTIME.md) §2 |
| Third pipeline-builder variant (beyond `definePage`/`defineAction`) | extract ALL pipeline builders into a NEW `handler` namespace | [`NAMESPACES.md`](docs/NAMESPACES.md) §5c |
| HTTP output concern (response builders, header classes, HTML escaping, streaming) | `http` — never `@remix-run/headers`/`@remix-run/html-template` directly | [`NAMESPACES.md`](docs/NAMESPACES.md) §5d |
| Design rule or UI anti-pattern (which component to reach for, what good looks like) | `src/ui/design/` — never `docs/` | [`UI_DESIGN_GUIDANCE.md`](docs/UI_DESIGN_GUIDANCE.md) §5a |
| Build-time module — ask "does this drive an external builder, or is it one?" | drives one → `src/tooling/assets`; **is** one → the namespace owning the artifact | [`ASSET_PIPELINE.md`](docs/ASSET_PIPELINE.md) §2c |
| Developer-facing tool — a command, a gate check, a lint rule, a release step | `src/tooling/{cli,term,gate,lint,release,cf,assets}` — never Worker-reachable | [`NAMESPACES.md`](docs/NAMESPACES.md) §4a |
