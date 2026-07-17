# CLAUDE.md — Architectural Constitution

> Namespace-based shared library for Cloudflare Workers.
> Ships raw TypeScript. No build step. Consumed via `@y-core/forge/{namespace}` export map.

---

## Behavioral Rules (always enforced)

- ONLY do what has been asked — recommend and get approval before any additions
- NEVER add runtime dependencies without approval
- NEVER use Bun-specific APIs in source files (only standard Web APIs)
- NEVER hardcode API keys, secrets, or credentials in source files
- ALWAYS add exports to the namespace's `mod.ts`
- ALWAYS co-locate tests (`*.test.ts` / `*.test.tsx`) with the source they test
- ALWAYS run local verification after changes (`bun run check`) — **delegate these runs to the verification agent (`cc-test`)**, never stream full gate output through a cc-plan or cc-dev agent. See _Verification Delegation_ under Toolchain.
- ALWAYS account for HTML-encoded entities in test assertions for HTML output
- ALWAYS enforce exact-match test assertions — never substring matching
- Use native `rg` (ripgrep) for content search and `find` for file search
- NEVER provide deprecation shims or backward-compatible patterns before v1.0.0

---

## Toolchain

| Tool | Role |
|---|---|
| `bun` | Package manager and test runner |
| `tsgo` (`@typescript/native-preview`) | Type checker |
| `biome` | Linter and formatter |

**Key commands:**

```bash
bun run check      # typecheck + lint + tests (full pipeline)
bun test           # run all tests
bun run lint:fix   # auto-fix lint/format issues
```

**Avoid:** `tsc` (use `tsgo`), `bun-types` (use custom stub), `eslint`/`prettier` (use `biome`).

### Verification Delegation

Local verification gates — `bun run check`, `bun test`, and standalone lint/type/`validate-exports`
runs — are **always delegated to the `cc-test` agent**, never run inline by `cc-plan` / `cc-dev`.
Gate output (type errors, failing-test dumps, lint noise) is high-volume; keeping it on cc-test
reserves cc-plan/cc-dev context for design and implementation. cc-test returns a terse verdict —
`✓ green`, or `✗` with the failing steps and the minimal error excerpt — **never the full
stream**; on failure cc-dev fixes and re-delegates rather than re-running the gate itself.
Enforced by convention today (a `PreToolUse` hook could make it deterministic).

---

## Architecture

Forge acts as a **facade** for its external dependencies (`valibot` via `validation`, `@remix-run/*` via `router` and `app`). The `jsx` namespace is an **in-house SSR runtime** — not a facade for any third-party JSX library. Consumers import from `@y-core/forge/{namespace}`, not from third-party packages directly.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests (`*.test.ts`/`*.test.tsx`).

**Leaf vs integration:** every namespace is either a **leaf** (zero cross-namespace forge imports —
own directory + external npm packages only) or an **integration** namespace (explicitly composes
across other forge namespaces). Classify before adding code; never introduce an undeclared
cross-namespace dependency. The authoritative catalog — all public export paths, internal
namespaces (e.g. `crypto`), and per-namespace classification — lives in
[`.decisions/NAMESPACE_DESIGN.md`](.decisions/NAMESPACE_DESIGN.md) (§3 catalog, §4 classification,
§6 new-namespace criteria).

For namespace placement, barrel rules, and growth recipes, consult the governing `.decisions/`
doc via the **Guide Index** — never duplicate that detail here.

---

## Guide Index

> Before writing code, consult the relevant governing document:

- [`AGENT_GUIDE.md`](.decisions/AGENT_GUIDE.md): document structure rules for tsmcp MCP efficiency
- [`LIBRARY_ARCHITECTURE.md`](.decisions/LIBRARY_ARCHITECTURE.md): facade pattern, runtime-only, Web-APIs-only, leaf vs integration dependency tiers
- [`NAMESPACE_DESIGN.md`](.decisions/NAMESPACE_DESIGN.md): mod.ts barrel rules, export * ban, no-sibling-barrel guard, authoritative 29-subpath catalog
- [`PRODUCTION_TS_RULES.md`](.decisions/PRODUCTION_TS_RULES.md): six rules — zero globals, Result monad, validation first, testability, TSDoc, declarative
- [`ROUTING_AND_MIDDLEWARE.md`](.decisions/ROUTING_AND_MIDDLEWARE.md): router namespace, middleware composition, context namespace
- [`HTMX.md`](.decisions/HTMX.md): isHxRequest, HX-* header readers/setters, hxAttrs, SWAP, formSubmit, liveSearch, OOB patterns
- [`SECURITY_HARDENING.md`](.decisions/SECURITY_HARDENING.md): createSecurityHeaders, CSP nonce, CORS, rate limit, origin guards, transport-layer boundary
- [`STRUCTURED_LOGGING.md`](.decisions/STRUCTURED_LOGGING.md): channels, requestLogger, KV log persistence, log viewer UI
- [`ERROR_HANDLING.md`](.decisions/ERROR_HANDLING.md): Result monad, fragment renderers, fail-closed posture, error taxonomy
- [`INPUT_VALIDATION.md`](.decisions/INPUT_VALIDATION.md): valibot v facade, form parsing, CSRF, honeypot, Turnstile
- [`STORAGE_BINDINGS.md`](.decisions/STORAGE_BINDINGS.md): D1 client, KV store, R2 object storage, binding resolve/validate pattern
- [`UI_COMPONENTS.md`](.decisions/UI_COMPONENTS.md): ui/core SSR components, ui/client browser controllers, HTMX sideEffect
- [`ASSET_AND_BUILD_TOOLING.md`](.decisions/ASSET_AND_BUILD_TOOLING.md): assets build pipeline, manifest, CLI framework, pkg release tooling
- [`TESTING.md`](.decisions/TESTING.md): bun test, co-located tests, HTML entity exact-match assertions, fakes, security tests, `@y-core/forge/testing` utilities (fakeKV/fakeD1/fakeR2, render, buildRequest, mapHandler)
- [`CODE_REVIEW.md`](.decisions/CODE_REVIEW.md): facade compliance, namespace boundaries, severity calibration, valid patterns

---

## Growth Rules

Add new code in the namespace its concern belongs to; follow the recipe in the governing doc —
never duplicate a capability that already exists.

| Adding… | Goes to | Recipe |
|---|---|---|
| Authentication (JWT, OAuth, session login), permissions/RBAC, API-key lifecycle | NEW `auth` namespace — identity is application-layer, never `security` | `NAMESPACE_DESIGN.md` §5a |
| CORS middleware, webhook signature verification | `security` (transport-layer request/response hardening only — no users, identities, or business logic) | `NAMESPACE_DESIGN.md` §5a, `SECURITY_HARDENING.md` |
| SSR component | `ui/core` (markup only); client-side behavior goes in `ui/client`; consumers always import from `@y-core/forge/ui` | `NAMESPACE_DESIGN.md` §5b, `UI_COMPONENTS.md` |
| Third pipeline-builder variant (beyond `definePage`/`defineAction`) | extract ALL pipeline builders into a NEW `handler` namespace | `NAMESPACE_DESIGN.md` §5c |
| HTTP output concern (response builders, header value classes, HTML escaping, `jsonResponse()`, streaming, content negotiation) | `http` — never `@remix-run/headers`/`@remix-run/html-template` directly | `NAMESPACE_DESIGN.md` §5d |

---

## tsmcp

Registered in `.mcp.json`. Available in all agents.

**Governance docs — in order:**
1. `mcp__tsmcp__decisions_list` — list all docs with section index (start here)
2. `mcp__tsmcp__decisions_search` — locate relevant sections by keyword
3. `mcp__tsmcp__decisions_read` — read a specific section: `section: "5a"` (not the full doc)

**TypeScript symbol navigation — in order:**
1. `mcp__tsmcp__lsp_workspace_symbols` — find types, functions, interfaces by name
2. `mcp__tsmcp__lsp_definition` — jump to the definition of a known symbol
3. `mcp__tsmcp__lsp_find_references` — find all callers / implementors
4. `mcp__tsmcp__lsp_document_symbols` — list all symbols in a specific file

**Behavioral rule:** NEVER use Bash `grep` or `Read` on `.decisions/` files when tsmcp is available. NEVER load a full `.decisions/` file via `Read` — always use the section-aware tools.

---

## Type System

- `"types": []` — prevents auto-inclusion of any `@types/*` packages
- `types/bun-test/index.d.ts` — minimal `bun:test` module stub (declares only `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `mock`)
- **Source files see:** ES2025 + DOM + DOM.Iterable (standard Web APIs only)
- **Test files see:** above + `bun:test` module (via custom stub)
- Do NOT install or use `bun-types` — it overrides DOM's `fetch` type with Bun-specific properties, causing type errors in test mocks
