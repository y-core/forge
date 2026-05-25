# CLAUDE.md — Architectural Constitution

> Namespace-based shared library for Hono + Cloudflare Workers.
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

Forge acts as a **facade** for its external dependencies (`hono/jsx` via `jsx`, `valibot` via `validation`, `@remix-run/*` via `session` and `http`). Consumers import from `@y-core/forge/{namespace}`, not from third-party packages directly.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests (`*.test.ts`/`*.test.tsx`).

### Namespace classification

**Leaf namespaces** (zero cross-namespace dependencies): `cli`, `form`, `http`, `jsx`, `logging`, `result`, `router`, `session`, `ui/client`, `validation`

**Integration namespaces** (compose across other namespaces):
- `app` — imports from `form`, `http`, `logging`, `result`, `router`, `security`, `validation`
- `security` — imports from `form` (parseFormData, ReadonlyFormData, constants), `logging` (createLogger in rate-limit)
- `ui/core` — imports from `form` (CSRF/honeypot field name constants)
- `pkg` — imports from `cli`

### Namespace map (13 namespaces)

| Import path | Category | Concern | Key exports |
|---|---|---|---|
| `@y-core/forge/app` | Integration | App bootstrap & lifecycle | `createApp`, `definePage`, `defineAction`, `healthCheck`, `validateEnv`, `serveAssets` |
| `@y-core/forge/cli` | Leaf | CLI command framework | `createCommand`, `parseArgs`, `execute` |
| `@y-core/forge/form` | Leaf | Form parsing & field conventions | `readFields`, `parseFormData`, `isHoneypotFilled`, `verifyTurnstile`, `CSRF_FIELD_DEFAULT`, `HONEYPOT_FIELD_DEFAULT` |
| `@y-core/forge/http` | Leaf | HTTP output — responses, headers, escaping | `html`, `escapeHtml`, `htmlResponse`, `renderSuccess`, `renderError`, `CacheControl`, `ContentType`, `Accept`, `SetCookie`, `Vary`, etc. |
| `@y-core/forge/jsx` | Leaf | JSX runtime (facade for hono/jsx) | `Fragment`, `createContext`, `useContext`, `memo`, `FC`, `JSX` |
| `@y-core/forge/logging` | Leaf | Structured logging | `createLogger`, `consoleChannel` |
| `@y-core/forge/pkg` | Integration | Release & versioning tooling | `createReleaseCommand`, `parseSemVer`, `bumpSemVer` |
| `@y-core/forge/result` | Leaf | Result monad | `result`, `toError`, `Result` |
| `@y-core/forge/router` | Leaf | Declarative route config | `route`, `index`, `layout`, `prefix`, `applyRoutes` |
| `@y-core/forge/security` | Integration | Transport-layer request hardening | `defineSecurity`, `makeSecurityHeaders`, `NONCE`, `csrfProtection`, `originGuard`, `rateLimit` |
| `@y-core/forge/session` | Leaf | Session + cookie management | `sessionMiddleware`, `createCookieSessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/ui` | Integration | Server-side JSX components | `Form`, `Field`, `Input`, `Button`, `Alert`, `Card`, `Icon`, `Select` |
| `@y-core/forge/ui/client` | Leaf | Browser-side UI scripts | `mountNav`, `mountTheme`, `lazy`, `createSignal`, `mountTurnstile` |
| `@y-core/forge/validation` | Leaf | Schema validation (facade for valibot) | `v`, `ValidationResult` |

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

`app` contains bootstrap and lifecycle (`createApp`, `resolveBindings`, `validateEnv`, `healthCheck`, `serveAssets`). The `definePage`/`defineAction` functions are pipeline builders. If a third pipeline variant is needed, extract all pipeline builders into a new `handler` namespace.

### `http` — all HTTP output concerns

`http` is the canonical source for response builders, header value classes, and HTML escaping. Future additions: `jsonResponse()`, streaming utilities, content negotiation. Consumers import from `@y-core/forge/http`, not from `@remix-run/headers` or `hono/html` directly.

---

## Type System

- `"types": []` — prevents auto-inclusion of any `@types/*` packages
- `types/bun-test/index.d.ts` — minimal `bun:test` module stub (declares only `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `mock`)
- **Source files see:** ES2025 + DOM + DOM.Iterable (standard Web APIs only)
- **Test files see:** above + `bun:test` module (via custom stub)
- Do NOT install or use `bun-types` — it overrides DOM's `fetch` type with Bun-specific properties, causing type errors in test mocks
