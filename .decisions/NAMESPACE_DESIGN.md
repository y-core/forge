---
title: Namespace Design
description: "Barrel export rules, the authoritative subpath catalog, leaf-versus-integration classification, and the criteria for adding a namespace."
---

# Namespace Design

> Owns the export-subpath catalog, barrel discipline, the leaf/integration classification, and
> the growth rules for new namespaces. Other documents link here rather than restating the
> classification.
>
> Defers to: [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) for the facade and
> runtime-only principles these rules serve; [`PRODUCTION_TS_RULES.md`](./PRODUCTION_TS_RULES.md)
> for the coding rules inside a namespace; `package.json` `exports` for the subpath names
> themselves, and `src/{ns}/mod.ts` for each namespace's export list.

---

## 0. Quick Reference

- §1 Barrel Rules and Export Discipline: one barrel per namespace, named exports only
- §1a mod.ts Barrel Convention: the three rules a barrel obeys
- §1b Export Star Ban: why `export *` is rejected
- §1c validate-exports Gate: what the script proves
- §2 No-Sibling-Barrel Import Rule: the guard against circular dependencies
- §2a Biome Import Guard: the `noRestrictedImports` pattern and its message
- §2b Why Sibling Barrels Are Forbidden: the cycle it prevents
- §2c The validation and crypto Exemptions: the two allowed barrel imports
- §3 Authoritative Namespace Catalog: every subpath and its classification
- §3a Public Export Paths: the catalog table
- §3b Internal Namespaces: sealed-internal `crypto`
- §4 Namespace Classification: the leaf/integration split
- §4a Leaf Namespace Rules: zero cross-namespace forge imports
- §4b Integration Namespace Rules: declared composition edges
- §4c Foundational Primitive Namespaces: `result` and `crypto` sit below the split
- §5 Growth Rules: where a new concern belongs
- §5a security — Transport-Layer Hardening Only: what goes to a future `auth`
- §5b ui/core — SSR Components Only: and the deliberate `ui/controls` shadowing
- §5c app — Bootstrap and Pipeline Builders: the third-builder trigger
- §5d http — All HTTP Output Concerns: the canonical output home
- §5e Exported Factory and Type Naming Convention: `create*`, `resolve*`, and type suffixes
- §6 When to Add a New Namespace: criteria and checklist
- §6a Criteria for a New Namespace: the four tests
- §6b Checklist Before Adding: what must be true before merge

---

## 1. Barrel Rules and Export Discipline

### 1a. mod.ts Barrel Convention

Every namespace has exactly one barrel, `src/{name}/mod.ts`, and it is the only file listed in
`package.json` `exports`. All public API flows through it.

- **`mod.ts` uses named exports only** — never `export * from …` (§1b).
- **Every new symbol in the namespace must be added to `mod.ts`.**
- **`mod.ts` imports from concrete files, never from another `mod.ts` barrel** (§2).

### 1b. Export Star Ban

**`export * from './foo'` is banned.** It leaks internal symbols into the public surface,
risks circular dependencies, and makes the public API ungreppable.

Enforced by `scripts/validate-exports.ts`.

### 1c. validate-exports Gate

`scripts/validate-exports.ts` is the enforcement authority for everything in §1a–§1b. It
proves each subpath resolves to a real, published file; that no barrel uses `export *`; that
every `@public` source symbol reaches its barrel; that every `src/**/mod.ts` is either exported
or on the sealed-internal allowlist; and that every `files[]` entry exists on disk.

**Read the script, not this section, for the current rule set** — it is the source of truth.

---

## 2. No-Sibling-Barrel Import Rule

### 2a. Biome Import Guard

`biome.json` bans `../**/mod` imports via `noRestrictedImports`, with two exemptions:
`validation/mod` and `crypto/mod` (§2c).

### 2b. Why Sibling Barrels Are Forbidden

When `src/security/` imports `src/form/mod.ts`, any future import in `form/mod.ts` that reaches
back into `security` creates a cycle. **Importing the concrete file (`src/form/csrf.ts`) makes
the dependency explicit and bounded.**

This is the inverse of the rule an application repo would use — inside a library, the barrel is
the published surface, not a convenience.

### 2c. The validation and crypto Exemptions

- **`validation/mod.ts`** is the valibot facade — all of forge uses `v` for schemas.
- **`crypto/mod.ts`** is an `@internal` utility module needed by `form`, `security`, `session`,
  and `storage/r2`.

Both are shared utilities with no circular risk.

---

## 3. Authoritative Namespace Catalog

### 3a. Public Export Paths

Rows follow `package.json` `exports` order, which owns the subpath names. The Key Exports
column is an orientation aid — **`src/{ns}/mod.ts` is authoritative for what a namespace
exports.**

**Asset rows are entries whose target is not a module**, and they carry two rules a barrel row does
not.

**Their `exports` value is a plain string, not a `{types, import}` object.** Tailwind's CSS resolver
runs `conditionNames: ["style"]`, so neither `types` nor `import` matches and an object entry is
unreachable from `@import` however correct it looks.

**A family of assets is one subpath pattern, not one key per file.** `./ui/assets/css/*.css` is a
Node subpath pattern — the supported replacement for the directory exports removed in Node 17 — and
`files[]` already ships the whole of `src/ui/`, so a new stylesheet is addressable the moment it is
written. Exactly one `*` is permitted per key and per target, `*` matches greedily across `/`, and
exact keys take precedence over patterns, so the two forms mix safely.

**What the gate asserts changed with it, and got stronger.** A literal key could only be checked for
*declaration*; a pattern is checked by **expansion and resolution**. `validate-exports` expands each
pattern against disk and requires every member to be published and to actually
`import.meta.resolve`, failing a pattern that matches nothing as dead config. Reverse pass C then
works the other way — every stylesheet on disk must resolve under some key or pattern. *Reachability
is the property that ever went wrong here*, and it is now the property being tested: forge shipped 73
versions of stylesheets that existed, were inside `files[]`, and could not be imported.
`validate-docs` matches a documented subpath against patterns too, and for a pattern match
additionally requires the file to exist — otherwise a citation of `theme-forest.css` would satisfy
the shape and send a reader to a resolution error.

| Export Path | Source | Category | Key Exports |
|---|---|---|---|
| `@y-core/forge/app` | `src/app/mod.ts` | Integration | `createApp`, `Forge`, `applyAssets`, `healthCheck`, `definePage`, `defineAction`, `applyMiddlewareChain`; re-exports `validateBindings`, `validateEnv`, `ConfigKey` from `context` |
| `@y-core/forge/assets` | `src/assets/mod.ts` | Integration | `defineAssetsConfig`, `loadConfig`, `AssetsConfig` |
| `@y-core/forge/assets/build` | `src/assets/build/mod.ts` | Leaf | `buildAll`, `buildCSS`, `buildJS`, `buildSprites`, `copyAssets` |
| `@y-core/forge/assets/manifest` | `src/assets/manifest/mod.ts` | Leaf | `createManifest`, `createSpriteRegistry` |
| `@y-core/forge/cli` | `src/cli/mod.ts` | Leaf | `createCommand`, `addCommand`, `execute`, `CliError` |
| `@y-core/forge/config` | `src/config/mod.ts` | Leaf | `Config`, `createConfig`, `env`, `resolveConfig` |
| `@y-core/forge/context` | `src/context/mod.ts` | Leaf | `contextVar`, `createContextKey`, `getAppContext`, `validateBindings`, `validateEnv`; types `AppContext`, `Middleware`, `RequestHandler` — canonical home of binding validation |
| `@y-core/forge/form` | `src/form/mod.ts` | Leaf | `readFields`, `parseFormData`, `csrfProtection`, `importCsrfKey`, `mintCsrf`, `isHoneypotFilled`, `verifyTurnstile` |
| `@y-core/forge/jsx` | `src/jsx/mod.ts` | Integration | `createElement`, `cloneElement`, `Fragment`, `isValidElement`, `renderToString`, `renderPage` — imports `http` |
| `@y-core/forge/jsx/jsx-runtime` | `src/jsx/jsx-runtime.ts` | Integration | automatic-runtime transform target |
| `@y-core/forge/jsx/jsx-dev-runtime` | `src/jsx/jsx-dev-runtime.ts` | Integration | automatic-runtime dev transform target |
| `@y-core/forge/jsx/register` | `src/jsx/register.ts` | Integration (sideEffect) | global JSX runtime registration |
| `@y-core/forge/html/htmx` | `src/html/htmx/mod.ts` | Leaf | `isHxRequest`, `readHxRequest`, `hxHeaders`, `hxAttrs`, `SWAP`, and the pattern helpers |
| `@y-core/forge/http` | `src/http/mod.ts` | Leaf | `html`, `escapeHtml`, `safeUrl`, `rawHtml`, `htmlResponse`, `fragmentResponse`, `renderError`, `renderSuccess`, `renderValidationErrors`, the typed header classes |
| `@y-core/forge/logging` | `src/logging/mod.ts` | Leaf | `createLogger`, `consoleChannel`, `kvLogChannel`, `withMinLevel`, `withRedaction`, `requestLogger`, `requestLog` |
| `@y-core/forge/logging/show` | `src/logging/show/mod.ts` | Integration | `loadLogViewer` — the render components and fragment renderers are `@internal` (auth-by-construction) |
| `@y-core/forge/pkg` | `src/pkg/mod.ts` | Integration | `createReleaseCommand`, `parseSemVer`, `bumpSemVer`, `formatSemVer` |
| `@y-core/forge/result` | `src/result/mod.ts` | Leaf (foundational — §4c) | `ok`, `err`, `result`, `toError`, `Result`, `GuardResult`, `ValidationResult` |
| `@y-core/forge/router` | `src/router/mod.ts` | Leaf | fetch-router re-exports: `route`, `createController`, `createAction`, the method helpers, `createHref`; plus `routePaths` / `RouteFilter` |
| `@y-core/forge/security` | `src/security/mod.ts` | Integration | `createSecurityHeaders`, `getNonce`, `NONCE`, `requestId`, `requireFormContentType`, `cors`, `originProtection`, `crossOriginProtection`, `originGuard`, `verifyOrigin`, `rateLimit` |
| `@y-core/forge/session` | `src/session/mod.ts` | Leaf | `sessionMiddleware`, `createCookieSessionStorage`, `createMemorySessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/storage/db` | `src/storage/db/mod.ts` | Leaf | `createD1Client`, `resolveD1Client`, `validateD1Binding`, `sql`, `isSqlFragment` |
| `@y-core/forge/storage/kv` | `src/storage/kv/mod.ts` | Leaf | `createKVStore`, `resolveKVStore`, `validateKVBinding`, `jsonCodec`, `textCodec`, `bytesCodec` |
| `@y-core/forge/storage/r2` | `src/storage/r2/mod.ts` | Leaf | `createObjectStore`, `resolveObjectStore`, `validateR2Binding`, `serveObject`, `createSignedObjectUrl`, `verifySignedObjectUrl`, `r2Backend` |
| `@y-core/forge/testing` | `src/testing/mod.ts` | Integration | test-only fixtures — see [`TESTING.md`](./TESTING.md) §7 |
| `@y-core/forge/ui/assets` | `src/ui/assets/mod.ts` | Leaf | `loadSpriteGlyphs`, `parseSpriteGlyphs`, `FORGE_UI_ICON_NAMES`, `forgeUiSpriteSources` |
| `@y-core/forge/ui/assets/glyphs` | `src/ui/assets/glyphs.ts` | Leaf | `parseSpriteGlyphs`, `loadSpriteGlyphs` |
| `@y-core/forge/ui/assets/css/…` | `src/ui/assets/css/*.css` | Asset (pattern) | Every forge stylesheet, by filename. `@y-core/forge/ui/assets/css/forge.css` is **the consumer entry point** — it imports the theme plus the component CSS and carries the `@source` paths that make forge's utility classes generate in a consumer build. `forge-show.css` is that plus the showcase's classes, opt-in. Underneath: `theme-base.css` (semantic tokens over an eleven-stop `--palette-*` ramp, plus the layered component rules), `forge-ui.css` (the utility CSS specific components require), and seven ready-made ramps — `theme-slate.css` is the structural model for an app's own |
| `@y-core/forge/ui/contracts` | `src/ui/contracts/mod.ts` | Leaf | the DOM contract as pure data — `STATE_ATTRS`, `stateAttrs`, `applyStateAttrs`, `SCOPE_EVENTS`, and the scope-name / selector constants each keyboard primitive shares between its SSR and client halves |
| `@y-core/forge/ui/controls` | `src/ui/controls/mod.ts` | Integration | bound control variants that shadow the `ui/core` names — see §5b |
| `@y-core/forge/ui/core` | `src/ui/core/mod.ts` | Integration | the SSR component set plus `cn`, `cva` — see [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) |
| `@y-core/forge/ui/core/client` | `src/ui/core/client.ts` | Integration (sideEffect) | ui/core browser controller registration |
| `@y-core/forge/ui/chrome` | `src/ui/chrome/mod.ts` | Integration | `Navbar`, `Toolbar`, `ThemeToggle`, `FOUC_SCRIPT`, `THEME_ATTR` |
| `@y-core/forge/ui/chrome/client` | `src/ui/chrome/client.ts` | Integration (sideEffect) | theme/nav chrome controller registration |
| `@y-core/forge/ui/client` | `src/ui/client/mod.ts` | Leaf | `mountNav`, `mountTurnstile`, `lazy`, `createSignal`, `computed`, `effect`, `bindField`, `bindGroup`, `resume`, `registerScope` |
| `@y-core/forge/ui/client/htmx` | `src/ui/client/htmx.ts` | Leaf (sideEffect) | htmx bundle |
| `@y-core/forge/ui/server` | `src/ui/server/mod.ts` | Integration | `Flash`, `FlashContainer`, `FlashOob`, `Resumable`, `scopeAttrs`, `fieldAttr`, `commandAttrs` |
| `@y-core/forge/ui/show` | `src/ui/show/mod.ts` | Integration | `ShowcaseContent`, `registerShowcase`, `showcaseRoutes` |
| `@y-core/forge/ui/show/client` | `src/ui/show/client.ts` | Integration (sideEffect) | showcase browser controller registration |
| `@y-core/forge/validation` | `src/validation/mod.ts` | Leaf | `v` (valibot facade), `ValidationResult` |
| `@y-core/forge/validation/cli` | `src/validation/cli/mod.ts` | Integration | `createGenEnv`, `readWranglerConfig`, `emit` — imports `cli` |

### 3b. Internal Namespaces

| Directory | Purpose | Consumers |
|---|---|---|
| `src/crypto/` | HMAC / timing-safe / base64url utilities (`@internal`) | `form`, `security`, `session`, `storage/r2` |

**`crypto` is sealed-internal:** no export entry, every symbol `@internal`, and registered on
the `SEALED_INTERNAL` allowlist in `scripts/validate-exports.ts`. The allowlist is what lets a
barrel exist without an export subpath — **a barrel is valid only if it is exported or
explicitly sealed.**

**Never import `crypto` from outside forge.** There is no `@y-core/forge/crypto` subpath.

---

## 4. Namespace Classification

### 4a. Leaf Namespace Rules

A namespace is **leaf** when it imports only from its own `src/{name}/` directory, external npm
packages, and Web APIs — **zero imports from other forge namespaces.**

Leaf: `assets/build`, `assets/manifest`, `cli`, `config`, `context`, `form`, `html/htmx`,
`http`, `logging`, `result`, `router`, `session`, `storage/db`, `storage/kv`, `storage/r2`,
`ui/assets`, `ui/client`, `validation`.

`jsx` is **not** leaf — it imports `http` (§4b).

### 4b. Integration Namespace Rules

A namespace is **integration** when it explicitly composes across forge namespaces. Every edge
below is declared; an undeclared cross-namespace import is a defect.

| Namespace | Composes |
|---|---|
| `app` | `form`, `http`, `logging`, `result`, `router`, `security`, `validation`; re-exports from `context` |
| `assets` | `validation` (schema and type definitions) |
| `jsx` | `http` — `escapeHtml`/`safeUrl`, `SafeHtml`/`isSafeHtml`/`rawHtml`, `htmlResponse` |
| `security` | `logging` (rate-limit internals) |
| `ui/core` | `form` (`CSRF_FIELD_DEFAULT`, `HONEYPOT_FIELD_DEFAULT`); renders via the `jsx` runtime |
| `ui/controls` | `ui/core` (base components) + `ui/server` (`scopeAttrs` / `fieldAttr`) |
| `ui/chrome`, `ui/show` | `ui/core` and `jsx`; `ui/show` also `app`, `context`, `http`, `html/htmx` |
| `ui/server` | `html/htmx`, `app`, `context`, `session`, and the `jsx` runtime |
| `logging/show` | `logging`, `http`, `ui/core` (the injected `ForgeIcon<"chevron-down">`), `html/htmx` |
| `pkg` | `cli` |
| `validation/cli` | `cli` |
| `testing` | `app`, `jsx`, `storage/*`, `context`, `form` — the declared test-only edge |

### 4c. Foundational Primitive Namespaces — `result` and `crypto`

Two namespaces sit **below** the leaf/integration split: **any namespace may import them
without that import counting as a layering violation.**

| Namespace | Public? | Imported as | Consumers |
|---|---|---|---|
| `result` | public | concrete file `../result/result` | anyone |
| `crypto` | sealed-internal (§3b) | `crypto/mod` (barrel, biome-exempt) | `form`, `security`, `session`, `storage/r2` |

`result` is the single result primitive ([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1).
Because explicit error handling is cross-cutting, `security` / `form` / `storage` importing
`result` is **expected** — treat it like importing a Web API.

Both are themselves free of forge-namespace imports, so neither can introduce a cycle.
`result` stays leaf (§4a); its concrete-file import path keeps it clear of the §2 guard without
an exemption, while `crypto` carries the biome exemption instead (§2c).

---

## 5. Growth Rules

### 5a. security — Transport-Layer Hardening Only

`security` is strictly transport-layer: CSP, CORS, origin verification, rate limiting, request
identity. **It does not handle authentication, sessions, or permissions.**

Authentication (JWT, OAuth, session login) and permissions/RBAC belong in a new `auth`
namespace — identity is application-layer.

### 5b. ui/core — SSR Components Only

`ui/core` contains SSR JSX components; client behaviour lives in `ui/client`. If the component
count exceeds ~25, introduce sub-barrels (`ui/core/form/mod.ts`) but keep the export path
stable.

**`ui/controls` intentionally shadows the `ui/core` control names** — `Input`, `Textarea`,
`Select`, `Slider`, `Switch`, `ToggleGroup` are exported from both, unbound from `ui/core` and
bound from `ui/controls`. **The collision is by design; do not rename either side.**

**Rule: a module must import a given control name from exactly one of the two barrels, never
both.** The mechanism is in [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md).

### 5c. app — Bootstrap and Pipeline Builders

`app` owns bootstrap and the `definePage` / `defineAction` pipeline builders. **If a third
pipeline-builder variant is needed, extract all builders into a new `handler` namespace.**

### 5d. http — All HTTP Output Concerns

`http` is the canonical home for response builders, header value classes, and HTML escaping —
never `@remix-run/headers` or `@remix-run/html-template` directly. Future: `jsonResponse()`,
streaming utilities, content negotiation.

### 5e. Exported Factory and Type Naming Convention

**Factories use the `create*` prefix — never `make*`** (`createApp`, `createSecurityHeaders`,
`createD1Client`). **Request-time binding accessors use `resolve*`** (`resolveKVStore`,
`resolveObjectStore`). **Declarative handler configs use `define*`** (`definePage`,
`defineAction`).

`ok` / `err` are the one documented exception ([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1a).

Exported option and shape types take a suffix chosen by what the type *is*:

| Suffix | Meaning | Examples |
|---|---|---|
| `*Config` | Validated/resolved **data shape**, typically schema-backed | `CsrfConfig`, `AssetsConfig`, `BaseUrlConfig` |
| `*Options` | **Behaviour configuration** passed to a factory or middleware | `SecurityHeadersOptions`, `KVStoreOptions`, `RateLimitOptions` |
| `*Definition` | **Declarative handler/component shape** consumed by a builder | `PageDefinition`, `ActionDefinition`, `NavDefinition` |
| `*Descriptor` / `*Def` | Fine-grained declarative **member shapes** within a definition | `ConfigDescriptor`, `FieldDescriptor`, `FlagDef`, `BindingDef` |

**A declarative shape must not be named `*Config`** (that suffix implies validated env/data),
and **behaviour knobs must not be named `*Config` or `*Definition`.**

---

## 6. When to Add a New Namespace

### 6a. Criteria for a New Namespace

Add one when **all** hold:

- The feature crosses runtime concerns and is reusable across apps.
- It is large enough (>3 files) to warrant its own `mod.ts`.
- An existing namespace would become an integration namespace if the feature were added to it.
- Its concern is bounded enough to describe in five words.

### 6b. Checklist Before Adding

- [ ] Reusable across multiple apps (else keep it in app code)
- [ ] Uses only Web APIs
- [ ] Has independent tests
- [ ] `mod.ts` written with named exports only
- [ ] Added to `package.json` `exports`
- [ ] `bun run validate-exports` passes
- [ ] Classified leaf or integration in §4
- [ ] Registered in the `CLAUDE.md` Guide Index if it gains a governing document
