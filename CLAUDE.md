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
| `tsgo` (`@typescript/native-preview`) | Type checker (10× faster than tsc) |
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

Namespace-based library. Each namespace is independently useful with no cross-namespace dependencies.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests (`*.test.ts`/`*.test.tsx`).

| Import path | Concern | Key exports |
|---|---|---|
| `@y-core/forge/app` | App bootstrapping & lifecycle | `createApp`, `definePage`, `defineAction`, `defineRoutes`, `createLogger`, `healthCheck`, `validateEnv`, `serveAssets` |
| `@y-core/forge/cookie` | HTTP cookie creation & signing | `createCookie`, `createSignedCookie` |
| `@y-core/forge/form` | Form field reading & bot detection | `readFields`, `readTextField`, `isHoneypotFilled`, `verifyTurnstile` |
| `@y-core/forge/headers` | Typed HTTP header value classes | `CacheControl`, `ContentType`, `SetCookie`, `Vary`, `Accept`, `Range`, etc. |
| `@y-core/forge/html` | HTML output primitives | `escapeHtml`, `html`, `renderSuccess`, `renderError`, `renderValidationErrors`, `htmlResponse` |
| `@y-core/forge/router` | Declarative route config | `route`, `index`, `layout`, `prefix`, `applyRoutes` |
| `@y-core/forge/security` | Security middleware & headers | `defineSecurity`, `makeSecurityHeaders`, `NONCE`, `csrfProtection`, `originGuard`, `rateLimit` |
| `@y-core/forge/session` | Session management & middleware | `sessionMiddleware`, `createCookieSessionStorage` |
| `@y-core/forge/ui` | Server-side JSX components | `Form`, `Field`, `Input`, `Textarea`, `Select`, `Button`, `Alert`, `Card`, `Separator` |
| `@y-core/forge/ui/client` | Browser-side UI scripts | `initNav`, `initThemeSwitch`, `loadScriptOnEvent`, `initTurnstile` |
| `@y-core/forge/validation` | Schema validation & result types | `v` (valibot re-export), `ValidationResult` |

---

## Type System

- `"types": []` — prevents auto-inclusion of any `@types/*` packages
- `types/bun-test/index.d.ts` — minimal `bun:test` module stub (declares only `describe`, `it`, `expect`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `mock`)
- **Source files see:** ES2025 + DOM + DOM.Iterable (standard Web APIs only)
- **Test files see:** above + `bun:test` module (via custom stub)
- Do NOT install or use `bun-types` — it overrides DOM's `fetch` type with Bun-specific properties, causing type errors in test mocks
