---
title: Namespace Design
description: "Barrel rules, leaf-versus-integration classification, where a new concern belongs, and when to add a namespace."
audience: internal
---

# Namespace Design

> Owns barrel discipline, the leaf/integration classification, the publishing rules for a subpath, and the growth rules. Other documents link here
> rather than restating the classification.
>
> Defers to: [`FORGE_STRUCTURE.md`][la] for the facade and runtime-only principles these rules serve; [`CODE_RULES.md`][cr] for the coding
> rules inside a namespace; `package.json` `exports` for the subpath names themselves, and `src/{ns}/mod.ts` for each namespace's export list;
> each namespace's README for what it is and how to use it (§3a).

---

## 0. Quick Reference

- §1 Barrel Rules and Export Discipline: one barrel per namespace, named exports only
- §2 No-Sibling-Barrel Import Rule: the guard against circular dependencies
- §3 Publishing a Subpath: where a namespace is described, and what a subpath may publish
- §3a A Namespace Is Described by Its Own README: the one pointer, and which file is authoritative for which fact
- §3b Internal Namespaces: the sealed-internal `crypto/primitives`
- §3c A Surface Node Loads Is Published Prebuilt: the committed bundle a consumer's node process loads, and the build-time packages a published
  module may not import
- §3d A Non-Module File or an Asset Family Is Published by Subpath: a file named by path, a plain-string value, one pattern per family
- §4 Namespace Classification: the leaf/integration split
- §4a Leaf Namespace Rules: no cross-namespace forge imports beyond the §4c primitives
- §4b Integration Namespace Rules: where edges are declared, and what the graph gate proves
- §4c Foundational Primitive Namespaces: `result`, `crypto/primitives`, `context` and `validation` sit below the split
- §5 Growth Rules: where a new concern belongs
- §5a security — Transport-Layer Hardening Only: what goes to `auth` instead
- §5b ui/core — SSR Components Only: the server/browser split with `ui/client`, and the deliberate `ui/controls` shadowing
- §5c app — Bootstrap and Pipeline Builders: the third-builder trigger and what counts toward it
- §5d http — Responses, Headers and Paths: the canonical home for what a handler sends, and why escaping is not part of it
- §5e Exported Factory and Type Naming Convention: `create*`, `resolve*`, and type suffixes
- §5f ui/client — Where a Browser Controller Belongs: controllers, signals, and lazy-loaded resources
- §5g tooling — Where a Developer-Facing Tool Belongs: a command, a gate check, a lint rule or a release step, and why none of it is
  Worker-reachable
- §5h auth — Identity, and Only the Domain of It: what `auth` owns, and the split that keeps a `Response` out of it
- §5i dev — A Dev-Only Allowance, Never a Boolean on a Production Option: where a relaxation production must not hold belongs
- §5j `render` — One Namespace per Renderer: the container and its children, the call shape, the JSX edge, the `render/pdf` bare-component
  carve-out, and what `render/markdown` leaves to an app
- §5k `crypto/keyring` — Values Signed or Sealed Under the App's Own Root Secret: the `crypto` container, what routes here rather than to
  `auth`, the one-way edge between them, and why the other HMAC consumers keep their own keys
- §5l `security` — Webhook Message Authentication, by Local Ruling: why a body-reading signature check is transport-layer
- §5m `html` — Safe-Markup Primitives: what belongs here, and why it is a leaf below both `http` and `render`
- §6 When to Add a New Namespace: criteria and checklist
- §7 Binding a Subpath to Its Governance: a prose rule binds a subpath, and naming it does not

---

## 1. Barrel Rules and Export Discipline

See [`NAMESPACE_DESIGN.md`][nd-1] §1 for barrel discipline, the `export *` ban and every spelling of it, and what the export gate proves. The
files that enforce it are named in [`SOURCE_OF_TRUTH.md`][sot-2b] §2b.

---

## 2. No-Sibling-Barrel Import Rule

See [`NAMESPACE_DESIGN.md`][nd-2] §2 for the no-sibling-barrel rule, the cycle it prevents, and the test an exemption must pass. forge's
exemptions — `validation/mod` and `crypto/primitives/mod` — are §4c below, which owns the closure argument that makes them safe.

---

## 3. Publishing a Subpath

### 3a. A Namespace Is Described by Its Own README

**What a namespace is and how to use it lives in its own README, and no `docs/` document restates it.** The README is the one in the
namespace's own directory, or else the nearest one above it below `src/` — `auth/web` is taught by `src/auth/README.md`. `package.json` `exports`
is authoritative for the subpath names, `src/{ns}/mod.ts` for what a namespace exports, `config/namespaces.ts` for its classification and edges
(§4a), and `package.json` `sideEffects` for side-effect status. `validate-packaging` fails a published namespace that resolves to no README, and
`validate-namespace-graph` fails a table in this document that names a namespace's source directory or subpath. A README describes a subpath; what
_binds_ it is a prose rule (§7).

**The `./warden*` subpaths are described by [`warden/README.md`][warden-readme].** Warden sits outside `src/` and is a developer tool rather than a
runtime namespace, so the README rule above reads `src/` namespaces only. `package.json` lists its module subpaths, alongside the
`./warden/canon/*.md` asset pattern the canon is read through.

### 3b. Internal Namespaces

**`crypto/primitives` is sealed-internal:** no export entry, and registered on the `sealedInternal` allowlist in `config/steps.ts`. The allowlist
is what lets a barrel exist without an export subpath — **a barrel is valid only if it is exported or explicitly sealed.**

**Never import `crypto/primitives` from outside forge.** There is no `@y-core/forge/crypto/primitives` subpath, and its parent `crypto` is a
container with no barrel of its own (§5k).

### 3c. A Surface Node Loads Is Published Prebuilt

**Rule data that both `tooling/gate` and `tooling/lint` read lives in `tooling/lint`, because that is the direction with no cycle.** Held in
`tooling/gate`, the rule catalogs would make the pair name each other at value, which `validateNoMutualValuePairs` rejects (§4b).

**A surface a consumer's node process loads ships as a committed bundle under its own subpath.** Node refuses to strip types from a file under
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), deliberately and with no opt-out flag, so a consumer's oxlint cannot load
`@y-core/forge/tooling/lint` from source however forge is installed; `@y-core/forge/tooling/lint/plugin` is the bundle it names instead. Forge is
consumed as a git tarball, so there is no publish step that could build the bundle and no `prepare` hook a consumer runs: committing the artifact is
the only form that reaches a consumer without the consumer building it. The cost is that a generated file can drift from its source, so a drift
check rebuilds each bundle on every gate run and fails on any difference — one step per row of `config/bundles.ts`, which names each step.

**Playwright is the second such host, and forge cannot choose bun on the consumer's behalf.** A `playwright.config.ts` importing a forge subpath
dies at config load with the same error, and under bun a dev server playwright spawns binds where the browser cannot reach it — specs that pass
under `bunx playwright test` fail with `net::ERR_ABORTED` under `bunx --bun playwright test`. So `@y-core/forge/tooling/gate/chromium` publishes a
committed bundle of the one symbol a config needs. A consumer's browser spec loads the same way, so `@y-core/forge/testing/totp` is a committed
bundle of `totpCodes`, which also stays on the `./testing` barrel for a suite running under bun. A config that reads `wrangler.jsonc` loads the
same way, so `@y-core/forge/tooling/cf/wrangler` is a committed bundle of `parseWranglerConfig` alone.

Forge's own `playwright.config.ts` imports the `.mjs` rather than the source, so forge's gate exercises the exact module a consumer loads and a
broken bundle fails here rather than there.

**A published module may not import a build-time package, so oxlint's types are restated in `types.ts` rather than imported from it.** oxlint is a
devDependency, and an import of its types would make every consumer of forge depend on it. The same constraint reaches anything the plugin loads at
runtime.

**A bundle keeps its package dependencies as imports instead of inlining them**, so the wrangler bundle imports `valibot` from the consumer's
install. A bundle may therefore import only `node:` builtins and the packages forge lists under `dependencies`.

### 3d. A Non-Module File or an Asset Family Is Published by Subpath

**A non-module file a consumer must name by path is published too, or the facade has a hole in it.** `@y-core/forge/auth/schema.sql` is the standing
case: a consumer composing its database names forge's identity tables in its own load order, ahead of its own DDL, and the only alternative to a
subpath is a literal reach into `node_modules/@y-core/forge/src/` — which is the one thing a facade exists to make unnecessary, and which no rename
inside forge would then survive.

**Its `exports` value is a plain string, not a `{types, import}` object.** Tailwind's CSS resolver runs `conditionNames: ["style"]`, so neither
`types` nor `import` matches and an object entry is unreachable from `@import` however correct it looks.

**A family of assets is one subpath pattern, not one key per file.** `./ui/assets/css/*.css` is a Node subpath pattern — the supported replacement
for the directory exports removed in Node 17 — and `files[]` already ships the whole of `src/ui/`, so a new stylesheet is addressable the moment it
is written.

---

## 4. Namespace Classification

### 4a. Leaf Namespace Rules

A namespace is **leaf** when it imports only from its own `src/{name}/` directory, external npm packages, Web APIs, and the foundational primitives
of §4c — **zero other cross-namespace forge imports.**

**Which namespaces are leaf is declared in `config/namespaces.ts` (`LEAF`), not here.** That file is authoritative for the graph, and this document
enumerates none of it — the reasoning for that inversion is stated at the head of the file, and `validate-namespace-graph` fails the enumeration's
return anywhere in this document. What stays here is why a classification holds, which is the part prose is better at.

**A directory is a namespace only when it owns an export subpath.** `src/tooling/root/` has none — it is the `forge` binary's assembly and nothing
imports it — so it belongs to no namespace and contributes no edges. Classifying by directory instead of by subpath reports namespaces the package
does not have, and edges nobody can import.

**`tooling` is a container, not a namespace.** No `mod.ts` sits at the container root: each child owns its own subpath and is its own namespace.
`resolveNamespaces` matches by longest directory prefix, so a `tooling` namespace rooted at `src/tooling/` would swallow every one of them. The
container earns its name a second way: **every module under it qualifies for the build-time exemption** ([`LIBRARY_ARCHITECTURE.md`][la-1e] §1e), so
a Worker-reachable module under `src/tooling/` is a visible contradiction rather than an argument to re-litigate.

**The exemption is reachability, and a path is only evidence of it.** That section says so in those words: membership in `src/tooling/` does not
_confer_ the exemption, it makes the reachability answer obvious enough to check per file. Where the two come apart — `src/ui/assets/build/`, a
`guarded` entry for that reason, and the build-time modules of `testing`, the mixed-namespace case the same section settles — **the exemption
reaches a mixed namespace's build-time modules alone, and the burden sits on the caller.** [`TEST_RUNNERS.md`][testing-7f] §7f owns how `testing`
publishes such a module under its own subpath and off its barrel.

**`validate-import-boundary` is what makes that a fact rather than a convention.** It fails any source outside `src/tooling/` or
`src/ui/assets/build/` that imports one of their modules at value — by relative path or by package subpath, barrelled or not. The rule it enforces
is _stronger_ than the reachability that section states, and deliberately so: reachability alone is blind to a module no barrel exports yet, and
reachability computed over forge's own tree turns out to be exactly the set a per-file scan already sees. A type-only import is allowed, because it
is erased before anything is bundled; the layering it still represents is `validate-namespace-graph`'s to judge against a declared edge. Without
this step the boundary was re-litigable one declared edge at a time.

**A type-only import still counts as an edge.** It is erased at emit and so cannot create a runtime cycle (§2), but it is a coupling that a rename
breaks, so it is declared with its kind rather than left out. A namespace whose every edge is type-only is integration all the same.

**Duplicated markup across a leaf boundary is the accepted cost, not an oversight.** `src/render/htmx/fragment.ts` restates the banner classes
`src/ui/core/alert.tsx` renders because sharing them would add a `render/htmx → ui/core` edge that `validate-namespace-graph` rejects — and it
would put every consumer of an htmx helper behind the SSR component tier for a class string. Both copies drift only in appearance, and both resolve
through the same `--status-*` tokens, which is where the coupling that matters actually lives.

### 4b. Integration Namespace Rules

See [`NAMESPACE_DESIGN.md`][nd-3b] §3b for what makes a namespace integration, the declare-every-edge rule, and the properties of the graph
walk that are load-bearing and not self-evident. What is local: edges are declared in `config/namespaces.ts` as `EDGES`,
`src/tooling/gate/checks/namespace-graph.ts` walks `src/**` and diffs against them, the excluded test files are `*.test.ts(x)` and
`*.browser.ts(x)`, and the primitives the walk exempts are §4c's rather than the canon's §3c.

**A type-only edge is what lets two namespaces name each other.** Erased at emit, it cannot close a runtime cycle, so a mutually-naming pair is
legal exactly while one direction stays `import type` — flipping it to a value import would close a real cycle. Kind is therefore a rule, not an
annotation, which is why the gate checks it in both directions.

### 4c. Foundational Primitive Namespaces — `result`, `crypto/primitives`, `context`, `validation`

`result`, `crypto/primitives`, `context` and `validation` sit **below** the leaf/integration split: **any namespace may import them without that
import counting as a layering violation.**

`result` is the single result primitive ([`FORGE_ERRORS.md`][eh-1] §1). Because explicit error handling is cross-cutting, `security` / `form` /
`storage` importing `result` is **expected** — treat it like importing a Web API.

**The test is arithmetic, not taste: how many namespaces reach for it independently.** The count is the namespaces whose source imports it, which no
declared edge records — `context` and `validation` are reached for across near-supersets of the namespaces that reach for `crypto/primitives`, which
this section admits on exactly this argument. A namespace that most others need is a primitive; declaring an edge per consumer instead would
describe the same graph while implying a choice each consumer made, and none of them did.

**The set is closed, so no primitive can reach back into a consumer.** `context` imports `validation`, `validation` imports `result`, and
`crypto/primitives` and `result` import nothing — every edge out of a primitive lands inside the set. That is what makes the carve-out safe, and it
is the property to re-check before admitting another member: a primitive that imported a leaf would put every consumer of the primitive behind that
leaf.

`result` and `context` stay leaf (§4a); their concrete-file import paths keep them clear of the §2 guard without an exemption, while
`crypto/primitives` carries the linter exemption instead ([`NAMESPACE_DESIGN.md`][nd-2c] §2c). `validation` is leaf and is imported through its
barrel, which the same exemption already covers.

---

## 5. Growth Rules

### 5a. security — Transport-Layer Hardening Only

`security` is strictly transport-layer: CSP, CORS, origin verification, rate limiting, request identity, webhook signing and verification. **It
does not handle authentication, sessions, or permissions.**

Identity is application-layer, so authentication and permissions belong in `auth` (§5h).

This is forge's map of the concerns [`BOUNDARIES.md`][boundaries-2b] §2b routes _out_ of a transport-security namespace:

| Concern | Correct home |
| --- | --- |
| CSRF token minting and verification | `form` — it reads the body |
| Session management and cookie storage | `session` |
| Authentication — JWT, OAuth, magic links, login | `auth` (§5h) |
| Permissions and RBAC | `auth` (§5h) |
| API-key lifecycle — issue, rotate, revoke, verify | `auth` (§5h) |
| Timing-safe comparison and other primitives | sealed-internal `crypto/primitives` (§3b) |
| Input sanitization and schema validation | `form` and `validation` |

### 5b. ui/core — SSR Components Only

`ui/core` contains SSR JSX components; client behaviour lives in `ui/client`. If the component count exceeds ~25, introduce sub-barrels
(`ui/core/form/mod.ts`) but keep the export path stable.

**`ui/controls` intentionally shadows the `ui/core` control names** — `Input`, `Textarea`, `Select`, `Slider`, `Switch`, `ToggleGroup` are exported
from both, unbound from `ui/core` and bound from `ui/controls`. **The collision is by design; do not rename either side.**

**Rule: a module must import a given control name from exactly one of those barrels, never both.** The mechanism is in
[`UI_SSR_COMPONENTS.md`][usc].

**Growth rulings on the second-tier primitives** (the daisyUI set):

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
| `SpeedDial` | **rejected** | A floating action button earns its place only on a screen with no toolbar and no header primary, which the primitive set does not target, and its `asChild` action could not close the panel because invoker commands are button-only. A consumer composes `Popover` with `Button` rows instead. |
| `Megamenu` | **shipped as `Navbar` growth** | Not a new export: a `NavMegaMenu` item renders as a wide `Popover` of `NavGroup` columns, which hold links and slots, beside a disclosure twin for the collapsed panel. `role="menu"` is wrong for a block of links, so it is `Popover` plus `<nav>`, not `core/Menu`. |

The marketing and effect set (hero, footer, mockups, mask, hover-3D, hover gallery, aura, text rotate, countdown, diff, chat bubble) is app-level
composition, not a primitive, and is ruled out as a class.

### 5c. app — Bootstrap and Pipeline Builders

`app` owns bootstrap and the `definePage` / `defineAction` pipeline builders. **If a third pipeline-builder variant is needed, extract all builders
into a new `handler` namespace.**

**The trigger counts exported `define*` entry points, not modules.** Both builders share one internal submission-pipeline module inside `app`;
factoring a sequence out of them is an implementation seam and keeps the count at two, so it does not fire the rule
([`ROUTING_AND_MIDDLEWARE.md`][ram-2d] §2d).

### 5d. http — Responses, Headers and Paths

`http` is the canonical home for response builders, header value classes and URL paths — never `@remix-run/headers` directly. A new HTTP output
concern — a JSON response builder, a streaming helper, content negotiation — is added here rather than in the namespace that first needs it.

**Escaping is not an HTTP output concern, and lives in `html` (§5m).** `http` names `html` at value: `htmlResponse` takes the `SafeHtml` a
renderer produces, and `safeRedirectPath` strips the same control characters `safeUrl` does.

### 5e. Exported Factory and Type Naming Convention

**Factories use the `create*` prefix — never `make*`** (`createApp`, `createSecurityHeaders`, `createD1Client`). **Request-time binding accessors
use `resolve*`** (`resolveKVStore`, `resolveObjectStore`). **Declarative handler configs use `define*`** (`definePage`, `defineAction`).

`ok` / `err` are the one documented exception ([`FORGE_ERRORS.md`][eh-1a] §1a).

**`startDevServer` is the second, and it is a verb exception** — [`NAMESPACE_DESIGN.md`][nd-4a] §4a puts one in the owning `docs/` doc, and this is
that entry. What `@y-core/forge/testing/workerd` returns is a live `wrangler dev` process the caller **must** `stop()`, and `create*` names a value
that needs nothing further — a reader who believed it would leak a process group. [`TEST_RUNNERS.md`][testing-7f] §7f owns the rest.

Exported option and shape types take a suffix chosen by what the type _is_:

| Suffix | Meaning | Examples |
| --- | --- | --- |
| `*Config` | Validated/resolved **data shape**, typically schema-backed | `CsrfConfig`, `AssetsConfig`, `BaseUrlConfig` |
| `*Options` | **Behaviour configuration** passed to a factory or middleware | `SecurityHeadersOptions`, `KVStoreOptions`, `RateLimitOptions` |
| `*Definition` | **Declarative handler/component shape** consumed by a builder | `PageDefinition`, `ActionDefinition`, `NavDefinition` |
| `*Descriptor` / `*Def` | Fine-grained declarative **member shapes** within a definition | `ConfigDescriptor`, `FieldDescriptor`, `FlagDef`, `BindingDef` |

**A declarative shape must not be named `*Config`** (that suffix implies validated env/data), and **behaviour knobs must not be named `*Config` or
`*Definition`.**

**An adapter is named by the contract it fulfils; the backing is the argument's type.** `createUserStore(db: D1Client)` is the spelling, never
`createD1UserStore`. `createD1Client` is product-named because it wraps D1's own API; an adapter wraps a forge contract, and the product beneath it
is a detail of the argument that a later adapter may change. A second adapter for the same contract takes the name of what distinguishes it
(`createDurableChallengeStore`), never the product.

### 5f. ui/client — Where a Browser Controller Belongs

**A new browser controller, signal, or lazy-loaded resource goes to `ui/client`.** These are the things that only exist once a document is live: a
mount controller that binds behaviour to an element, a signal other code subscribes to, a module fetched on demand. None of them has a home in
`ui/core`, which renders markup on the server and stops there (§5b).

The line is what executes the code, not what it is about. A module under `ui/client` is never imported from a Worker-executed file — the import
alone pulls browser globals into the server bundle ([`BOUNDARIES.md`][boundaries-1] §1). A component that needs behaviour is therefore built as two
pieces: the markup in `ui/core`, and the controller in `ui/client` that finds it by its `data-*` hooks. The mechanism — the mount contract, the
signal API, the lazy-loading seam — is in [`UI_CLIENT_RUNTIME.md`][ucr-2] §2.

### 5g. tooling — Where a Developer-Facing Tool Belongs

**A new command, gate check, lint rule or release step goes to one of the `tooling` namespaces.** Pick by the artifact the tool acts on: the
command surface and its flag parsing are `tooling/cli`, terminal output is `tooling/term`, a validator the gate runs is `tooling/gate` (and a check
is a function, not a script — [`BUILD_TOOLING.md`][bt-2i] §2i), a lint rule is `tooling/lint`, a release step is `tooling/release`, reducing a
working tree to its skeleton is `tooling/curate`, a Cloudflare API call is `tooling/cf`, a D1 migration, compose, backup or seed verb is
`tooling/db` ([`DATABASE_MANAGEMENT.md`][dm]), and driving an external builder is `tooling/assets` ([`ASSET_PIPELINE.md`][ap-2c] §2c).

**None of it is ever Worker-reachable.** That is what earns every module here the build-time exemption from the Web-APIs-only rule — the exemption
is the unreachability and the path is the evidence (§4a), which `validate-import-boundary` checks per file. So a tool placed here may use Node
APIs, and a module a Worker path imports may not. Reaching for a `tooling` namespace to escape the Web-APIs rule for something a request handler
runs is the one way to get this wrong, and the step fails it. **The converse does not hold:** `@y-core/forge/testing/workerd` reads
`node:child_process` and is never Worker-reachable, and still belongs to `testing` — a test fixture is none of the artifacts above.

### 5h. auth — Identity, and Only the Domain of It

**`auth` owns identity: who a user is, which credentials prove it, and what a session may then do.** Authentication (passwordless email
verification, magic links, WebAuthn passkeys, TOTP), permissions and RBAC, and the API-key lifecycle all belong here — §5a routes each of them out
of `security`, which is transport-layer and stops at the request.

**The namespace produces no `Response`, renders no markup and touches no `Session`.** A route that mounts a sign-in page, a view that renders one,
and a middleware that guards one are the web layer's, published under its own subpath. That split is the same one `logging` and `logging/viewer`
already carry, and it is what keeps `auth` testable with no authenticated world to build first ([`BOUNDARIES.md`][boundaries-2c] §2c).

**`@y-core/forge/auth/web` is that web layer, and it owns everything a request touches.** **Anything that builds a `Response`, reads or writes a
`Session`, parses a form body or emits markup belongs here** — and nowhere else in the capability.

**The edge is one-way: `auth/web` imports `auth`, and `auth` never names `auth/web`.** A domain rule that wants to redirect, or a store that wants
to 404, is reaching across the split: the rule returns a reason, and the web layer alone decides what `Response` that reason becomes. The mechanism
is `validateNoMutualValuePairs` in `src/tooling/gate/checks/namespace-graph.ts`, which fails any two namespaces that name each other at value — so
the first domain module to import the web layer fails the graph rather than waiting for a reviewer to notice. That is also why `authReturnPath`, the
helper that reduces a `?next=` value with `safeRedirectPath`, sits in `auth/web`: in `auth` it would have created an `auth → http` edge the domain
does not have.

**`auth-federation`'s `auth/oidc` and `auth/provider` inherit the rule unchanged.** Each is a domain namespace publishing its own subpath: it may
name `auth`, `auth` may name none of them, and the routes and callback pages that mount either are `auth/web`'s.

**The browser half lives with the namespace whose server half stamps its contract.** The passkey controller is `src/auth/client/passkey.ts`,
published through `./auth/client`, and reads the `PASSKEY_*` contract from `auth` — pure data with no imports, so the domain namespace stays
Worker-safe and the browser bundle takes only the constants. `ui/client` keeps the runtime it lends (`registerScope`, `ownerWindow`), and
`ssrBoundaryStep` names both client directories. Nothing auth-specific goes in `ui/contracts` or `ui/client`.

### 5i. dev — A Dev-Only Allowance, Never a Boolean on a Production Option

**A relaxation that must not reach production goes in `dev` as an allowance, never on the production option as a boolean.** `rateLimit`'s absent
binding is the standing case: it takes `dev?: DevAllowance` — a token `@y-core/forge/dev` mints and nothing else can construct
([`src/dev/README.md`][dev-readme]).

**The reason is where the boolean could be set from.** `rateLimit({ required: false })` sat on a production option, so a shared middleware module
both entries import could set it, and a missing `RATE_LIMITER` binding in production then disabled rate limiting in silence. Minting an allowance is
an _import_, and `validate-dev-boundary` fails that import from anything a `wrangler deploy` bundles — so the seam is a fact about the module graph
rather than a promise about a call site.

**The type and the check each hold it.** The type makes the relaxation unrepresentable without the token; rule C of the check makes the import that
mints one a gate failure outside a `*.dev.ts` entry. The _type_ crosses freely, because it is erased at emit — which is what lets a production
option name `DevAllowance` and still be unable to build one.

**`dev` is a leaf, and stays one.** It owns the token and the option shape; every relaxation stays in the namespace that owns its concern
(`security`, `app`, `form`), each of which names `dev` at type only. A development _behaviour_ — a fake binding, a dev route, a reload channel — is
not this namespace's: fakes are `testing`'s, and a dev route is the app's own `*.dev.ts` entry.

**Where a relaxation is legitimate in production, it stays an explicit literal.** `csrfProtection({ subject: false })` is the idiom — a grep finds
every call site that took it ([`INPUT_VALIDATION.md`][iv-3a] §3a). The token is for the ones that are not legitimate, and the difference must stay
visible at the call site.

### 5j. `render` — One Namespace per Renderer

**`render/` is a container, not a namespace.** It holds one child per renderer — `render/jsx` the SSR runtime, `render/htmx` the htmx response
helpers, `render/markdown` the markdown engine and `render/pdf` the document engine — and owns no code of its own. The shape is precedented by
`tooling/`: the parent directory names a concern, and every namespace under it is classified, documented and gated separately. A renderer's own
children are namespaces too, matched by the same longest-prefix rule — so a parent reaching into `@y-core/forge/render/pdf/fonts` is a declared
edge, never an internal import, and the pair never points both ways at value.

**A renderer goes in its own child, never in `http`.** `http` owns the _response_ — `htmlResponse` and `pdfResponse` are its, because handing a
body to a client is an HTTP output concern (§5d) — and takes the body without knowing how it was made. That is what keeps the dependency one-way and
lets a renderer carry a large engine without any of it reaching the response path. `render/jsx` and `render/htmx` escape through `html` (§5m);
`render/markdown` keeps its own escaper, which writes the hex references CommonMark conformance expects, and stays a leaf.

**A component takes one props object, with `children` inside it.** Never `Component(options, children)` — the single-argument shape is what forge's
JSX runtime calls (`src/render/jsx/jsx-runtime.ts`, `FC<P>` in `src/render/jsx/types.ts`), so the same component is callable by hand and as JSX,
and a second call convention never has to be kept in step with the first.

**A renderer that takes markup depends on `render/jsx` at value and publishes its own `jsx-runtime`.** `jsx()` builds a descriptor rather than
calling the component, so the renderer lowers the tree itself, and recognising a fragment means holding the `Fragment` marker — a value import,
which is why `render/pdf` is not a leaf. The runtime is its own because TypeScript resolves the `JSX` namespace through `jsxImportSource`:
`@y-core/forge/render/pdf/jsx-runtime` admits a component answering with a `PdfElement` and declares no intrinsic elements, so `<div>` is a mistake
rather than a fallback. Widening `./render/jsx/jsx-runtime` instead would let a PDF component stand where `renderToString` is called, which is the
guarantee that runtime exists to keep.

**Inside `render/pdf`, components carry bare names.** `Text`, `Row`, `Stack` and `Box` are the spelling, and this is a deliberate carve-out from
[`CODE_RULES.md`][cr-7] §7's domain-word requirement: the namespace qualifier is the domain word at every call site, and `pdf.Text` reads as a
domain-scoped name that `PdfText` would only repeat. `warden-review` cites this section rather than re-arguing the point per review. The carve-out
covers `render/pdf`'s component names only — a factory, a type or a constant leaving the barrel takes its domain word as usual (§5e), and so does
every other renderer. **A bare name may mean something else in another namespace**: `ui/core`'s `Stack` layers its children where `render/pdf`'s
sequences them, and a file importing both aliases one.

**`@y-core/forge/render/markdown` holds the CommonMark and GFM engine and the dialect constructs any app could compose, and nothing that decides
what a particular app's markdown means.** A construct is parameterised wherever an app would differ: callout kinds are an argument, an embed's id is
what the app's `embedId` answers, and a wiki link's target stays the raw text the app resolves. A fixed set of kinds, an id format, a target
resolver, a render schema or the handlers that write an app's classes stay in the app, because each is a decision about that app's pages. Every
node type a construct produces is declared in the namespace's own types, so no consumer augments forge's tree across the package boundary.

**`@y-core/forge/render/markdown/editor/client` is the CodeMirror viewport for the same markdown, and it sits under `render/markdown`, not `ui`.**
Under `ui` it would belong in `ui/client` (§5f), and every `ui/client` consumer would then have to install CodeMirror. The editor is browser-only by
its `client` segment ([`BOUNDARIES.md`][boundaries-1] §1), imports nothing from `render/markdown`, and takes the dialect it decorates as an injected
option, so an app's constructs reach it without forge knowing them. CodeMirror is its optional peer dependency.

### 5k. `crypto/keyring` — Values Signed or Sealed Under the App's Own Root Secret

**A value an app stores and later reads back under its own secret is sealed through `@y-core/forge/crypto/keyring`.** A webhook secret, a
third-party token, any credential a row carries: the consumer names the purpose and binds the row as context, and the namespace owns the ring, the
subkey derivation and the frame. It does not route to `auth`, because none of it is identity (§5h).

**`crypto` is a container, like `storage` and `render`: it has no barrel and no export entry, and holds one published child and one sealed one.**
`crypto/keyring` is the published child; `crypto/primitives` is the sealed one (§3b). Code that serves one other namespace's concern lives in that
namespace instead — the UUIDv7 set in `storage/db`, the WebAuthn wire formats in `auth/passkey`.

**A keyed stand-in for an id routes here too.** An app that needs an id it can look up but nobody can reverse calls `derivePseudonym` under the
same ring, rather than hand-rolling an HMAC over Web Crypto. Its subkeys are derived under a label of their own, so a pseudonym never shares a key
with a sealed frame.

**CSRF tokens, R2 signed URLs and `session`'s values sign under a `KeyRing` too.** Each derives an HMAC subkey for a purpose of its own, carries the
ring's key id on the wire, and refuses the auth key ring.

**`crypto/keyring` is a leaf that edges point into, and it names none of its importers.** Which namespaces import it is declared in
`config/namespaces.ts` (`EDGES`), not here. `auth` seals its TOTP secrets through the same functions; `crypto/keyring` imports only the
`crypto/primitives` and `result` primitives (§4c).

**Webhook secrets stay `whsec_` strings in `security`, the one HMAC consumer keeping its own key.** The format is shared with a third party that
signs with the same secret, so its bytes and encoding are not forge's to choose.

What it shares with `crypto/keyring` is the strength rule, which is [`SECURITY_HARDENING.md`][sh-8] §8's.

### 5l. `security` — Webhook Message Authentication, by Local Ruling

**`createWebhookSigning` is `security`'s, although its `verify` reads the body and [`BOUNDARIES.md`][boundaries-2a] §2a does not list
it.** A webhook signature authenticates the whole message and is a transport artefact; [`BOUNDARIES.md`][boundaries-2c] §2c sends CSRF to
`form` because it reads one form field. No other home holds: a `webhook` namespace would be one file and fails
[`NAMESPACE_DESIGN.md`][nd-5a] §5a, `form` parses forms, `auth` is user identity, and `http` owns output.

### 5m. `html` — Safe-Markup Primitives

**`@y-core/forge/html` holds the primitives that keep rendered markup safe:** `escapeHtml`, `safeUrl`, the `html` tag, `rawHtml`, `isSafeHtml`,
`scriptJson`, `styleText`, and the `SafeHtml` type they agree on. A primitive takes a value and returns markup or a verdict on it. Rendering a
component, building a fragment and answering a request are `render/*`'s and `http`'s.

**`html` is a leaf, and sits below both of its consumers.** `render/jsx` escapes through it and `http` types an HTML body with its `SafeHtml`, so
holding the primitives in either would make the other depend on it for a function that is not its concern.

**Pre-styled markup is not a primitive.** The htmx status banners carry forge's status classes and answer a swap, so they are `render/htmx`'s, and
`html` emits no class string.

---

## 6. When to Add a New Namespace

See [`NAMESPACE_DESIGN.md`][nd-5] §5 for the criteria a new namespace must meet and the checklist it must clear before merge.

---

## 7. Binding a Subpath to Its Governance

**A subpath is bound by a prose rule, not by being named.** A README or a table row tells a reader that `./router` exists and how to use it. It does
not tell them which rule decides what may go in there, what may not, and what the namespace is answerable to — and a subpath named nowhere but in a
table row is governed by nothing, however complete the table looks.

**Every published subpath is bound by at least one prose rule, or is declared exempt with its reason.** A rule binds a subpath by naming it in
prose: `./ui/client` is bound by §5f, `./http` by §5d, `./tooling/*` by §5g. An exemption is as good as a rule when the reason is stated — the
`./render/jsx/jsx-runtime` family is written by the compiler and reached by no author, so no rule about what belongs there could be acted on.

**Existence only.** The reconciliation runs both ways — every subpath has a rule, and every rule names a live subpath — and it asks nothing about
whether the rule is any good. Adequacy is a judgement a check cannot make, and a check that pretended to make it would be trusted for a guarantee it
never gave ([`AGENT_GUIDE.md`][ag-5c] §5c).

**Never a hand-maintained register.** There is no subpath → rule table anywhere, here or elsewhere. The binding is derived from the citations
already in the prose and the `exports` map, which is why it cannot fall out of date with either — the same reason `AGENT_GUIDE.md` §5c refuses to
register the documents it governs at all: a list disagrees with the directory it describes, and then a reader has two answers and no way to pick.

`validate-docs` **fails** on an unbound subpath. It warned while that backlog was being worked down — a check that fails a build over a backlog gets
exempted wholesale instead — and was promoted the moment the list reached empty. A new subpath is bound before it ships, or it does not ship.

**This rule lives here rather than in the canon, and that placement is deliberate.** It is about a repository with an `exports` map, so
`canon/libs/` is where it would be portable to — but it has been measured against exactly one corpus, forge's. It is promoted to the canon when a
second repository needs it.

[ag-5c]: ../warden/canon/shared/AGENT_GUIDE.md#5c-the-agent-roster-is-reconciled-both-ways
[ap-2c]: ./ASSET_PIPELINE.md#2c-the-namespace-orchestrates-builders-and-is-not-one
[boundaries-1]: ../warden/canon/libs/BOUNDARIES.md#1-ssr-versus-browser--the-hard-runtime-boundary
[boundaries-2a]: ../warden/canon/libs/BOUNDARIES.md#2a-what-belongs-at-the-transport-layer
[boundaries-2b]: ../warden/canon/libs/BOUNDARIES.md#2b-what-does-not
[boundaries-2c]: ../warden/canon/libs/BOUNDARIES.md#2c-why-identity-is-application-layer
[bt-2i]: ./BUILD_TOOLING.md#2i-checks-are-functions-not-scripts
[cr]: ../warden/canon/shared/CODE_RULES.md
[cr-7]: ../warden/canon/shared/CODE_RULES.md#7-name-distinctiveness-rule
[dev-readme]: ../src/dev/README.md
[dm]: ./DATABASE_MANAGEMENT.md
[eh-1]: ./FORGE_ERRORS.md#1-result-monad
[eh-1a]: ./FORGE_ERRORS.md#1a-the-unified-result-primitive-okerr-result-and-toerror
[iv-3a]: ./INPUT_VALIDATION.md#3a-csrfprotection-middleware--guard-mutating-routes
[la]: ./FORGE_STRUCTURE.md
[la-1e]: ../warden/canon/libs/LIBRARY_ARCHITECTURE.md#1e-the-build-time-exemption-is-reachability
[nd-1]: ../warden/canon/libs/NAMESPACE_DESIGN.md#1-barrel-rules-and-export-discipline
[nd-2]: ../warden/canon/libs/NAMESPACE_DESIGN.md#2-no-sibling-barrel-import-rule
[nd-2c]: ../warden/canon/libs/NAMESPACE_DESIGN.md#2c-granting-an-exemption
[nd-3b]: ../warden/canon/libs/NAMESPACE_DESIGN.md#3b-integration-namespace-rules
[nd-4a]: ../warden/canon/libs/NAMESPACE_DESIGN.md#4a-factory-and-accessor-verbs
[nd-5]: ../warden/canon/libs/NAMESPACE_DESIGN.md#5-when-to-add-a-new-namespace
[nd-5a]: ../warden/canon/libs/NAMESPACE_DESIGN.md#5a-criteria-for-a-new-namespace
[ram-2d]: ./ROUTING_AND_MIDDLEWARE.md#2d-the-shared-submission-pipeline
[sh-8]: ./SECURITY_HARDENING.md#8-secret-strength--one-rule-for-every-secret
[sot-2b]: ./SOURCE_OF_TRUTH.md#2b-enforced-rules
[testing-7f]: ./TEST_RUNNERS.md#7f-a-subpath-that-is-not-on-the-barrel--y-coreforgetestingworkerd
[ucr-2]: ./UI_CLIENT_RUNTIME.md#2-mount-controllers
[usc]: ./UI_SSR_COMPONENTS.md
[warden-readme]: ../warden/README.md
