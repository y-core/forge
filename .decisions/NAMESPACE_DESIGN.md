---
title: Namespace Design
description: "barrel exports, mod.ts pattern, export star ban, namespace catalog, validate-exports gate, sibling-barrel guard, biome import rule, growth rules, namespace classification, no circular dependencies, when to add namespace, naming convention, create prefix, Config Options Definition suffix"
weight: 15
---

# Namespace Design

> Authoritative source for how forge's 39 export subpaths are structured, how barrels
> are maintained, what guards prevent circular dependencies, and when to add a namespace.
>
> Complements [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) (dependency tiers),
> [PRODUCTION_TS_RULES.md](./PRODUCTION_TS_RULES.md) (coding rules).

---

## 0. Quick Reference

- §1 Barrel rules: mod.ts is the only barrel; export * is banned; validate-exports gate
- §2 No-sibling-barrel rule: the biome.json guard that prevents circular deps
- §3 Namespace catalog: all 39 package.json subpaths with source locations; §3b sealed-internal `crypto`
- §4 Leaf vs integration: classification table (`jsx` is integration — imports `http`); §4c foundational primitive namespaces (`result`, `crypto`) importable by any namespace
- §5 Growth rules: when/how to add namespaces (security→auth, app→handler, etc.); §5e factory create* prefix and Config/Options/Definition type-suffix naming convention
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

### 3a. Public Export Paths (all 39 from package.json)

Rows follow `package.json` `"exports"` order. `render` is gone — its `renderToString` /
`renderPage` symbols are public only via `@y-core/forge/jsx` (§4b reclassifies `jsx` as
integration because it imports `http`).

| Export Path | Source | Category | Key Exports |
|---|---|---|---|
| `@y-core/forge/app` | `src/app/mod.ts` | Integration | `createApp`, `applyAssets`, `healthCheck`, `definePage`, `defineAction`, `renderWith`, `Renderer`, `AnyRenderer`; re-exports `validateBindings`, `validateEnv`, `ConfigKey` from `context` (canonical home) for back-compat |
| `@y-core/forge/assets` | `src/assets/mod.ts` | Integration | `defineAssetsConfig`, `loadConfig`, `AssetsConfig`, `AssetsConfigSchema` |
| `@y-core/forge/assets/build` | `src/assets/build/mod.ts` | Leaf | `buildAll`, `generateManifest`, `buildCSS`, `buildJS`, `buildSprites`, `copyAssets` |
| `@y-core/forge/assets/manifest` | `src/assets/manifest/mod.ts` | Leaf | `createManifest`, `createSpriteRegistry` |
| `@y-core/forge/cli` | `src/cli/mod.ts` | Leaf | `createCommand`, `addCommand`, `parseArgs`, `execute`, `CliError` |
| `@y-core/forge/config` | `src/config/mod.ts` | Leaf | `Config`, `env`, `applyMapping`, `optionalGroup`, `resolveConfig` |
| `@y-core/forge/context` | `src/context/mod.ts` | Leaf | `contextVar`, `createContextKey`, `getAppContext`, `validateBindings`, `validateEnv`, `RequestContext`, `EnvKey`, `ExecutionContextKey`, `ConfigKey`; types `AppContext`, `Middleware`, `RequestHandler`, `ContextKey`, `ContextVar` — canonical home of binding validation |
| `@y-core/forge/form` | `src/form/mod.ts` | Leaf | `readFields`, `parseFormData`, `csrfProtection`, `importCsrfKey`, `mintCsrf`, `createCsrfToken`, `isHoneypotFilled`, `verifyTurnstile`, `CsrfConfigSchema`, `TurnstileConfigSchema` |
| `@y-core/forge/jsx` | `src/jsx/mod.ts` | Integration | `createElement`, `cloneElement`, `Fragment`, `isValidElement`, `renderToString`, `renderPage`; types `FC`, `JSX`, `JSXElement`, `JSXNode`, `HTMLAttributes`, `PropsWithChildren` — imports `http` |
| `@y-core/forge/jsx/jsx-runtime` | `src/jsx/jsx-runtime.ts` | Integration | automatic-runtime transform target |
| `@y-core/forge/jsx/jsx-dev-runtime` | `src/jsx/jsx-dev-runtime.ts` | Integration | automatic-runtime dev transform target |
| `@y-core/forge/jsx/register` | `src/jsx/register.ts` | Integration (sideEffect) | global JSX runtime registration (import for side effect only) |
| `@y-core/forge/html/htmx` | `src/html/htmx/mod.ts` | Leaf | `isHxRequest`, `readHxRequest`, `isPartial`, `isBoosted`, `hxTrigger`, `hxTarget`, `hxHeaders`, `hxAttrs`, `SWAP`, `formSubmit`, `liveSearch`, `infiniteScroll`, `oobSwap`, `oobAppend`, etc. |
| `@y-core/forge/http` | `src/http/mod.ts` | Leaf | `html`, `escapeHtml`, `safeUrl`, `rawHtml`, `isSafeHtml`, `htmlResponse`, `renderError`, `renderSuccess`, `renderValidationErrors`, `CacheControl`, `ContentType`, `SetCookie`, `Vary` |
| `@y-core/forge/logging` | `src/logging/mod.ts` | Leaf | `createLogger`, `consoleChannel`, `kvLogChannel`, `requestLogger`, `requestLog` |
| `@y-core/forge/logging/show` | `src/logging/show/mod.ts` | Integration | `loadLogViewer`; types `LogViewerAccess`, `LogViewerOptions` — the render components and fragment renderers are `@internal` (auth-by-construction; only `loadLogViewer` can render records) |
| `@y-core/forge/pkg` | `src/pkg/mod.ts` | Integration | `createReleaseCommand`, `parseSemVer`, `bumpSemVer`, `formatSemVer` |
| `@y-core/forge/result` | `src/result/mod.ts` | Leaf (foundational primitive — §4c) | `ok`, `err`, `result`, `toError`, `Result`, `GuardResult`, `ValidationResult` |
| `@y-core/forge/router` | `src/router/mod.ts` | Leaf | re-exports fetch-router: `route`, `createController`, `createAction`, `createRouter`, `createContextKey`, `RequestContext`, `get`/`post`/`put`/`patch`/`del`, `resource`, `createHref`; types `Controller`, `Middleware`, `RequestHandler`, `RouteMap` |
| `@y-core/forge/security` | `src/security/mod.ts` | Integration | `createSecurityHeaders`, `mergeSecurityHeaders`, `NONCE`, `requestId`, `requestIdCtx`, `requireFormContentType`, `cors`, `crossOriginProtection`, `originGuard`, `verifyOrigin`, `rateLimit`, `BaseUrlConfigSchema` |
| `@y-core/forge/session` | `src/session/mod.ts` | Leaf | `sessionMiddleware`, `createCookieSessionStorage`, `createMemorySessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/storage/db` | `src/storage/db/mod.ts` | Leaf | `createD1Client`, `resolveD1Client`, `validateD1Binding`, `sql`, `isSqlFragment` |
| `@y-core/forge/storage/kv` | `src/storage/kv/mod.ts` | Leaf | `createKVStore`, `resolveKVStore`, `validateKVBinding`, `jsonCodec`, `textCodec`, `bytesCodec` |
| `@y-core/forge/storage/r2` | `src/storage/r2/mod.ts` | Leaf | `createObjectStore`, `resolveObjectStore`, `validateR2Binding`, `serveObject`, `createSignedObjectUrl`, `verifySignedObjectUrl`, `importSigningKey`, `r2Backend`, `inferContentType` |
| `@y-core/forge/testing` | `src/testing/mod.ts` | Integration | `createTestContext`, `mockExecutionContext`, `nullLogger`, `mintTestCsrfToken`, `fakeKV`, `fakeAssetsFetcher` — test code only |
| `@y-core/forge/ui/assets` | `src/ui/assets/mod.ts` | Leaf | `loadSpriteGlyphs`, `parseSpriteGlyphs`, `FORGE_UI_ICON_NAMES`, `forgeUiSpriteSources`; types `GlyphEntry`, `GlyphSource`, `ForgeUiIconName` |
| `@y-core/forge/ui/assets/glyphs` | `src/ui/assets/glyphs.ts` | Leaf | `parseSpriteGlyphs`, `loadSpriteGlyphs`; types `GlyphEntry`, `GlyphSource` |
| `@y-core/forge/ui/controls` | `src/ui/controls/mod.ts` | Integration | `Input`, `Textarea`, `Select`, `Slider`, `Switch`, `ToggleGroup` — **bound variants that shadow the `ui/core` names** (add `bind`/`action` + resumable-scope attrs; single-element wrappers built from the internal `createBoundControl` factory, `ToggleGroup` bespoke); `ToggleGroupItemSize`. See §5b |
| `@y-core/forge/ui/core` | `src/ui/core/mod.ts` | Integration | `Form`, `Field`, `FormField`, `Input`, `Textarea`, `Select`, `Button`, `Switch`, `Slider`, `ToggleGroup`, `Alert`, `Badge`, `Avatar`, `Card`, `Dialog`, `Popover`, `Accordion`, `Progress`, `Toast`, `Icon`, `createIcon`, `cn`, `cva` |
| `@y-core/forge/ui/core/client` | `src/ui/core/client.ts` | Integration (sideEffect) | ui/core browser controller registration |
| `@y-core/forge/ui/chrome` | `src/ui/chrome/mod.ts` | Integration | `Navbar`, `Toolbar`, `ThemeToggle`, `FOUC_SCRIPT`, `THEME_ATTR`, `DARK_CLASS`, `THEME_STORAGE_KEY`; types `NavbarProps`, `NavDefinition`, `NavItem`, `NavLink`, `NavMenu`, `NavSection` |
| `@y-core/forge/ui/chrome/client` | `src/ui/chrome/client.ts` | Integration (sideEffect) | theme/nav chrome controller registration (`isDark` signal) |
| `@y-core/forge/ui/client` | `src/ui/client/mod.ts` | Leaf | `mountNav`, `mountTurnstile`, `lazy`, `createSignal`, `computed`, `effect`, `signalRecord`, `bindField`, `bindGroup`, `parseControlValue`, `resume`, `registerScope`, `repeat` |
| `@y-core/forge/ui/client/htmx` | `src/ui/client/htmx.ts` | Leaf (sideEffect) | htmx bundle (import only for side effect) |
| `@y-core/forge/ui/server` | `src/ui/server/mod.ts` | Integration | `Flash`, `FlashContainer`, `FlashOob`, `createFlash`, `Resumable`, `scopeAttrs`, `fieldAttr`, `commandAttrs` |
| `@y-core/forge/ui/show` | `src/ui/show/mod.ts` | Integration | `ShowcaseContent`, `registerShowcase`, `showcaseRoutes`; types `ShowcaseOptions`, `ShowcaseIcon`, `ShowcaseUiRoutes` |
| `@y-core/forge/ui/show/client` | `src/ui/show/client.ts` | Integration (sideEffect) | showcase browser controller registration |
| `@y-core/forge/validation` | `src/validation/mod.ts` | Leaf | `v` (valibot facade), `ValidationResult` |
| `@y-core/forge/validation/cli` | `src/validation/cli/mod.ts` | Integration | `createGenEnv`, `loadOptions`, `readWranglerConfig`, `collectBindings`, `collectVars`, `emit`, `DEFAULT_OPTIONS`; types `BindingDef`, `GenOptions`, `Entry` — imports `cli` |

### 3b. Internal Namespaces (no public export path)

| Directory | Purpose | Consumers |
|---|---|---|
| `src/crypto/` | HMAC/timing-safe/base64url utilities (`@internal`) | form (CSRF), security (origin), session, storage/r2 (signing) |

`crypto` is **sealed-internal**: it has no `package.json` export entry, every symbol carries
`@internal`, and it is registered on the `SEALED_INTERNAL` allowlist in
`scripts/validate-exports.ts` (`const SEALED_INTERNAL = new Set(["src/crypto/mod.ts"])`).
The allowlist lets the gate accept a `mod.ts` that maps to no export subpath without flagging
it as orphaned — a barrel is valid only if it is either exported *or* explicitly sealed. Never
import `crypto` from outside forge.
(`src/context/` is now the public `@y-core/forge/context` subpath — see §3a —
because consumers need its `Middleware`/`AppContext` types and the `contextVar`
accessor, which sit over fetch-router's `RequestContext`.)

Note on stale references: earlier versions listed `timingSafeEqual` under security exports.
The correct location is `src/crypto/mod.ts` (`@internal`). `isHxRequest` was previously
in security but moved to `@y-core/forge/html/htmx` — it is a UX hint, not a security primitive.

---

## 4. Namespace Classification

### 4a. Leaf Namespace Rules

A namespace is leaf when:
- It imports only from its own `src/{name}/` directory
- It imports only from external npm packages (`valibot`, `@remix-run/*`)
- It has zero imports from other forge namespaces

Current leaf namespaces:
`assets/build`, `assets/manifest`, `cli`, `config`, `context`, `form`, `html/htmx`, `http`,
`logging`, `result`, `router`, `session`, `storage/db`, `storage/kv`, `storage/r2`,
`ui/assets`, `ui/client`, `validation`

`jsx` is **no longer leaf** — it imports `http` (see §4b). Binding validation
(`validateBindings` / `validateEnv`) and `ConfigKey` now live in `context` (the canonical
home) and keep `context` leaf; `app` re-exports them for back-compat.

### 4b. Integration Namespace Rules

A namespace is integration when it explicitly composes across forge namespaces:

| Namespace | Reason |
|---|---|
| `app` | Wires form, http, logging, result, router, security, validation; re-exports `validateBindings` / `validateEnv` / `ConfigKey` from `context` (canonical home) for back-compat |
| `assets` | Imports validation for schema and type definitions in `config.ts` / `types.ts` |
| `jsx` | Imports `http` — `escapeHtml` / `safeUrl` (`../http/escape`), `SafeHtml` / `isSafeHtml` / `rawHtml` (`../http/html`), `htmlResponse` (`../http/response`) |
| `security` | Imports logging for rate-limit `createLogger` internals |
| `ui/core` | Imports form for `CSRF_FIELD_DEFAULT`, `HONEYPOT_FIELD_DEFAULT`; renders via the `jsx` runtime |
| `ui/controls` | Imports `ui/core` (base components) + `ui/server` (`scopeAttrs` / `fieldAttr`) to build bound variants |
| `ui/chrome` / `ui/show` | Compose `ui/core` and `jsx`; `ui/show` also imports `app`, `context`, `http`, `html/htmx` |
| `ui/server` | Imports `html/htmx` (OOB helpers), `app`, `context`, `session`, and the `jsx` runtime |
| `logging/show` | Imports logging + http + `ui/core` (the app-injected `ForgeIcon<"chevron-down">` type/render for the filter bar) + `html/htmx`; keeps `logging/show` classified as integration |
| `pkg` | Imports cli for command framework |
| `validation/cli` | Imports cli for the `forge-cfgen` command framework |
| `testing` | Composes context, form, and logging fakes for test helpers |

### 4c. Foundational Primitive Namespaces — `result` and `crypto`

Two namespaces are **foundational primitives**: any namespace may import them without
that import counting as a cross-namespace layering violation. They sit *below* the
leaf/integration split rather than participating in it.

| Namespace | Public? | How it is imported | Consumers |
|---|---|---|---|
| `result` | public (`@y-core/forge/result`) | concrete file `../result/result` (or the barrel from app code) | `security`, `form`, `storage/*`, `app`, `validation`, … — anyone |
| `crypto` | sealed-internal (§3b) | `crypto/mod` (barrel, biome-exempt) | `form`, `security`, `session`, `storage/r2` |

`result` is the single result primitive (`Result`, `ok`, `err`, `result`, `toError`,
and the `GuardResult` / `ValidationResult` aliases — see
[ERROR_HANDLING.md](./ERROR_HANDLING.md) §1). Because explicit error handling is a
cross-cutting concern, `security` / `form` / `storage` importing `result` is
**expected, not a violation** — treat it exactly like importing a Web API. `result`
itself stays **leaf** (§4a): it imports nothing from any other forge namespace, so it
can never introduce a cycle. Its concrete-file import path (`../result/result`) keeps
it clear of the no-sibling-barrel guard (§2) without needing an exemption; `crypto`,
imported via its barrel, carries the biome exemption instead (§2c).

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
the SSR export path stable — consumers never change their imports.

**`ui/controls` intentionally shadows `ui/core` control names.** `Input`, `Textarea`, `Select`,
`Slider`, `Switch`, and `ToggleGroup` are exported from **both** `ui/core` (unbound components that
extend `IntrinsicElements`) and `ui/controls` (bound variants that wrap the `ui/core` base and
add a `bind` prop plus optional `action`, pre-spreading `scopeAttrs` + `fieldAttr` for the
resumable-scope signal contract). The five single-element wrappers are built from an internal
`createBoundControl` factory (`@internal`, not exported); `ToggleGroup` is bespoke (binds on `.Item`).
This name collision is **by design — do not rename either side**: the two variants live
on separate subpaths (`@y-core/forge/ui/core` vs `@y-core/forge/ui/controls`) so an app picks
one per call site. **Rule: a module must import a given control name from exactly one of the
two barrels, never both.** See [UI_COMPONENTS.md](./UI_COMPONENTS.md) §1k.

### 5c. app — Bootstrap and Pipeline Builders

`app` contains `createApp`, `validateBindings`, `validateEnv`, `healthCheck`, `applyAssets`,
`definePage`, `defineAction`, `renderWith`. If a third pipeline builder variant is needed,
extract all pipeline builders into a new `@y-core/forge/handler` namespace.

### 5d. http — All HTTP Output Concerns

`http` is the canonical source for response builders, header value classes, and HTML
escaping. Future: `jsonResponse()`, streaming utilities, content negotiation.

### 5e. Exported Factory and Type Naming Convention

Factory functions use the `create*` prefix — never `make*` (`createApp`,
`createSecurityHeaders`, `createD1Client`). Request-time binding accessors use
`resolve*` (`resolveKVStore`, `resolveObjectStore`).

Exported option/shape types use a suffix chosen by what the type *is*:

| Suffix | Meaning | Examples |
|---|---|---|
| `*Config` | Validated/resolved **data shape**, typically schema-backed | `CsrfConfig`, `AssetsConfig`, `BaseUrlConfig` |
| `*Options` | **Behavior configuration** passed to a factory/function/middleware | `SecurityHeadersOptions`, `KVStoreOptions`, `RateLimitOptions` |
| `*Definition` | **Declarative handler/component shape** consumed by a builder | `PageDefinition`, `ActionDefinition`, `NavDefinition` |
| `*Descriptor` / `*Def` | Fine-grained declarative **member shapes** within a definition | `ConfigDescriptor`, `FieldDescriptor`, `FlagDef`, `BindingDef` |

A declarative shape must not be named `*Config` (that suffix implies validated env/data);
behavior knobs must not be named `*Config` or `*Definition`. See
[.claude/agents/cc-dev.md](../.claude/agents/cc-dev.md) (Coding Ruleset → Naming Conventions)
for the enforcement wording used by cc-dev.

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
