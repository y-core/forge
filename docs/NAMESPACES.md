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
> runtime-only principles these rules serve; [`CODE_RULES.md`](../warden/canon/libs/CODE_RULES.md)
> for the coding rules inside a namespace; `package.json` `exports` for the subpath names
> themselves, and `src/{ns}/mod.ts` for each namespace's export list.

---

## 0. Quick Reference

- §1 Barrel Rules and Export Discipline: one barrel per namespace, named exports only
- §2 No-Sibling-Barrel Import Rule: the guard against circular dependencies
- §3 Authoritative Namespace Catalog: every subpath and its classification
- §3a Public Export Paths: the catalog table
- §3b Internal Namespaces: sealed-internal `crypto`
- §3c `tooling/lint` — a Namespace Whose Barrel Is Also a Plugin: the published surface, the two rule catalogs, and the prebuilt copy a consumer loads
- §4 Namespace Classification: the leaf/integration split
- §4a Leaf Namespace Rules: no cross-namespace forge imports beyond the §4c primitives
- §4b Integration Namespace Rules: where edges are declared, and what the graph gate proves
- §4c Foundational Primitive Namespaces: `result`, `crypto`, `context` and `validation` sit below the split
- §5 Growth Rules: where a new concern belongs
- §5a security — Transport-Layer Hardening Only: what goes to a future `auth`
- §5b ui/core — SSR Components Only: the server/browser split with `ui/client`, and the deliberate `ui/controls` shadowing
- §5c app — Bootstrap and Pipeline Builders: the third-builder trigger and what counts toward it
- §5d http — All HTTP Output Concerns: the canonical output home
- §5e Exported Factory and Type Naming Convention: `create*`, `resolve*`, and type suffixes
- §5f ui/client — Where a Browser Controller Belongs: controllers, signals, and lazy-loaded resources
- §5g tooling — Where a Developer-Facing Tool Belongs: a command, a gate check, a lint rule or a release step, and why none of it is Worker-reachable
- §6 When to Add a New Namespace: criteria and checklist
- §7 Binding a Subpath to Its Governance: a row lists a subpath, a prose rule binds it

---

## 1. Barrel Rules and Export Discipline

See [`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §1 for barrel discipline, the
`export *` ban and all three of its spellings, and what the export gate proves. The files that
enforce it are named in [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md) §2b.

---

## 2. No-Sibling-Barrel Import Rule

See [`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §2 for the no-sibling-barrel rule, the
cycle it prevents, and the test an exemption must pass. forge's two exemptions — `validation/mod`
and `crypto/mod` — are §4c below, which owns the closure argument that makes them safe.

---

## 3. Authoritative Namespace Catalog

### 3a. Public Export Paths

Rows follow `package.json` `exports` order, which owns the subpath names. The Key Exports
column is an orientation aid — **`src/{ns}/mod.ts` is authoritative for what a namespace
exports.** Leaf/integration classification is declared in `config/namespaces.ts` (see §4a)
and side-effect status in `package.json` `sideEffects`; this table enumerates neither. A row here
_lists_ a subpath; what _binds_ it is a prose rule (§7).

**The `./warden*` subpaths are catalogued in [`warden/README.md`](../warden/README.md), not here.**
Warden sits outside `src/`, is a developer tool rather than a runtime namespace, and its five
subpaths — `./warden`, `./warden/checks`, `./warden/knowledge`, `./warden/mcp`, `./warden/steps` —
are published all the same. Their absence from this table is deliberate, so that a reader can tell
it from a namespace that lost its row.

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
_declaration_; a pattern is checked by **expansion and resolution**. `validate-exports` expands each
pattern against disk and requires every member to be published and to actually
`import.meta.resolve`, failing a pattern that matches nothing as dead config. Reverse pass C then
works the other way — every stylesheet on disk must resolve under some key or pattern. _Reachability
is the property that ever went wrong here_, and it is now the property being tested: forge shipped 73
versions of stylesheets that existed, were inside `files[]`, and could not be imported.
`validate-docs` matches a documented subpath against patterns too, and for a pattern match
additionally requires the file to exist — otherwise a citation of `theme-forest.css` would satisfy
the shape and send a reader to a resolution error.

| Export Path | Source | Key Exports |
| --- | --- | --- |
| `@y-core/forge/app` | `src/app/mod.ts` | `createApp`, `Forge`, `applyAssets`, `healthCheck`, `definePage`, `defineAction`, `applyMiddlewareChain`; re-exports `validateBindings`, `validateEnv`, `ConfigKey` from `context` |
| `@y-core/forge/assets` | `src/assets/mod.ts` | `createManifest`, `createSpriteRegistry` — runtime lookups only; the build-time surface is `./tooling/assets` |
| `@y-core/forge/tooling/assets` | `src/tooling/assets/mod.ts` | `defineAssetsConfig`, `loadConfig`, `AssetsConfig`; `buildAll`, `buildCSS`, `buildJS`, `buildSprites`, `copyAssets`; and `createAssetsCommands`, the `forge assets` subtree. The pipeline and the CLI face that drives it are one namespace |
| `@y-core/forge/tooling/cli` | `src/tooling/cli/mod.ts` | `createCommand`, `addCommand`, `execute`, `CliError`; plus the shared foundation the tool namespaces read config through — `resolveAppRoot`, `loadConfigModule`, the JSONC parser and editor, and the barrel parser |
| `@y-core/forge/tooling/gate` | `src/tooling/gate/mod.ts` | the verification gate — the gate command factory, the step builders and presets, and every check. It also owns the changelog and semver parsers, which is what lets `tooling/release` depend on it and never the reverse. The gate's formatters are `@internal` ([`BUILD_TOOLING.md`](./BUILD_TOOLING.md) §2f) |
| `@y-core/forge/tooling/release` | `src/tooling/release/mod.ts` | `createReleaseCommand`, `resolveVersion`, `ReleaseError` — the release workflow, built on the gate's changelog and semver parsers and its barrel parser. The git and manifest helpers are `@internal` ([`BUILD_TOOLING.md`](./BUILD_TOOLING.md) §2c) |
| `@y-core/forge/tooling/lint` | `src/tooling/lint/mod.ts` | forge's oxlint JS plugin, default-exported for `.oxlintrc.json`'s `jsPlugins`, plus the two rule catalogs the gate's design and modern-CSS checks read. Loaded as raw TypeScript: oxlint resolves the source directly, so the plugin ships with no build step. Its types are structural restatements of oxlint's own, because `oxlint` is a devDependency and a published module must not depend on it |
| `@y-core/forge/tooling/lint/plugin` | `src/tooling/lint/plugin.mjs` | The same plugin, prebuilt — the spelling a consumer's `.oxlintrc.json` names in `jsPlugins`. It exists because node refuses to strip types from a file under `node_modules`, so a consumer's oxlint cannot load `mod.ts` at all; `validate-lint-plugin` rebuilds it and fails on any drift from the source |
| `@y-core/forge/tooling/cf` | `src/tooling/cf/mod.ts` | `createCfCommands` — the whole `forge cf` subtree. `createSyncAccountCommand`, `syncBindings` and the resource handlers (`account/`); `createSyncZoneCommand` (`zone/`); `createGenEnvCommand` (`gen/`); and the pieces both scopes share — `createCfClient`, `loadWranglerConfig`, `renderSections`, `detectTarget`. Imports `tooling/cli`, `tooling/term`, `site` |
| `@y-core/forge/tooling/term` | `src/tooling/term/mod.ts` | `stringWidth`, `truncate`, `wrapLines`, `padAlign`, `terminalWidth`, `renderGrid`, `definitionList`, `BORDERS`, `resolveColorLevel`, `createColorize`, `PLAIN` — terminal rendering, and a sink: it imports `node:process` and nothing else in this repository, so every other `tooling/*` namespace may import it and it may import none of them |
| `@y-core/forge/config` | `src/config/mod.ts` | `Config`, `createConfig`, `env`, `resolveConfig` |
| `@y-core/forge/context` | `src/context/mod.ts` | `contextVar`, `createContextKey`, `getAppContext`, `validateBindings`, `validateEnv`, `bindingSchema`; types `AppContext`, `Middleware`, `RequestHandler` — canonical home of binding validation |
| `@y-core/forge/form` | `src/form/mod.ts` | `parseFormData`, `csrfProtection`, `importCsrfKey`, `mintCsrf`, `isHoneypotFilled`, `verifyTurnstile`, `formToObject` — `formToObject` reads a body into a plain object; applying a schema to it is `defineAction`'s |
| `@y-core/forge/jsx` | `src/jsx/mod.ts` | `createElement`, `cloneElement`, `Fragment`, `isValidElement`, `renderToString`, `renderPage` — imports `http` |
| `@y-core/forge/jsx/jsx-runtime` | `src/jsx/jsx-runtime.ts` | automatic-runtime transform target |
| `@y-core/forge/jsx/jsx-dev-runtime` | `src/jsx/jsx-dev-runtime.ts` | automatic-runtime dev transform target |
| `@y-core/forge/jsx/register` | `src/jsx/register.ts` | global JSX runtime registration |
| `@y-core/forge/html/htmx` | `src/html/htmx/mod.ts` | `isHxRequest`, `readHxRequest`, `hxHeaders`, `hxAttrs`, `SWAP`, and the pattern helpers |
| `@y-core/forge/http` | `src/http/mod.ts` | `html`, `escapeHtml`, `safeUrl`, `rawHtml`, `htmlResponse`, `fragmentResponse`, `renderError`, `renderSuccess`, `renderValidationErrors`, the typed header classes |
| `@y-core/forge/logging` | `src/logging/mod.ts` | `createLogger`, `consoleChannel`, `kvLogChannel`, `withMinLevel`, `withRedaction`, `requestLogger`, `requestLog` |
| `@y-core/forge/logging/show` | `src/logging/show/mod.ts` | `loadLogViewer` — the render components and fragment renderers are `@internal` (auth-by-construction) |
| `@y-core/forge/result` | `src/result/mod.ts` | `ok`, `err`, `result`, `toError`, `Result`, `GuardResult`, `ValidationResult` |
| `@y-core/forge/router` | `src/router/mod.ts` | fetch-router re-exports: `route`, `createController`, `createAction`, the method helpers, `createHref`; plus `routePaths` / `RouteFilter` / `forMethod` |
| `@y-core/forge/security` | `src/security/mod.ts` | `createSecurityHeaders`, `getNonce`, `NONCE`, `requestId`, `requireFormContentType`, `cors`, `originProtection`, `crossOriginProtection`, `originGuard`, `verifyOrigin`, `rateLimit` |
| `@y-core/forge/session` | `src/session/mod.ts` | `sessionMiddleware`, `createCookieSessionStorage`, `createMemorySessionStorage`, `createCookie`, `createSignedCookie` |
| `@y-core/forge/site` | `src/site/mod.ts` | `defineSiteConfig`, `resolveSiteConfig`, `SiteConfigSchema`, `renderRobotsTxt`, `renderSitemapXml`, `resolveSitemapEntries`, and the zone builders `buildAllowExpression` / `buildAllowRule` / `buildRedirectRule` with `RESERVED_PREFIXES` |
| `@y-core/forge/storage/db` | `src/storage/db/mod.ts` | the D1 client, its resolver and binding check, the `sql` tag and its guard, and the UUIDv7 set — which is implemented in `crypto` and surfaced here (§3b) |
| `@y-core/forge/storage/kv` | `src/storage/kv/mod.ts` | `createKVStore`, `resolveKVStore`, `validateKVBinding`, `jsonCodec`, `textCodec`, `bytesCodec` |
| `@y-core/forge/storage/r2` | `src/storage/r2/mod.ts` | `createObjectStore`, `resolveObjectStore`, `validateR2Binding`, `serveObject`, `createSignedObjectUrl`, `verifySignedObjectUrl`, `r2Backend`, `UnsatisfiableRangeError` |
| `@y-core/forge/testing` | `src/testing/mod.ts` | test-only fixtures — see [`TESTING.md`](./TESTING.md) §7 |
| `@y-core/forge/ui/assets` | `src/ui/assets/mod.ts` | `loadSpriteGlyphs`, `parseSpriteGlyphs`, `FORGE_UI_ICON_NAMES`, `forgeUiSpriteSources` |
| `@y-core/forge/ui/assets/build` | `src/ui/assets/build/mod.ts` | `forgeUiSpriteSources`, `svgToSymbol`, `sanitizeSVG`, `extractViewBoxes`, `parseColor`, `toHex`, `readThemeTokens`, `resolveToken`, `buildCursors` — build-time only; it computes the artifacts `ui/assets` owns and drives no external builder ([`ASSET_PIPELINE.md`](./ASSET_PIPELINE.md) §2c) |
| `@y-core/forge/ui/assets/glyphs` | `src/ui/assets/glyphs.ts` | `parseSpriteGlyphs`, `loadSpriteGlyphs` |
| `@y-core/forge/ui/assets/css/…` | `src/ui/assets/css/*.css` | Every forge stylesheet, by filename. `@y-core/forge/ui/assets/css/forge.css` is **the consumer entry point** — it imports the theme plus the component CSS and carries the `@source` paths that make forge's utility classes generate in a consumer build. Underneath: `theme-colors.css` (the status hues and alpha ramps), `theme-base.css` (the semantic-token mapping, the `color-scheme` declarations, and the `@theme inline` bridge), `forge-ui.css` (the layered component and state rules), and the ready-made schemes — `theme-neutral.css` is the default, and `theme-slate.css` is the structural model for an app's own |
| `@y-core/forge/ui/contracts` | `src/ui/contracts/mod.ts` | the DOM contract as pure data — the state-attribute and scope-event declarations, and the scope-name and selector constants each keyboard primitive shares between its SSR and client halves |
| `@y-core/forge/ui/contracts/theme` | `src/ui/contracts/theme/mod.ts` | the colour model a forge scheme is generated from and the contrast audit the gate and the customiser share — `buildScale`, `buildTheme`, `schemeCss`, `liveRatios`, the OKLCh conversions, `DIALS` / `Dial` / `DialValues`, `CONTRAST_PAIRS`, `ACCEPTED_CONTRAST`, `CRITERION`. Runtime-neutral: pure data and pure functions ([`THEME_GENERATION.md`](./THEME_GENERATION.md)) |
| `@y-core/forge/ui/controls` | `src/ui/controls/mod.ts` | bound control variants that shadow the `ui/core` names — see §5b |
| `@y-core/forge/ui/core` | `src/ui/core/mod.ts` | the SSR component set — see [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) — plus `cn`, `cva`, which [`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) owns |
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

### 3b. Internal Namespaces

| Directory | Purpose | Consumers |
| --- | --- | --- |
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
source → barrel pass walks the source files each _exported_ namespace owns, so a `@public` symbol
living in `src/crypto/` is outside every namespace it scans. Nothing mechanical will catch a
public crypto symbol that was never added to a surfacing barrel — that entry is manual
discipline, unlike everywhere else in forge where the gate proves it.

### 3c. `tooling/lint` — a Namespace Whose Barrel Is Also a Plugin

**`src/tooling/lint/mod.ts` is the whole public surface behind `./tooling/lint`.** It re-exports the
plugin object from `plugin.ts` under both `lintPlugin` and `default`, so `.oxlintrc.json` can name
the subpath in `jsPlugins`, and it publishes the two rule catalogs — `RULE_CORPUS_PATH` /
`RULE_ENFORCER` and `MODERN_CSS_RULES` — that the gate's design and modern-CSS checks read.

**The catalogs live here, not in the gate, because that is the direction that has no cycle.** The
gate reads them; `report.ts` beside them reads them too, to print the corpus path a finding sends a
reader to. Held in `tooling/gate`, the same two facts made `gate` and `lint` name each other at
value, which `validateNoMutualValuePairs` rejects.

**Every specifier the plugin reaches must carry its `.ts` extension.** oxlint loads a plugin through
Node's ESM resolver, which does not resolve an extensionless specifier — so `mod.ts`, `plugin.ts`,
`report.ts`, the rule modules and both catalogs spell the file. `tsconfig.json` sets
`allowImportingTsExtensions` for exactly this.

**A consumer loads `plugin.mjs`, not the source, and the two copies are held together by the gate.**
Node refuses to strip types from a file under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so `"jsPlugins": ["@y-core/forge/tooling/lint"]`
cannot work in any consumer however forge is installed — the restriction is deliberate and has no
opt-out flag. `./tooling/lint/plugin` therefore publishes a committed esbuild bundle of `mod.ts`,
which resolves nothing at load time and so cannot care how a consumer's `node_modules` is laid out.
Forge is consumed as a git tarball, so there is no publish step that could build it and no
`prepare` hook a consumer runs: committing the artifact is the only form that reaches a consumer
without the consumer building it. The cost is that a generated file can drift from its source, which
is why `validate-lint-plugin` re-bundles and diffs on every gate run, exactly as
`validate-design-scale` does for the generated scale. Forge's own `.oxlintrc.json` keeps naming
`./src/tooling/lint/mod.ts`, so a rule edit takes effect here without a regeneration step —
regenerate with `bun run gen:lint-plugin` before committing it. **Pre-bundling is the remedy only
where the host runtime is not forge's to choose**: oxlint hosts its plugin under node, but
`browserStep` writes playwright's argv itself, so it spawns `bunx --bun playwright test` and the
restriction never applies.

**A published module may not import a build-time package, so oxlint's types are restated in
`types.ts` rather than imported from it.** oxlint is a devDependency, and an import of its types
would make every consumer of forge depend on it. The same constraint reaches anything the plugin
loads at runtime.

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

**A directory is a namespace only when it owns an export subpath.** `src/tooling/root/` has none — it
is the `forge` binary's assembly and nothing imports it — so it belongs to no namespace and
contributes no edges. Classifying by directory instead of by subpath reports namespaces the package
does not have, and edges nobody can import.

**`tooling` is a container, not a namespace.** No `mod.ts` sits at the container root: each child —
`tooling/cli`, `tooling/term`, `tooling/lint`, `tooling/gate`, `tooling/release`, `tooling/cf`,
`tooling/assets` — owns its own subpath and is its own namespace. `resolveNamespaces` matches by
longest directory prefix, so a `tooling` namespace rooted at `src/tooling/` would swallow every one
of them. The container earns its name a second way: **membership is the build-time exemption**
([`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1e), so a Worker-reachable
module under `src/tooling/` is a visible contradiction rather than an argument to re-litigate.

**`validate-build-time-boundary` is what makes that a fact rather than a convention.** It fails any
source outside `src/tooling/` or `src/ui/assets/build/` that imports one of their modules at value —
by relative path or by package subpath, barrelled or not. The rule it enforces is _stronger_ than
the reachability [`LIBRARY_ARCHITECTURE.md`](../warden/canon/libs/LIBRARY_ARCHITECTURE.md) §1e states, and deliberately so: reachability alone is blind to a module no barrel
exports yet, and reachability computed over forge's own tree turns out to be exactly the set a
per-file scan already sees. A type-only import is allowed, because it is erased before anything is
bundled; the layering it still represents is `validate-namespace-graph`'s to judge against a
declared edge. Without this step the boundary was re-litigable one declared edge at a time.

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

See [`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §3b for what makes a namespace
integration, the declare-every-edge rule, and the three properties of the graph walk that are
load-bearing and not self-evident. What is local: edges are declared in `config/namespaces.ts` as
`EDGES`, `src/tooling/gate/checks/namespace-graph.ts` walks `src/**` and diffs against them, the
excluded test files are `*.test.ts(x)` and `*.browser.ts(x)`, and the primitives the walk exempts
are §4c's rather than the canon's §3c.

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
| --- | --- | --- | --- |
| `result` | public | concrete file `../result/result` | anyone |
| `crypto` | sealed-internal (§3b) | `crypto/mod` (barrel, lint-exempt) | `form`, `logging`, `security`, `session`, `storage/db`, `storage/r2` |
| `context` | public | concrete file `../context/{accessor,app-context,env-validation}` | `app`, `form`, `logging`, `logging/show`, `security`, `session`, `storage/db`, `storage/kv`, `storage/r2`, `testing`, `ui/server`, `ui/show` |
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
guard without an exemption, while `crypto` carries the linter exemption instead
([`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §2c).
`validation` is leaf and is imported through its barrel, which the same exemption already covers.

---

## 5. Growth Rules

### 5a. security — Transport-Layer Hardening Only

`security` is strictly transport-layer: CSP, CORS, origin verification, rate limiting, request
identity. **It does not handle authentication, sessions, or permissions.**

Authentication (JWT, OAuth, session login) and permissions/RBAC belong in a new `auth`
namespace — identity is application-layer.

This is forge's map of the concerns [`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §2b routes
_out_ of a transport-security namespace:

| Concern | Correct home |
| --- | --- |
| CSRF token minting and verification | `form` — it reads the body |
| Session management and cookie storage | `session` |
| Authentication — JWT, OAuth, magic links, login | a future `auth` |
| Permissions and RBAC | a future `auth` |
| API-key lifecycle — issue, rotate, revoke, verify | a future `auth` |
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

**Growth rulings on the second-tier primitives** (the daisyUI set reviewed by the
`ui-theming-system` epic, after Table, Link, Kbd, Status, Indicator, Breadcrumbs, Pagination,
Steps, Join, FileInput, Stat, EmptyState and Drawer landed; a second audit of the catalog added
the last six rows):

| Candidate | Ruling | Why |
| --- | --- | --- |
| `Timeline` | **shipped** | Markup-only: an `<ol>` of steps with a rule between them is `Steps` on the vertical axis plus a time column, and no controller. Shipped as `ui/core` `Timeline`. |
| `Carousel` | **shipped** | Markup-only on `scroll-snap`; the platform scrolls, forge supplies the strip, the snap points and the `Pagination`-shaped dot row. Shipped as `ui/core` `Carousel`. |
| `List` | **rejected** | A `<ul>` with `divide-y` and `Stat`/`Card` rows is already expressible; a component would be a class string with a name, which is what the `@utility` layer is for, not `ui/core`. |
| `Rating` | **rejected** | It is a `RadioGroup` whose items paint a glyph — a skin, not a primitive. A consumer composes `RadioGroup.Item` with an `Icon`; the corpus shows the composition instead of shipping it. |
| `Swap` | **rejected** | A `Toggle` whose two children swap on `:has(:checked)`; the `Toggle` already carries the state hook, so the swap is two `group-has-[:checked]:` utilities on the consumer's children. |
| `RadialProgress` | **rejected** | A conic-gradient over `<progress>` semantics has no accessible value beyond what `Progress`/`Meter` already announce, and a SVG ring would be the first canvas-style drawing in `ui/core`. |
| `Calendar` | **rejected** | Needs a client controller, locale and calendar-system handling, and keyboard grid navigation — an application-layer widget, out of scope for the primitive set before v1.0.0. |
| `Stack` | **shipped** | Not a `List`-style class string: the fanned offset is a transform recipe per `placement` kept in one home, and `data-placement` is already a structural attribute. Markup-only `ui/core` `Stack`. |
| `Dock` | **shipped** | `ui/chrome`, beside `Navbar`: a fixed bottom bar of three to five destinations on the same `resolveHref` and `icon` contract; markup-only, the current item is `aria-current="page"` plus `data-selected`. |
| `Filter` | **shipped** | Not a `RadioGroup` skin: the hide-siblings-on-check plus reset composition is `:has()` CSS a consumer would get wrong. A `ToggleGroup type="single"` sibling in `ui/core`, markup-only. |
| `OtpInput` | **shipped** | One native `<input autocomplete="one-time-code">` painted as cells by an `@utility` — one field, one value, native paste and autofill, no controller. A per-cell input array is rejected: it assembles its value client-side. Bound variant in `ui/controls`. |
| `SpeedDial` | **rejected** | Shipped once and removed: a floating action button earns its place only on a screen with no toolbar and no header primary, which the primitive set does not target, and its `asChild` action could not close the panel because invoker commands are button-only. A consumer composes `Popover` with `Button` rows instead. |
| `Megamenu` | **shipped as `Navbar` growth** | Not a new export: a `NavMegaMenu` item renders as a wide `Popover` of `NavGroup` columns beside a list twin for the collapsed panel. `role="menu"` is wrong for a block of links, so it is `Popover` plus `<nav>`, not `core/Menu`. |

The marketing and effect set (hero, footer, mockups, mask, hover-3D, hover gallery, aura, text
rotate, countdown, diff, chat bubble) is app-level composition, not a primitive, and is ruled out as
a class.

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

Exported option and shape types take a suffix chosen by what the type _is_:

| Suffix | Meaning | Examples |
| --- | --- | --- |
| `*Config` | Validated/resolved **data shape**, typically schema-backed | `CsrfConfig`, `AssetsConfig`, `BaseUrlConfig` |
| `*Options` | **Behaviour configuration** passed to a factory or middleware | `SecurityHeadersOptions`, `KVStoreOptions`, `RateLimitOptions` |
| `*Definition` | **Declarative handler/component shape** consumed by a builder | `PageDefinition`, `ActionDefinition`, `NavDefinition` |
| `*Descriptor` / `*Def` | Fine-grained declarative **member shapes** within a definition | `ConfigDescriptor`, `FieldDescriptor`, `FlagDef`, `BindingDef` |

**A declarative shape must not be named `*Config`** (that suffix implies validated env/data),
and **behaviour knobs must not be named `*Config` or `*Definition`.**

### 5f. ui/client — Where a Browser Controller Belongs

**A new browser controller, signal, or lazy-loaded resource goes to `ui/client`.** These are the
things that only exist once a document is live: a mount controller that binds behaviour to an
element, a signal other code subscribes to, a module fetched on demand. None of them has a home in
`ui/core`, which renders markup on the server and stops there (§5b).

The line is what executes the code, not what it is about. A module under `ui/client` is never
imported from a Worker-executed file — the import alone pulls browser globals into the server
bundle ([`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §1). A component that needs
behaviour is therefore built as two pieces: the markup in `ui/core`, and the controller in
`ui/client` that finds it by its `data-*` hooks. The mechanism — the mount contract, the signal
API, the lazy-loading seam — is in [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) §2.

### 5g. tooling — Where a Developer-Facing Tool Belongs

**A new command, gate check, lint rule or release step goes to one of the `tooling` namespaces** —
`tooling/cli`, `tooling/term`, `tooling/gate`, `tooling/lint`, `tooling/release`, `tooling/cf`,
`tooling/assets`. Pick by the artifact the tool acts on: the command surface and its flag parsing
are `tooling/cli`, terminal output is `tooling/term`, a validator the gate runs is `tooling/gate`
(and a check is a function, not a script — [`BUILD_TOOLING.md`](./BUILD_TOOLING.md) §2i), a lint
rule is `tooling/lint`, a release step is `tooling/release`, a Cloudflare API call is
`tooling/cf`, and driving an external builder is `tooling/assets`
([`ASSET_PIPELINE.md`](./ASSET_PIPELINE.md) §2c).

**None of it is ever Worker-reachable.** Membership in `src/tooling/` _is_ the build-time exemption
from the Web-APIs-only rule, which is what §4a settles and `validate-build-time-boundary` enforces
per file — so a tool placed here may use Node APIs, and a module that a Worker path imports may not
be placed here. Reaching for a `tooling` namespace to escape the Web-APIs rule for something a
request handler runs is the one way to get this wrong, and the step fails it.

---

## 6. When to Add a New Namespace

See [`NAMESPACE_DESIGN.md`](../warden/canon/libs/NAMESPACE_DESIGN.md) §5 for the four criteria a new
namespace must meet and the checklist it must clear before merge.

---

## 7. Binding a Subpath to Its Governance

**A catalog row lists a subpath; a prose rule binds it.** §3a tells a reader that `./router` exists
and what it exports. It does not tell them which rule decides what may go in there, what may not,
and what the namespace is answerable to — and a subpath named nowhere but in a table row is
governed by nothing, however complete the table looks.

**Every published subpath is bound by at least one prose rule, or is declared exempt with its
reason.** A rule binds a subpath by naming it in prose: `./ui/client` is bound by §5f, `./http` by
§5d, `./tooling/*` by §5g. An exemption is as good as a rule when the reason is stated — the
`./jsx/jsx-runtime` family is written by the compiler and reached by no author, so no rule about
what belongs there could be acted on.

**Existence only.** The reconciliation runs both ways — every subpath has a rule, and every rule
names a live subpath — and it asks nothing about whether the rule is any good. Adequacy is a
judgement a check cannot make, and a check that pretended to make it would be trusted for a
guarantee it never gave ([`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §5c).

**Never a hand-maintained register.** There is no subpath → rule table anywhere, here or elsewhere.
The binding is derived from the citations already in the prose and the `exports` map, which is why
it cannot fall out of date with either — the same reason `AGENT_GUIDE.md` §5c refuses to register
the documents it governs at all: a list disagrees with the directory it describes, and then a reader
has two answers and no way to pick.

`validate-docs` reports an unbound subpath as a **warning**, not a failure. The backlog it found on
the day it was written is a backlog, and a check that fails a build over one gets exempted wholesale
instead of worked down. It is promoted to a failure once the list is empty.

**This rule lives here rather than in the canon, and that placement is deliberate.** It is about a
repository with an `exports` map, so `canon/libs/` is where it would be portable to — but it has
been measured against exactly one corpus, forge's. It is promoted to the canon when a second
repository needs it. That order is reversible; the other is not, because a canon rule is
byte-identical in every repository that clones it and a rule that turned out to fit only forge
would already be law everywhere.
