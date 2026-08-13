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
- §4a Leaf Namespace Rules: no cross-namespace forge imports beyond the §4c primitives
- §4b Integration Namespace Rules: where edges are declared, and what the graph gate proves
- §4c Foundational Primitive Namespaces: `result`, `crypto`, `context` and `validation` sit below the split
- §5 Growth Rules: where a new concern belongs
- §5a security — Transport-Layer Hardening Only: what goes to a future `auth`
- §5b ui/core — SSR Components Only: and the deliberate `ui/controls` shadowing
- §5c app — Bootstrap and Pipeline Builders: the third-builder trigger and what counts toward it
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

**All three spellings are banned**, not just the bare one:

| Form | Banned | Why |
|---|---|---|
| `export * from "./foo"` | yes | all three harms |
| `export * as ns from "./foo"` | yes | the same leak behind one extra token |
| `export type * from "./foo"` | yes | leaks every internal type, and is equally ungreppable |

The type-only form is erased at emit, so it cannot create a runtime cycle — but two of the three
harms still apply, and a barrel's job is to state its surface. Name the types.

Enforced by `scripts/validate-exports.ts` via the matchers in `scripts/barrel-parse.ts`.

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
- **`crypto/mod.ts`** is an `@internal` utility module several namespaces need.

Both are §4c foundational primitives, which is the same fact this exemption exists for: §4c owns
the consumer lists and the closure argument that makes them safe. Restating either here would
give a reader two copies to reconcile and no way to tell which had drifted.

---

## 3. Authoritative Namespace Catalog

### 3a. Public Export Paths

Rows follow `package.json` `exports` order, which owns the subpath names. The Key Exports
column is an orientation aid — **`src/{ns}/mod.ts` is authoritative for what a namespace
exports.** Leaf/integration classification is declared in `scripts/namespace-graph.ts` (see §4a)
and side-effect status in `package.json` `sideEffects`; this table enumerates neither.

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

| Export Path | Source | Key Exports |
|---|---|---|
| `@y-core/forge/app` | `src/app/mod.ts` | `createApp`, `Forge`, `applyAssets`, `healthCheck`, `definePage`, `defineAction`, `applyMiddlewareChain`; re-exports `validateBindings`, `validateEnv`, `ConfigKey` from `context` |
| `@y-core/forge/assets` | `src/assets/mod.ts` | `defineAssetsConfig`, `loadConfig`, `AssetsConfig` |
| `@y-core/forge/assets/build` | `src/assets/build/mod.ts` | `buildAll`, `buildCSS`, `buildJS`, `buildSprites`, `copyAssets` |
| `@y-core/forge/assets/manifest` | `src/assets/manifest/mod.ts` | `createManifest`, `createSpriteRegistry` |
| `@y-core/forge/cli` | `src/cli/mod.ts` | `createCommand`, `addCommand`, `execute`, `CliError` |
| `@y-core/forge/config` | `src/config/mod.ts` | `Config`, `createConfig`, `env`, `resolveConfig` |
| `@y-core/forge/context` | `src/context/mod.ts` | `contextVar`, `createContextKey`, `getAppContext`, `validateBindings`, `validateEnv`; types `AppContext`, `Middleware`, `RequestHandler` — canonical home of binding validation |
| `@y-core/forge/form` | `src/form/mod.ts` | `parseFormData`, `csrfProtection`, `importCsrfKey`, `mintCsrf`, `isHoneypotFilled`, `verifyTurnstile`, `formToObject` — `formToObject` reads a body into a plain object; applying a schema to it is `defineAction`'s |
| `@y-core/forge/jsx` | `src/jsx/mod.ts` | `createElement`, `cloneElement`, `Fragment`, `isValidElement`, `renderToString`, `renderPage` — imports `http` |
| `@y-core/forge/jsx/jsx-runtime` | `src/jsx/jsx-runtime.ts` | automatic-runtime transform target |
| `@y-core/forge/jsx/jsx-dev-runtime` | `src/jsx/jsx-dev-runtime.ts` | automatic-runtime dev transform target |
| `@y-core/forge/jsx/register` | `src/jsx/register.ts` | global JSX runtime registration |
| `@y-core/forge/html/htmx` | `src/html/htmx/mod.ts` | `isHxRequest`, `readHxRequest`, `hxHeaders`, `hxAttrs`, `SWAP`, and the pattern helpers |
| `@y-core/forge/http` | `src/http/mod.ts` | `html`, `escapeHtml`, `safeUrl`, `rawHtml`, `htmlResponse`, `fragmentResponse`, `renderError`, `renderSuccess`, `renderValidationErrors`, the typed header classes |
| `@y-core/forge/logging` | `src/logging/mod.ts` | `createLogger`, `consoleChannel`, `kvLogChannel`, `withMinLevel`, `withRedaction`, `requestLogger`, `requestLog` |
| `@y-core/forge/logging/show` | `src/logging/show/mod.ts` | `loadLogViewer` — the render components and fragment renderers are `@internal` (auth-by-construction) |
| `@y-core/forge/pkg` | `src/pkg/mod.ts` | project tooling — both verbs: `createReleaseCommand`, `resolveVersion`, the SemVer and changelog transforms; `createGateCommand`, `cloudflareWorkerSteps`, `selectSteps`. The git/manifest helpers and the gate's formatters are `@internal` (`ASSET_AND_BUILD_TOOLING.md` §5c, §5f) |
| `@y-core/forge/result` | `src/result/mod.ts` | `ok`, `err`, `result`, `toError`, `Result`, `GuardResult`, `ValidationResult` |
| `@y-core/forge/router` | `src/router/mod.ts` | fetch-router re-exports: `route`, `createController`, `createAction`, the method helpers, `createHref`; plus `routePaths` / `RouteFilter` / `forMethod` |
| `@y-core/forge/security` | `src/security/mod.ts` | `createSecurityHeaders`, `getNonce`, `NONCE`, `requestId`, `requireFormContentType`, `cors`, `originProtection`, `crossOriginProtection`, `originGuard`, `verifyOrigin`, `rateLimit` |
| `@y-core/forge/session` | `src/session/mod.ts` | `sessionMiddleware`, `createCookieSessionStorage`, `createMemorySessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/storage/db` | `src/storage/db/mod.ts` | `createD1Client`, `resolveD1Client`, `validateD1Binding`, `sql`, `isSqlFragment`, `uuidv7`, `uuidv7Bytes`, `uuidFromBytes`, `uuidToBytes` and the two `createUuidv7*` factories — the UUID set is implemented in `crypto` and surfaced here (§3b) |
| `@y-core/forge/storage/kv` | `src/storage/kv/mod.ts` | `createKVStore`, `resolveKVStore`, `validateKVBinding`, `jsonCodec`, `textCodec`, `bytesCodec` |
| `@y-core/forge/storage/r2` | `src/storage/r2/mod.ts` | `createObjectStore`, `resolveObjectStore`, `validateR2Binding`, `serveObject`, `createSignedObjectUrl`, `verifySignedObjectUrl`, `r2Backend` |
| `@y-core/forge/testing` | `src/testing/mod.ts` | test-only fixtures — see [`TESTING.md`](./TESTING.md) §7 |
| `@y-core/forge/ui/assets` | `src/ui/assets/mod.ts` | `loadSpriteGlyphs`, `parseSpriteGlyphs`, `FORGE_UI_ICON_NAMES`, `forgeUiSpriteSources` |
| `@y-core/forge/ui/assets/glyphs` | `src/ui/assets/glyphs.ts` | `parseSpriteGlyphs`, `loadSpriteGlyphs` |
| `@y-core/forge/ui/assets/css/…` | `src/ui/assets/css/*.css` | Every forge stylesheet, by filename. `@y-core/forge/ui/assets/css/forge.css` is **the consumer entry point** — it imports the theme plus the component CSS and carries the `@source` paths that make forge's utility classes generate in a consumer build. `forge-show.css` is that plus the showcase's classes, opt-in. Underneath: `theme-base.css` (semantic tokens over an eleven-stop `--palette-*` ramp, plus the layered component rules), `forge-ui.css` (the utility CSS specific components require), and five ready-made ramps — `theme-slate.css` is the structural model for an app's own |
| `@y-core/forge/ui/contracts` | `src/ui/contracts/mod.ts` | the DOM contract as pure data — `STATE_ATTRS`, `stateAttrs`, `applyStateAttrs`, `SCOPE_EVENTS`, `scopeAttrs`, and the scope-name / selector constants each keyboard primitive shares between its SSR and client halves |
| `@y-core/forge/ui/controls` | `src/ui/controls/mod.ts` | bound control variants that shadow the `ui/core` names — see §5b |
| `@y-core/forge/ui/core` | `src/ui/core/mod.ts` | the SSR component set plus `cn`, `cva` — see [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) |
| `@y-core/forge/ui/core/client` | `src/ui/core/client.ts` | ui/core browser controller registration |
| `@y-core/forge/ui/chrome` | `src/ui/chrome/mod.ts` | `Navbar`, `Toolbar`, `ThemeToggle`, `FOUC_SCRIPT`, `THEME_ATTR` |
| `@y-core/forge/ui/chrome/client` | `src/ui/chrome/client.ts` | theme/nav chrome controller registration |
| `@y-core/forge/ui/client` | `src/ui/client/mod.ts` | `mountTurnstile`, `lazy`, `createSignal`, `computed`, `effect`, `bindField`, `bindGroup`, `resume`, `registerScope` |
| `@y-core/forge/ui/client/htmx` | `src/ui/client/htmx.ts` | htmx bundle |
| `@y-core/forge/ui/server` | `src/ui/server/mod.ts` | `Flash`, `FlashContainer`, `FlashOob`, `Resumable`, `fieldAttr`, `commandAttrs` |
| `@y-core/forge/ui/show` | `src/ui/show/mod.ts` | `ShowcaseContent`, `registerShowcase`, `showcaseRoutes` |
| `@y-core/forge/ui/show/client` | `src/ui/show/client.ts` | showcase browser controller registration |
| `@y-core/forge/validation` | `src/validation/mod.ts` | `v` (valibot facade), `ValidationResult` |
| `@y-core/forge/validation/cli` | `src/validation/cli/mod.ts` | `createGenEnv`, `readWranglerConfig`, `emit` — imports `cli` |

### 3b. Internal Namespaces

| Directory | Purpose | Consumers |
|---|---|---|
| `src/crypto/` | HMAC / timing-safe / base64url utilities, UUIDv7 generation | `form`, `logging`, `security`, `session`, `storage/db`, `storage/r2` |

**`crypto` is sealed-internal:** no export entry, and registered on the `SEALED_INTERNAL`
allowlist in `scripts/validate-exports.ts`. The allowlist is what lets a barrel exist without an
export subpath — **a barrel is valid only if it is exported or explicitly sealed.**

**Never import `crypto` from outside forge.** There is no `@y-core/forge/crypto` subpath.

**Sealed means the path, not the symbol.** Almost everything here is `@internal` plumbing, but a
capability may be implemented in `crypto` and surfaced publicly through the barrel of the
namespace that owns its concern. `uuidv7` / `createUuidv7` are the standing case: implemented
here so `storage/kv` or a future `auth` can consume them without a layering violation, exported
to consumers only via `@y-core/forge/storage/db`
(see [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §1e).
The sealed guarantee is unchanged — there is still no importable `crypto` path.

**The catalog's enumeration guard reaches this subsection.** `validate-namespace-graph.ts` opens
its window on the `### 3a.` heading and closes it at the next `## `, so §3a and §3b are one
window: a catalog table gaining a leaf/integration or side-effect column fails the gate here just
as it would in §3a. Covering the whole of §3 is deliberate — the guard's subject is the document's
catalog, and a table moved one subsection down is the same enumeration in a new place.

**That placement costs one piece of enforcement, knowingly.** `validate-exports`'s
source → barrel pass walks the source files each *exported* namespace owns, so a `@public` symbol
living in `src/crypto/` is outside every namespace it scans. Nothing mechanical will catch a
public crypto symbol that was never added to a surfacing barrel — that entry is manual
discipline, unlike everywhere else in forge where the gate proves it.

---

## 4. Namespace Classification

### 4a. Leaf Namespace Rules

A namespace is **leaf** when it imports only from its own `src/{name}/` directory, external npm
packages, Web APIs, and the foundational primitives of §4c — **zero other cross-namespace forge
imports.**

**Which namespaces are leaf is declared in `scripts/namespace-graph.ts` (`LEAF`), not here.**
That file is authoritative for the graph, and this document enumerates none of it — the reasoning
for that inversion is stated at the head of the file. What stays here is why a classification
holds, which is the part prose is better at.

**A directory is a namespace only when it owns an export subpath.** `src/assets/cli/` has none,
so it is part of `assets` and its `cli` import is `assets`' edge. Classifying by directory instead
of by subpath reports namespaces the package does not have, and edges nobody can import.

**A type-only import still counts as an edge.** It is erased at emit and so cannot create a
runtime cycle (§2), but it is a coupling that a rename breaks, so it is declared with its kind
rather than left out. A namespace whose every edge is type-only is integration all the same.

### 4b. Integration Namespace Rules

A namespace is **integration** when it composes across forge namespaces. **Every edge is declared
in `scripts/namespace-graph.ts` (`EDGES`) as source, target and kind**; an undeclared
cross-namespace import is a defect, and so is a declared edge no source file makes. Imports of §4c
primitives are not edges and are not declared.

`scripts/validate-namespace-graph.ts` walks `src/**`, builds the observed graph and diffs it
against that declaration, so an undeclared import, a stale declaration, and a leaf that quietly
gained an edge each fail the gate rather than passing unnoticed. Three properties of the walk are
load-bearing and not self-evident:

- **Test files are excluded.** Counting `*.test.ts(x)` and `*.browser.ts(x)` would reclassify most
  of the declared leaves as integration and invent edges into `testing` no consumer can reach. A
  fixture import is not a layering claim.
- **The §4c exemption is target-only.** An edge *into* a primitive is exempt; an edge *out of* one
  is a reported violation. That is §4c's own closure property, enforced rather than trusted.
- **An edge's kind is the AND across its import sites.** One value import anywhere makes the whole
  edge a value edge, so declaring an edge type-only is a claim about every site, not the first.

**The `| Namespace | Composes |` table may not come back here either.** The guard windows from the
`### 4a.` heading to the next `## `, so §4a, §4b and §4c are one window and a table written in this
subsection fails the gate at its own line. The reach is the ruling, not an oversight: §4b is the
subsection an integration table most invites, so a guard scoped to §4a alone would leave the
likeliest spot for the enumeration to return unguarded.

**A type-only edge is what lets two namespaces name each other.** Erased at emit, it cannot close a
runtime cycle, so a mutually-naming pair is legal exactly while one direction stays `import type` —
flipping it to a value import would close a real cycle. Kind is therefore a rule, not an
annotation, which is why the gate checks it in both directions.

### 4c. Foundational Primitive Namespaces — `result`, `crypto`, `context`, `validation`

Four namespaces sit **below** the leaf/integration split: **any namespace may import them
without that import counting as a layering violation.**

| Namespace | Public? | Imported as | Consumers |
|---|---|---|---|
| `result` | public | concrete file `../result/result` | anyone |
| `crypto` | sealed-internal (§3b) | `crypto/mod` (barrel, biome-exempt) | `form`, `logging`, `security`, `session`, `storage/db`, `storage/r2` |
| `context` | public | concrete file `../context/{accessor,app-context}` | `app`, `form`, `logging`, `logging/show`, `security`, `session`, `storage/db`, `storage/kv`, `storage/r2`, `testing`, `ui/server`, `ui/show` |
| `validation` | public | `validation/mod` (the `v` facade) | `app`, `assets`, `config`, `context`, `form`, `logging/show`, `security`, `storage/db`, `storage/kv`, `storage/r2` |

`result` is the single result primitive ([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §1).
Because explicit error handling is cross-cutting, `security` / `form` / `storage` importing
`result` is **expected** — treat it like importing a Web API.

**The test is arithmetic, not taste: how many namespaces reach for it independently.** Twelve
reach for `context` and ten for `validation` — near-supersets of the six listed against `crypto`,
which §4c already accepts on exactly this argument. A namespace that a dozen others need is a
primitive; declaring twelve edges instead would describe the same graph while implying a choice
each consumer made, and none of them did.

**The set is closed, so no primitive can reach back into a consumer.** `context` imports
`validation`, `validation` imports `result`, and `crypto` and `result` import nothing — every edge
out of a primitive lands inside the set. That is what makes the carve-out safe, and it is the
property to re-check before admitting a fifth member: a primitive that imported a leaf would put
every consumer of the primitive behind that leaf.

`result` and `context` stay leaf (§4a); their concrete-file import paths keep them clear of the §2
guard without an exemption, while `crypto` carries the biome exemption instead (§2c).
`validation` is leaf and is imported through its barrel, which §2c already exempts.

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

**The trigger counts exported `define*` entry points, not modules.** The two builders share one
internal submission-pipeline module inside `app`; factoring a sequence out of them is an
implementation seam and keeps the count at two, so it does not fire the rule
([`ROUTING_AND_MIDDLEWARE.md`](./ROUTING_AND_MIDDLEWARE.md) §2d).

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
- [ ] `bun run check --only validate-exports` passes
- [ ] Classified leaf or integration in `scripts/namespace-graph.ts` — `LEAF` or an `EDGES` entry per
      cross-namespace import (§4a, §4b); that file is authoritative, not this document
- [ ] `bun run check --only validate-namespace-graph` passes
- [ ] Registered in the `CLAUDE.md` Guide Index if it gains a governing document
