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
> runtime-only principles these rules serve; [`PRODUCTION_TS_RULES.md`](../governance/PRODUCTION_TS_RULES.md)
> for the coding rules inside a namespace; `package.json` `exports` for the subpath names
> themselves, and `src/{ns}/mod.ts` for each namespace's export list.

---

## 0. Quick Reference

- §1 Barrel Rules and Export Discipline: one barrel per namespace, named exports only
- §2 No-Sibling-Barrel Import Rule: the guard against circular dependencies
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

---

## 1. Barrel Rules and Export Discipline

See [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §1 for barrel discipline, the
`export *` ban and all three of its spellings, and what the export gate proves. The files that
enforce it are named in [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) §2b.

---

## 2. No-Sibling-Barrel Import Rule

See [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §2 for the no-sibling-barrel rule, the
cycle it prevents, and the test an exemption must pass. forge's two exemptions — `validation/mod`
and `crypto/mod` — are §4c below, which owns the closure argument that makes them safe.

---

## 3. Authoritative Namespace Catalog

### 3a. Public Export Paths

Rows follow `package.json` `exports` order, which owns the subpath names. The Key Exports
column is an orientation aid — **`src/{ns}/mod.ts` is authoritative for what a namespace
exports.** Leaf/integration classification is declared in `config/namespaces.ts` (see §4a)
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
| `@y-core/forge/pkg` | `src/pkg/mod.ts` | project tooling, both verbs — the release command factory and the gate command factory, with their step presets and transforms. The git/manifest helpers and the gate's formatters are `@internal` ([`ASSET_AND_BUILD_TOOLING.md`](./ASSET_AND_BUILD_TOOLING.md) §5c, §5f) |
| `@y-core/forge/result` | `src/result/mod.ts` | `ok`, `err`, `result`, `toError`, `Result`, `GuardResult`, `ValidationResult` |
| `@y-core/forge/router` | `src/router/mod.ts` | fetch-router re-exports: `route`, `createController`, `createAction`, the method helpers, `createHref`; plus `routePaths` / `RouteFilter` / `forMethod` |
| `@y-core/forge/security` | `src/security/mod.ts` | `createSecurityHeaders`, `getNonce`, `NONCE`, `requestId`, `requireFormContentType`, `cors`, `originProtection`, `crossOriginProtection`, `originGuard`, `verifyOrigin`, `rateLimit` |
| `@y-core/forge/session` | `src/session/mod.ts` | `sessionMiddleware`, `createCookieSessionStorage`, `createMemorySessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/storage/db` | `src/storage/db/mod.ts` | the D1 client, its resolver and binding check, the `sql` tag and its guard, and the UUIDv7 set — which is implemented in `crypto` and surfaced here (§3b) |
| `@y-core/forge/storage/kv` | `src/storage/kv/mod.ts` | `createKVStore`, `resolveKVStore`, `validateKVBinding`, `jsonCodec`, `textCodec`, `bytesCodec` |
| `@y-core/forge/storage/r2` | `src/storage/r2/mod.ts` | `createObjectStore`, `resolveObjectStore`, `validateR2Binding`, `serveObject`, `createSignedObjectUrl`, `verifySignedObjectUrl`, `r2Backend` |
| `@y-core/forge/testing` | `src/testing/mod.ts` | test-only fixtures — see [`TESTING.md`](./TESTING.md) §7 |
| `@y-core/forge/ui/assets` | `src/ui/assets/mod.ts` | `loadSpriteGlyphs`, `parseSpriteGlyphs`, `FORGE_UI_ICON_NAMES`, `forgeUiSpriteSources` |
| `@y-core/forge/ui/assets/glyphs` | `src/ui/assets/glyphs.ts` | `parseSpriteGlyphs`, `loadSpriteGlyphs` |
| `@y-core/forge/ui/assets/css/…` | `src/ui/assets/css/*.css` | Every forge stylesheet, by filename. `@y-core/forge/ui/assets/css/forge.css` is **the consumer entry point** — it imports the theme plus the component CSS and carries the `@source` paths that make forge's utility classes generate in a consumer build. Underneath: `theme-colors.css` (the status hues and alpha ramps), `theme-base.css` (the semantic-token mapping, the `color-scheme` declarations, and the `@theme inline` bridge), `forge-ui.css` (the layered component and state rules), and the ready-made schemes — `theme-neutral.css` is the default, and `theme-slate.css` is the structural model for an app's own |
| `@y-core/forge/ui/contracts` | `src/ui/contracts/mod.ts` | the DOM contract as pure data — the state-attribute and scope-event declarations, and the scope-name and selector constants each keyboard primitive shares between its SSR and client halves |
| `@y-core/forge/ui/controls` | `src/ui/controls/mod.ts` | bound control variants that shadow the `ui/core` names — see §5b |
| `@y-core/forge/ui/core` | `src/ui/core/mod.ts` | the SSR component set plus `cn`, `cva` — see [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) |
| `@y-core/forge/ui/core/client` | `src/ui/core/client.ts` | ui/core browser controller registration |
| `@y-core/forge/ui/chrome` | `src/ui/chrome/mod.ts` | `Navbar`, `Toolbar`, `ThemeToggle`, `FOUC_SCRIPT`, `THEME_ATTR` |
| `@y-core/forge/ui/chrome/client` | `src/ui/chrome/client.ts` | theme/nav chrome controller registration |
| `@y-core/forge/ui/client` | `src/ui/client/mod.ts` | `lazy`, `createSignal`, `computed`, `effect`, `bindControls`, `resume`, `registerScope` |
| `@y-core/forge/ui/client/htmx` | `src/ui/client/htmx.ts` | htmx bundle |
| `@y-core/forge/ui/design/…` | `src/ui/design/*.md` | The design corpus by filename — its root files and, since `*` matches across `/`, the routed `reference/` ones. An asset row: the target is prose an agent reads, not a module — see [`UI_DESIGN_GUIDANCE.md`](./UI_DESIGN_GUIDANCE.md) |
| `@y-core/forge/ui/server` | `src/ui/server/mod.ts` | `Flash`, `FlashContainer`, `FlashOob`, `Resumable`, `fieldAttr`, `commandAttrs` |
| `@y-core/forge/ui/show` | `src/ui/show/mod.ts` | `ShowcaseContent`, `registerShowcase`, `showcaseRoutes` |
| `@y-core/forge/ui/show/client` | `src/ui/show/client.ts` | showcase browser controller registration |
| `@y-core/forge/validation` | `src/validation/mod.ts` | `v` (valibot facade), `ValidationResult` |
| `@y-core/forge/validation/cli` | `src/validation/cli/mod.ts` | `createGenEnv`, `readWranglerConfig`, `emit` — imports `cli` |

### 3b. Internal Namespaces

| Directory | Purpose | Consumers |
|---|---|---|
| `src/crypto/` | HMAC / timing-safe / base64url utilities, UUIDv7 generation | `form`, `logging`, `security`, `session`, `storage/db`, `storage/r2` |

**`crypto` is sealed-internal:** no export entry, and registered on the `sealedInternal` allowlist
in `config/steps.ts`. The allowlist is what lets a barrel exist without an
export subpath — **a barrel is valid only if it is exported or explicitly sealed.**

**Never import `crypto` from outside forge.** There is no `@y-core/forge/crypto` subpath.

**Sealed means the path, not the symbol.** Almost everything here is `@internal` plumbing, but a
capability may be implemented in `crypto` and surfaced publicly through the barrel of the
namespace that owns its concern. `uuidv7` / `createUuidv7` are the standing case: implemented
here so `storage/kv` or a future `auth` can consume them without a layering violation, exported
to consumers only via `@y-core/forge/storage/db`
(see [`STORAGE_BINDINGS.md`](./STORAGE_BINDINGS.md) §1e).
The sealed guarantee is unchanged — there is still no importable `crypto` path.

**The catalog's enumeration guard reaches this subsection.** `namespace-graph.ts` opens
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

**Which namespaces are leaf is declared in `config/namespaces.ts` (`LEAF`), not here.**
That file is authoritative for the graph, and this document enumerates none of it — the reasoning
for that inversion is stated at the head of the file. What stays here is why a classification
holds, which is the part prose is better at.

**A directory is a namespace only when it owns an export subpath.** `src/assets/cli/` has none,
so it is part of `assets` and its `cli` import is `assets`' edge. Classifying by directory instead
of by subpath reports namespaces the package does not have, and edges nobody can import.

**A type-only import still counts as an edge.** It is erased at emit and so cannot create a
runtime cycle (§2), but it is a coupling that a rename breaks, so it is declared with its kind
rather than left out. A namespace whose every edge is type-only is integration all the same.

**Duplicated markup across a leaf boundary is the accepted cost, not an oversight.**
`src/http/fragment.ts` restates the banner classes `src/ui/core/alert.tsx` renders because sharing
them would add an `http → ui/core` edge that `validate-namespace-graph` rejects — and it would put
every consumer of a response builder behind the SSR component tier for a class string. The two
copies drift only in appearance, and both resolve through the same `--status-*` tokens, which is
where the coupling that matters actually lives.

### 4b. Integration Namespace Rules

A namespace is **integration** when it composes across forge namespaces. **Every edge is declared
in `config/namespaces.ts` (`EDGES`) as source, target and kind**; an undeclared
cross-namespace import is a defect, and so is a declared edge no source file makes. Imports of §4c
primitives are not edges and are not declared.

`src/pkg/gate/checks/namespace-graph.ts` walks `src/**`, builds the observed graph and diffs it
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
guard without an exemption, while `crypto` carries the biome exemption instead
([`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §2c).
`validation` is leaf and is imported through its barrel, which the same exemption already covers.

---

## 5. Growth Rules

### 5a. security — Transport-Layer Hardening Only

`security` is strictly transport-layer: CSP, CORS, origin verification, rate limiting, request
identity. **It does not handle authentication, sessions, or permissions.**

Authentication (JWT, OAuth, session login) and permissions/RBAC belong in a new `auth`
namespace — identity is application-layer.

This is forge's map of the concerns [`BOUNDARIES.md`](../governance/BOUNDARIES.md) §2b routes
*out* of a transport-security namespace:

| Concern | Correct home |
|---|---|
| CSRF token minting and verification | `form` — it reads the body |
| Session management and cookie storage | `session` |
| Authentication — JWT, OAuth, magic links, login | a future `auth` |
| Permissions and RBAC | a future `auth` |
| Timing-safe comparison and other primitives | sealed-internal `crypto` (§3b) |
| Input sanitization and schema validation | `form` and `validation` |

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
never `@remix-run/headers` or `@remix-run/html-template` directly. A new HTTP output concern —
a JSON response builder, a streaming helper, content negotiation — is added here rather than in
the namespace that first needs it.

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

See [`NAMESPACE_DESIGN.md`](../governance/NAMESPACE_DESIGN.md) §5 for the four criteria a new
namespace must meet and the checklist it must clear before merge.
