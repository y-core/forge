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
- ALWAYS run `bun run check` after changes
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

---

## Architecture

Forge acts as a **facade** for its external dependencies (`valibot` via `validation`, `@remix-run/*` via `router` and `app`). The `jsx` namespace is an **in-house SSR runtime** — not a facade for any third-party JSX library. Consumers import from `@y-core/forge/{namespace}`, not from third-party packages directly.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests (`*.test.ts`/`*.test.tsx`).

### Namespace classification

**Leaf namespaces** (zero cross-namespace dependencies): `assets/build`, `assets/manifest`, `cli`, `config`, `form`, `html/htmx`, `http`, `jsx`, `logging`, `result`, `router`, `session`, `ui/client`, `validation`

**Integration namespaces** (compose across other namespaces):
- `app` — imports from `form`, `http`, `logging`, `result`, `router`, `security`, `validation`
- `assets` — imports from `validation` (schema and type definitions in `config.ts` / `types.ts`)
- `security` — imports from `logging` (createLogger in rate-limit)
- `ui/core` — imports from `form` (CSRF/honeypot field name constants)
- `ui/server` — imports from `html/htmx` (oobAppend for flash OOB rendering) and `ui/core` (Toast for toastOob)
- `pkg` — imports from `cli`
- `testing` — imports from `app` (ConfigKey, AssetsFetcher), `context`, `form` (CSRF primitives), `logging` (requestLog, Logger), `storage/kv` (KVNamespace types); test-code-only utilities

### Namespace map (25 public namespaces)

| Import path | Category | Concern |
|---|---|---|
| `@y-core/forge/app` | Integration | App bootstrap & lifecycle |
| `@y-core/forge/assets` | Integration | Asset config & metadata |
| `@y-core/forge/assets/build` | Leaf | Asset build pipeline |
| `@y-core/forge/assets/manifest` | Leaf | Manifest reading & sprite registry |
| `@y-core/forge/cli` | Leaf | CLI command framework |
| `@y-core/forge/config` | Leaf | Environment config resolution |
| `@y-core/forge/context` | Leaf | `contextVar`, `RequestContext`, `AppContext`, `Middleware` |
| `@y-core/forge/form` | Leaf | Form parsing, CSRF & bot detection |
| `@y-core/forge/html/htmx` | Leaf | HTMX detection, request readers, `hxHeaders` builder, attrs, patterns |
| `@y-core/forge/http` | Leaf | HTTP output — responses, headers, escaping |
| `@y-core/forge/jsx` | Leaf | JSX runtime (in-house SSR, not a React facade) |
| `@y-core/forge/logging` | Leaf | Structured logging |
| `@y-core/forge/logging/show` | Integration | Log viewer route + UI components |
| `@y-core/forge/pkg` | Integration | Release & versioning tooling |
| `@y-core/forge/result` | Leaf | Result monad |
| `@y-core/forge/router` | Leaf | Declarative route config |
| `@y-core/forge/security` | Integration | Transport-layer request hardening |
| `@y-core/forge/session` | Leaf | Session + cookie management |
| `@y-core/forge/storage/db` | Leaf | D1 database client |
| `@y-core/forge/storage/kv` | Leaf | Workers KV typed store |
| `@y-core/forge/storage/r2` | Leaf | R2 object storage |
| `@y-core/forge/testing` | Integration | Shared test utilities (test code only) |
| `@y-core/forge/ui` | Integration | Server-side JSX components |
| `@y-core/forge/ui/client` | Leaf | Browser-side UI scripts |
| `@y-core/forge/ui/server` | Integration | Flash messages, ThemeToggle, Resumable, toast OOB |
| `@y-core/forge/validation` | Leaf | Schema validation (facade for valibot) |

**Internal namespaces** (no public export path — never import from outside forge):
- `crypto` (`src/crypto/`) — HMAC/timing-safe utilities (`@internal`) — used by `form`, `security`, `session`

**Removed from earlier tables:** `timingSafeEqual`/`timingSafeEqualBytes` (moved to `@internal` `crypto` module); `isHxRequest` moved from `security` to `html/htmx`.

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
- [`TESTING.md`](.decisions/TESTING.md): bun test, co-located tests, HTML entity exact-match assertions, fakes, security tests
- [`CODE_REVIEW.md`](.decisions/CODE_REVIEW.md): facade compliance, namespace boundaries, severity calibration, valid patterns

---

## Growth rules

### `security` — transport-layer hardening only

`security` is **transport-layer request/response hardening**. It does not know about users, identities, or business logic.

| Future feature | Belongs in | Rationale |
|---|---|---|
| Authentication (JWT, OAuth, session login) | NEW: `auth` | Application-layer identity, not transport hardening |
| Permissions / RBAC | NEW: `auth` | Identity-aware access control |
| CORS middleware | `security` | Transport-layer cross-origin policy |
| Webhook signature verification | `security` | Request integrity verification |
| API key management | NEW: `auth` | Identity/credential lifecycle |

### `ui/core` — SSR-only components

Components requiring client-side JS export only SSR markup from `ui/core`; client behavior goes in `ui/client`. If component count exceeds ~25, introduce sub-barrels (`ui/core/form/mod.ts`) but do NOT split the export map path — consumers always import from `@y-core/forge/ui`.

### `app` — bootstrap and pipeline builders

`app` contains bootstrap and lifecycle (`createApp`, `validateBindings`, `validateEnv`, `healthCheck`, `serveAssets`). The `definePage`/`defineAction` functions are pipeline builders. If a third pipeline variant is needed, extract all pipeline builders into a new `handler` namespace.

### `http` — all HTTP output concerns

`http` is the canonical source for response builders, header value classes, and HTML escaping. Future additions: `jsonResponse()`, streaming utilities, content negotiation. Consumers import from `@y-core/forge/http`, not from `@remix-run/headers` or `@remix-run/html-template` directly.

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

| Tool | Use |
|------|-----|
| `mcp__tsmcp__decisions_list` | List governing docs with section index — start here |
| `mcp__tsmcp__decisions_read` | Read a doc or a specific section (`section: "5a"`) |
| `mcp__tsmcp__decisions_search` | Search all governing docs by keyword |
| `mcp__tsmcp__lsp_workspace_symbols` | Find types, functions, interfaces by name (indexed, fast) |
| `mcp__tsmcp__lsp_find_references` | All callers / all implementors |
| `mcp__tsmcp__lsp_definition` | Jump to any symbol definition |
| `mcp__tsmcp__lsp_document_symbols` | List symbols in a TypeScript file by path |

---

## Type System

- `"types": []` — prevents auto-inclusion of any `@types/*` packages
- `types/bun-test/index.d.ts` — minimal `bun:test` module stub (declares only `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `mock`)
- **Source files see:** ES2025 + DOM + DOM.Iterable (standard Web APIs only)
- **Test files see:** above + `bun:test` module (via custom stub)
- Do NOT install or use `bun-types` — it overrides DOM's `fetch` type with Bun-specific properties, causing type errors in test mocks
