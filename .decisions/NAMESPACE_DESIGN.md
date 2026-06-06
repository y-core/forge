---
title: Namespace Design
description: "barrel exports, mod.ts pattern, export star ban, namespace catalog, validate-exports gate, sibling-barrel guard, biome import rule, growth rules, namespace classification, no circular dependencies, when to add namespace"
weight: 15
---

# Namespace Design

> Authoritative source for how forge's 25 export subpaths are structured, how barrels
> are maintained, what guards prevent circular dependencies, and when to add a namespace.
>
> Complements [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) (dependency tiers),
> [PRODUCTION_TS_RULES.md](./PRODUCTION_TS_RULES.md) (coding rules).

---

## 0. Quick Reference

- §1 Barrel rules: mod.ts is the only barrel; export * is banned; validate-exports gate
- §2 No-sibling-barrel rule: the biome.json guard that prevents circular deps
- §3 Namespace catalog: all 25 package.json subpaths with source locations
- §4 Leaf vs integration: classification table
- §5 Growth rules: when/how to add namespaces (security→auth, app→handler, etc.)
- §6 When to add a namespace: criteria and checklist

---

## 1. Barrel Rules and Export Discipline

### 1a. mod.ts Barrel Convention

Every namespace has exactly one barrel file: `src/{name}/mod.ts`. This is the only file
listed in `package.json` `"exports"`. All public API flows through `mod.ts`.

Rules:
- `mod.ts` uses named exports only (never `export * from ...`)
- Every new symbol added to the namespace MUST be added to `mod.ts`
- `mod.ts` imports from concrete files, not from other `mod.ts` barrels

### 1b. Export Star Ban

`export * from './foo'` is banned. It creates:
- Uncontrolled public surface (internal symbols leak)
- Circular dependency risks
- Opaque public API (grep can't show what's exported)

This is enforced by `scripts/validate-exports.ts` (run as part of `bun run check`).

### 1c. validate-exports Gate

`scripts/validate-exports.ts` verifies:
- Every subpath in `package.json` `"exports"` maps to a real file
- No orphaned export paths
- All `mod.ts` files actually export something

Run with: `bun run validate-exports` (included in `bun run check`)

---

## 2. No-Sibling-Barrel Import Rule

### 2a. Biome Import Guard

`biome.json` enforces this rule via `noRestrictedImports`:
Pattern: `../**/mod` imports are banned, with two exemptions: `validation/mod` and `crypto/mod`

Error message: "Import the concrete source file, not a sibling module's mod.ts barrel —
barrel imports risk circular dependencies. validation/crypto facades are exempt."

### 2b. Why Sibling Barrels Are Forbidden

When `src/security/` imports `src/form/mod.ts` (sibling barrel), any future import in
`form/mod.ts` that reaches back into `security` creates a circular dependency. Importing
concrete files (`src/form/csrf.ts`) makes the dependency explicit and bounded.

### 2c. The validation and crypto Exemptions

- `validation/mod.ts` is the valibot facade — all of forge uses `v` for validation schemas
- `crypto/mod.ts` is an `@internal` utility module — form, security, session all need it

These two are exempted because they are shared utilities without circular risk.

---

## 3. Authoritative Namespace Catalog

### 3a. Public Export Paths (all 28 from package.json)

| Export Path | Source | Category | Key Exports |
|---|---|---|---|
| `@y-core/forge/app` | `src/app/mod.ts` | Integration | `createApp`, `applyAssets`, `validateBindings`, `validateEnv`, `healthCheck`, `definePage`, `defineAction`, `renderWith`, `Renderer`, `AnyRenderer` |
| `@y-core/forge/assets` | `src/assets/mod.ts` | Integration | `defineAssetsConfig`, `loadConfig`, `AssetsConfig`, `AssetsConfigSchema` |
| `@y-core/forge/assets/build` | `src/assets/build/mod.ts` | Leaf | `buildAll`, `generateManifest`, `buildCSS`, `buildJS`, `buildSprites`, `copyAssets` |
| `@y-core/forge/assets/manifest` | `src/assets/manifest/mod.ts` | Leaf | `createManifest`, `createSpriteRegistry` |
| `@y-core/forge/cli` | `src/cli/mod.ts` | Leaf | `createCommand`, `addCommand`, `parseArgs`, `execute`, `CliError` |
| `@y-core/forge/config` | `src/config/mod.ts` | Leaf | `Config`, `env`, `applyMapping`, `optionalGroup`, `resolveConfig` |
| `@y-core/forge/context` | `src/context/mod.ts` | Leaf | `contextVar`, `createContextKey`, `RequestContext`, `EnvKey`, `ExecutionContextKey`; types `AppContext`, `Middleware`, `RequestHandler`, `ContextKey`, `ContextVar` |
| `@y-core/forge/form` | `src/form/mod.ts` | Leaf | `readFields`, `parseFormData`, `csrfProtection`, `importCsrfKey`, `mintCsrf`, `createCsrfToken`, `isHoneypotFilled`, `verifyTurnstile`, `CsrfConfigSchema`, `TurnstileConfigSchema` |
| `@y-core/forge/http` | `src/http/mod.ts` | Leaf | `html`, `escapeHtml`, `htmlResponse`, `renderError`, `renderSuccess`, `renderValidationErrors`, `CacheControl`, `ContentType`, `SetCookie`, `Vary` |
| `@y-core/forge/jsx-runtime` | `src/jsx/jsx-runtime.ts` | Leaf | JSX runtime (alias) |
| `@y-core/forge/jsx-dev-runtime` | `src/jsx/jsx-dev-runtime.ts` | Leaf | JSX dev runtime (alias) |
| `@y-core/forge/jsx/jsx-dev-runtime` | `src/jsx/jsx-dev-runtime.ts` | Leaf | JSX dev runtime (alias) |
| `@y-core/forge/logging` | `src/logging/mod.ts` | Leaf | `createLogger`, `consoleChannel`, `kvLogChannel`, `requestLogger`, `requestLog` |
| `@y-core/forge/logging/http` | `src/logging/http/mod.ts` | Integration | `logViewer`, `readLogs`, `LogFilterBar`, `LogLevelBadge`, `LogTable`, `LogTableBody` |
| `@y-core/forge/pkg` | `src/pkg/mod.ts` | Integration | `createReleaseCommand`, `parseSemVer`, `bumpSemVer`, `formatSemVer` |
| `@y-core/forge/render` | `src/jsx/render-to-string.ts` | Leaf | `renderToString` — renders a forge JSX tree to a `SafeHtml` string |
| `@y-core/forge/result` | `src/result/mod.ts` | Leaf | `result`, `toError`, `Result`, `ValidationResult` |
| `@y-core/forge/router` | `src/router/mod.ts` | Leaf | re-exports fetch-router: `route`, `createController`, `createAction`, `createRouter`, `createContextKey`, `RequestContext`, `get`/`post`/`put`/`patch`/`del`, `resource`, `createHref`; types `Controller`, `Middleware`, `RequestHandler`, `RouteMap` |
| `@y-core/forge/security` | `src/security/mod.ts` | Integration | `makeSecurityHeaders`, `mergeSecurityHeaders`, `NONCE`, `requestId`, `requestIdCtx`, `isHxRequest`, `requireFormContentType`, `cors`, `crossOriginProtection`, `originGuard`, `verifyOrigin`, `rateLimit`, `BaseUrlConfigSchema` |
| `@y-core/forge/session` | `src/session/mod.ts` | Leaf | `sessionMiddleware`, `createCookieSessionStorage`, `createMemorySessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/storage/db` | `src/storage/db/mod.ts` | Leaf | `createD1Client`, `resolveD1Client`, `validateD1Binding`, `sql`, `isSqlFragment` |
| `@y-core/forge/storage/kv` | `src/storage/kv/mod.ts` | Leaf | `createKVStore`, `resolveKVStore`, `validateKVBinding`, `jsonCodec`, `textCodec`, `bytesCodec` |
| `@y-core/forge/storage/r2` | `src/storage/r2/mod.ts` | Leaf | `createObjectStore`, `resolveObjectStore`, `validateR2Binding`, `serveObject`, `createSignedObjectUrl`, `importSigningKey` |
| `@y-core/forge/ui` | `src/ui/mod.ts` | Integration | `Form`, `Field`, `FieldLabel`, `Input`, `Textarea`, `Select`, `Button`, `Alert`, `Card`, `Icon`, `cn`, `cva` |
| `@y-core/forge/ui/client` | `src/ui/client/mod.ts` | Leaf | `mountNav`, `mountTheme`, `mountTurnstile`, `lazy`, `createSignal`, `computed`, `effect`, `FOUC_SCRIPT` |
| `@y-core/forge/ui/client/htmx` | `src/ui/client/htmx.ts` | Leaf (sideEffect) | htmx bundle (import only for side effect) |
| `@y-core/forge/ui/server` | `src/ui/server/mod.ts` | Leaf | `Flash`, `FlashContainer`, `FlashOob`, `createFlash`, `hxAttrs`, HTMX header helpers (`hxTrigger`, `setPushUrl`, `setRedirect`, etc.), HTMX patterns (`formSubmit`, `liveSearch`, `infiniteScroll`, etc.), `ThemeToggle`, `Resumable` |
| `@y-core/forge/validation` | `src/validation/mod.ts` | Leaf | `v` (valibot facade), `ValidationResult` |

### 3b. Internal Namespaces (no public export path)

| Directory | Purpose | Consumers |
|---|---|---|
| `src/crypto/` | HMAC/timing-safe/base64url utilities (`@internal`) | form (CSRF), security (origin), session, storage/r2 (signing) |

This has no `package.json` export entry. Never import it from outside forge.
(`src/context/` is now the public `@y-core/forge/context` subpath — see §3a —
because consumers need its `Middleware`/`AppContext` types and the `contextVar`
accessor, which sit over fetch-router's `RequestContext`.)

Note on stale references: earlier versions listed `timingSafeEqual` under security exports.
The correct location is `src/crypto/mod.ts` (`@internal`). `isHxRequest` is the correct export
name from security (not `requireHxRequest`).

---

## 4. Namespace Classification

### 4a. Leaf Namespace Rules

A namespace is leaf when:
- It imports only from its own `src/{name}/` directory
- It imports only from external npm packages (`valibot`, `@remix-run/*`)
- It has zero imports from other forge namespaces

Current leaf namespaces:
`assets/build`, `assets/manifest`, `cli`, `config`, `form`, `http`, `jsx`, `logging`,
`result`, `router`, `session`, `ui/client`, `validation`, `storage/db`, `storage/kv`, `storage/r2`

### 4b. Integration Namespace Rules

A namespace is integration when it explicitly composes across forge namespaces:

| Namespace | Reason |
|---|---|
| `app` | Wires form, http, logging, result, router, security, validation |
| `assets` | Imports validation for schema and type definitions in `config.ts` / `types.ts` |
| `security` | Imports logging for rate-limit `createLogger` internals |
| `ui` | `ui/core` imports form for `CSRF_FIELD_DEFAULT`, `HONEYPOT_FIELD_DEFAULT` |
| `logging/http` | Imports logging + http + ui for log viewer components |
| `pkg` | Imports cli for command framework |

---

## 5. Growth Rules

### 5a. security — Transport-Layer Hardening Only

Security is strictly transport-layer hardening: CSP, CORS, CSRF, rate limiting,
request identity. It does not handle authentication, sessions, or permissions.

Future additions belong in new namespaces:
- `auth` → authentication (JWT, OAuth, session login)
- Permissions/RBAC → `auth` (identity-aware access control)

### 5b. ui/core — SSR Components Only

`ui/core` contains SSR JSX components. Client behavior (JS controllers) lives in `ui/client`.
If component count exceeds ~25, introduce sub-barrels (`ui/core/form/mod.ts`) but keep
the export path as `@y-core/forge/ui` — consumers never change their imports.

### 5c. app — Bootstrap and Pipeline Builders

`app` contains `createApp`, `validateBindings`, `validateEnv`, `healthCheck`, `applyAssets`,
`definePage`, `defineAction`, `renderWith`. If a third pipeline builder variant is needed,
extract all pipeline builders into a new `@y-core/forge/handler` namespace.

### 5d. http — All HTTP Output Concerns

`http` is the canonical source for response builders, header value classes, and HTML
escaping. Future: `jsonResponse()`, streaming utilities, content negotiation.

---

## 6. When to Add a New Namespace

### 6a. Criteria for a New Namespace

Add a new namespace when:
- The feature crosses runtime concerns AND is reusable across apps
- The feature is large enough (>3 files) to warrant its own `mod.ts`
- An existing namespace would become an integration namespace if the feature were added
- The feature has a clear, bounded concern that can be described in 5 words

### 6b. Checklist Before Adding

- [ ] Is it reusable across multiple apps? (else keep in app code)
- [ ] Does it use only Web APIs? (else it can't be runtime-only)
- [ ] Does it have independent tests?
- [ ] Is the `mod.ts` barrel written with named exports only?
- [ ] Is it added to `package.json` `"exports"`?
- [ ] Does `bun run validate-exports` pass?
- [ ] Is it registered in forge `CLAUDE.md` Guide Index?
