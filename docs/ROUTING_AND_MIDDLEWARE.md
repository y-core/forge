---
title: Routing and Middleware
description: "Declarative route maps, controllers, the page and action pipeline builders, middleware composition order, and the context namespace."
audience: consumer
---

# Routing and Middleware

> Owns forge's declarative route configuration, the `definePage` / `defineAction` builders,
> middleware ordering, and the `context` namespace's typed accessors.
>
> Defers to: [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) for what the security middleware
> does; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §2 and §5d for response helpers and handler
> error recovery; [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1d for the submission pipeline's
> validation steps.

---

## 0. Quick Reference

- §1 Router Namespace Exports: what `router` ships and how routes register
- §1a Declarative Route Map Pattern: one `routes.ts`, name → method + pattern
- §1b Controller — Mapping Route Names to Actions: where route middleware lives
- §1c Registering Routes with app.map: ordering against global middleware
- §1d No `head` Verb Export: why a HEAD route could never match
- §2 Page and Action Route Patterns: the three handler factories
- §2a Full-Page Routes with definePage: loader, view, the render state, and the optional schema
- §2b Action-Only Routes with defineAction: the handle terminal step and the derive-only drop rule
- §2c Health Check Route with healthCheck: the bare-handler case
- §2d The Shared Submission Pipeline: one sequence, two terminal steps, and where the builders diverge
- §3 Middleware Composition and Ordering: global versus route-level
- §3a Global vs Route-Level Middleware: `app.use` scoping and registration order
- §3b Middleware Handler Type: the contract every middleware obeys
- §3c Route Middleware Array Ordering: cheap rejections first
- §3d Security Middleware Placement: why the nonce provider goes first
- §3e applyMiddlewareChain Canonical Chain Builder: the encoded order
- §4 Context Namespace: the public typed-accessor surface
- §4a contextVar Typed Accessor: building a namespace's own accessor, and the published ones
- §4b Context Variable Typing: one accessor per slot, never a raw key
- §5 Route Lifecycle: loader, action, and view shapes
- §5a Loader — definePage GET Data Source: data or a short-circuit Response
- §5b Action — the Mutation Terminal Step: both builders' shapes and the validate-before-side-effect rule
- §5c View — definePage Render Function: no I/O in a view
- §5d The AppContext Surface: what a handler reads from `c`
- §6 The Page Shell: one registered document shell, and why a mountable takes no chrome options
- §6a Registering a Shell: `createApp({ shell })`, `pageShell`, and the bare floor
- §6b A Mountable Takes No Chrome Options: the ruling, and the generics it removes
- §6c Fragments Never Reach the Shell: the rule `renderShell` makes structural
- §6d The Meta Descriptor: a typed shape rather than a merged tag array, and what renders it

---

## 1. Router Namespace Exports

The export list and every signature belong to `src/router/mod.ts` and `src/router/README.md`.

**Registration happens on the app object via `app.map(routes, controller)`.** There is no
`applyRoutes`, `prefix`, `index`, or `layout` export, and **no imperative `app.get(...)` /
`app.post(...)`** — routes are declared only through the map plus controller.

### 1a. Declarative Route Map Pattern

**Routes are declared in a single `routes.ts` as a name → `{ method, pattern }` map.** Each name
becomes an addressable `Route` with a typed `.href()`.

**The map carries no handlers** — only method and pattern. Handlers bind separately (§1b), which
keeps the URL surface and the behaviour independently inspectable.

### 1b. Controller — Mapping Route Names to Actions

`createController(routes, { actions })` binds each route name to an action: either a bare
`RequestHandler`, or an object `{ middleware, handler }` whose middleware runs only for that
route.

**Route middleware lives in the action object — it is the only place per-route guards are
declared.** A controller may also carry a controller-level `middleware` array applying to every
action it owns.

### 1c. Registering Routes with `app.map`

**Call `app.map` after global middleware is registered** (§3) so `app.use` middleware wraps every
matched route.

**The HTTP method comes from the map entry — no method is inferred from the handler.**

### 1d. No `head` Verb Export

**`router` exports no `head` verb.** `Forge.fetch` rewrites a `HEAD` request into a derived `GET`
before dispatch, and `dispatchMatches` compares `route.method` strictly — so a route declared
`head(...)` can never be reached through Forge, and exporting the shorthand advertises a shape that
does not work.

**A `HEAD` branch inside a middleware or a unit is still correct**, because such a unit may be
composed onto a bare `createRouter` where no rewrite happens; those branches encode HTTP method
semantics, not an assumption about `Forge.fetch`.

---

## 2. Page and Action Route Patterns

A route's handler comes from one of three factories in `@y-core/forge/app` — `definePage`,
`defineAction`, `healthCheck` — or from any plain `(c: AppContext<Bindings>) => Response`.

### 2a. Full-Page Routes with `definePage`

`definePage({ loader, view, action?, schema?, headers?, cache?, onError? })` runs the optional
`action` on a non-`GET` request, then the optional `loader`, then renders `view`. Both return
values reach the view through render state; either may instead return a `Response` to
short-circuit.

**`action` is skipped entirely on a `GET`**, leaving `state.actionData` undefined and
`state.method` `"GET"`.

**Declaring a `schema` puts `action` behind the shared submission pipeline (§2d), and the order is
not something the action can get around.** The body is read and validated first; only a body that
passed reaches `action`, which receives the schema's output as its **third** argument —
`(c, config, data)`. A body the schema refuses becomes a `422` fragment carrying the page's
configured `cache` and `headers`, and `action`, `loader` and `view` all go unrun. A `schema`
declared without an `action` guards nothing, because there is no mutation step to place behind it.

**The sequence's options come with it.** `turnstile`, `onBotDetected`, `onValidationError` and
`maxBytes` are declared on the page exactly as on an action (§2d), so a
self-posting page answers a refused body by re-rendering its own view with its field errors —
`onValidationError` replaces the default `422` fragment and receives the issues themselves.

**`cache` is a default, not an override; `headers` is an override.** The configured `cache` is set
only on a response that carries no `cache-control` of its own, so a redirect, or a refusal that
answered `no-store`, keeps what it stated — a page's cache policy must not make a one-off response
publicly cacheable. `headers` is still applied last and still wins, which is the escape hatch for a
route that does want to overwrite. The header is computed once when the page is defined, not per
request.

**`data` comes last because that is where this family already puts its payload** — `view(c,
config, state)` does the same — and because a data-first shape could not have been additive: an
existing `(c, config)` action would have silently retyped `c` as the body and still compiled.

**A page that declares no `schema` behaves exactly as it did without one.** `action` receives the
unparsed context, `data` is `undefined`, and validating at its own boundary is that action's own
obligation ([`BOUNDARIES.md`](../warden/canon/libs/BOUNDARIES.md) §3a).

**The view returns a `Response`, not a bare JSX element.** Its signature is
`(c, config, state) => Response | Promise<Response>`, where `state` is
`{ data, actionData, method }`.

**`definePage` does not accept a `middleware` field** — route middleware belongs in the
controller action (§1b).

### 2b. Action-Only Routes with `defineAction`

`defineAction(def)` reads the body, runs the route's body-content guards, validates against
`def.schema`, then calls `handle` with the schema's output. **`handle` is unreachable except
through a passing `v.safeParse`**, so a route cannot accept a body nothing checked. Guard
refusals, validation failures, and oversized bodies produce structured fragment responses
automatically. That sequence is not this builder's own — it is the shared pipeline `definePage`
also runs (§2d), and `handle` is simply its terminal step.
`ActionDefinition` (`src/app/types.ts`) is authoritative for the options and
`src/app/README.md` documents each one with its type; the schema contract and the failure statuses
belong to [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1d.

**`handle` returns a `Response` directly and never delegates to a view.** A plain
`(c) => Response` action is equally valid when the pipeline is not needed. **Like `definePage`, it
does not accept a `middleware` field** — transport guards belong in the controller action (§1b),
and the pipeline's own body-content guards are configured on `def` rather than composed onto it.

**The dropped-field set is derived, never declared.** The pipeline removes a field from the body
only because something on that request consumed it: the route's own guards supply the names they
were given, and `csrfProtection` publishes the field it took the token from on `csrfFieldCtx`
(§4a). There is no option for naming a field to drop. The rule holds unchanged for a schema-bearing
page, which declares the same body-content guards and so derives the same names from them (§2d).
A second declaration of a name a guard already holds is an invariant nothing enforces, and its
failure mode is silent and production-only — the form simply stops submitting, against a status
that reads as success.

**Absent `csrfFieldCtx` means no CSRF guard ran, so nothing was consumed and nothing is dropped.**
A `_csrf` field arriving in that body is then an ordinary undeclared field, and a strict schema
refuses it. That is the intended answer: it points at the missing middleware instead of absorbing
its absence. Two alternatives were rejected.

- **A permissive default** — drop the default CSRF field name regardless — makes an unguarded
  route indistinguishable from a guarded one. The form submits, the route looks correct, and the
  missing guard never surfaces. It also cannot be right in general, because it can only guess the
  default name, so a route that renamed the field breaks anyway.
- **A blanket `403`** on the variable's absence refuses routes that legitimately run no CSRF guard
  and submit no token, and it misreports the fault: `403` claims a token was checked and rejected
  when none was checked at all. The refusal has to be triggered by the field actually arriving,
  which is what the strict schema already does.

**Deriving makes middleware ordering load-bearing** for a route with a derived drop — the guard
must run before the handler for its name to be on the context. The controller action's array is
ordered (§3c) and all route middleware completes before the handler (§3a), so the ordinary
composition already satisfies this; a hand-built chain that defers the guard does not.

### 2c. Health Check Route with `healthCheck`

`healthCheck<Bindings>(checks)` runs each named check concurrently and responds with JSON
`{ ok, checks }` — `200` when all pass, `503` otherwise, `cache-control: no-store`.

Because it is already a `RequestHandler`, **register it as a bare handler** with no surrounding
route middleware.

### 2d. The Shared Submission Pipeline

**There is one submission sequence, and both builders are terminal steps over it.** The steps
themselves — read, guard, drop what a guard consumed, validate, refuse or continue — belong to
[`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1d. What this section owns is that neither builder
has a copy: `defineAction`'s terminal step is `handle`, returning a `Response`; `definePage`'s is
`action`, whose return value goes on to the loader and view (§2a). Validate-before-side-effect is
therefore structural in the literal sense — there is no path to either terminal step that goes
around the sequence — rather than a rule each route is trusted to keep (§5b).

**The sequence is internal to `app` and is not exported.** It is an implementation seam, not a
public surface; a consumer composes it only by declaring a `schema` on one of the two builders,
and there is no subpath that yields it directly.

**The sequence is shared, and so are its options.** There is **one body-validation surface**:
`PageDefinition` inherits `turnstile`, `onBotDetected`, `onValidationError` and `maxBytes` from the same projection of `ActionDefinition` the pipeline itself consumes, so the
options and their documentation have one home and neither builder can drift from the other. A route
therefore picks its builder by what it answers with — a fragment (`handle`) or a page (`action` →
`loader` → `view`) — never by which guards it needs.

**`schema` is the one member a page states for itself, and only because its optionality differs.**
An action must declare a schema; a page may, and a page that declares none is not a submission route
at all. Everything else is inherited rather than restated, because a second hand-maintained list is
how the two builders diverged the first time.

**A pipeline option without a `schema` is refused, at the type level and at registration.** Without
a schema there is no pipeline to configure, so `turnstile` and the rest were accepted
and silently ignored — a page could declare a bot guard that never ran. `PageDefinition` is a union
of a `{ schema: S }` arm carrying the pipeline options and a `{ schema?: never }` arm forbidding
each of them, the forbidding arm being a **mapped type over the same projection**, so a member added
to the pipeline extends both arms at once. `definePage` also **throws at registration** naming the
stated keys, because a union's own diagnostic ("not assignable to either arm") is not what a
developer can act on. The key list lives once, as `PIPELINE_ONLY_KEYS` in `pipeline.ts`, and both
the type and the guard read it.

**What the builders do not share is the recovery arm: a throw from inside the sequence lands on the
builder's own, deliberately.** The sequence answers what it can answer — a refused body, a tripped
guard, an oversized body — and lets a throw escape, because they already recover differently and
that divergence is
ratified: a `defineAction` throw becomes a logged `500` fragment, a `definePage` throw reaches
`onError` or re-throws to the router boundary
([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5d). So a `v.transform` that throws on malformed
input is answered by whichever builder declared it, in that builder's own idiom. One shared answer
would mean a page rendering a bare fragment where every one of its other failures renders a page.

**A page's refusal carries the page's headers; an action's does not.** A `definePage` refusal is
returned through the same header pass as its view, so the route's configured `cache` and `headers`
apply to it — which matters most for `no-store`, since a `422` that escaped a page's cache
directive would be the one response on that route a cache could keep. A `defineAction` refusal is
returned as the pipeline built it.

---

## 3. Middleware Composition and Ordering

### 3a. Global vs Route-Level Middleware

Global middleware registers with `app.use(path, ...middleware)` and runs for every request whose
URL matches `path` — `"*"` for all, `"/api/*"` for a subtree. Route-level middleware is declared
in a controller action and runs only for that route.

**Recommended `app.use` order:** `createSecurityHeaders` → `requestId` → `requestLogger` →
`cors` (scoped to its subtree).

**Route-level middleware runs after all matching `app.use` middleware has completed.**

### 3b. Middleware Handler Type

`Middleware` is `(context, next) => Response | Promise<Response>`.

**A middleware must either call `next()` to continue or return a `Response` to short-circuit.**
Doing neither hangs the request.

### 3c. Route Middleware Array Ordering

Middleware in an action's `middleware` array **executes left to right** before the handler.

**Place broad guards before narrow ones** — origin checks and rate limiting before CSRF token
verification — so cheap rejections happen before expensive ones.

### 3d. Security Middleware Placement

**`createSecurityHeaders` sets the per-request CSP nonce, so it must be registered before any
middleware or handler that reads the nonce or security headers.** Pure tracing middleware
(`requestId`, `requestLogger`) may precede it — they neither read nor render with the nonce.

**Middleware adds response headers through the pending-header channel** (or by returning a
`Response`) — never by mutating an already-sent response. The app's outermost header pass
flushes them once.

### 3e. `applyMiddlewareChain` Canonical Chain Builder

`applyMiddlewareChain(app, options)` is the primary way to register the global chain — **it
encodes the canonical order once so consumers stop re-deriving it**:

    requestId() → requestLogger(logging) → createSecurityHeaders(securityHeaders)
      → validateBindings(bindings) → session → per-path guards (origin → rateLimit → middleware[])

**A guard group registers each of its guards once, for all of its `paths` at once** — the group's
paths compile into one matcher, which `app.use(paths, handler)` accepts. Registering per path would
instantiate one `rateLimit` per path, so two overlapping patterns (`/api/*` and `/api/users`) spent
a request's budget twice and halved the effective limit. Registration is therefore guard-major, not
path-major, which is the only order that exists once there is one instance per guard.

**Every slot except `securityHeaders` is optional**; omitted slots are skipped without
disturbing the relative order of the rest. `session` and per-path `middleware[]` accept prebuilt
`Middleware` values, which keeps `app` free of `session`- and route-specific dependencies.

Hand-written `app.use` chains remain valid for layouts the builder cannot express, but **must
respect §3d**.

---

## 4. Context Namespace

`@y-core/forge/context` is a **public subpath**. Consumers need its `Middleware` and
`AppContext` types and the `contextVar` accessor, which sit over fetch-router's
`RequestContext`. It is also the canonical home of `validateBindings`, `validateEnv`, and
`ConfigKey`.

### 4a. `contextVar` Typed Accessor

`contextVar` is a factory for typed accessors over the request context's variable store.

**Forge namespaces use it to build accessors that they then export under their own name** —
`requestIdCtx` from `security`, `csrfTokenCtx` from `form`. **Consumer code should use those
published accessors rather than inventing ad-hoc context slots.**

**`csrfFieldCtx` (from `form`) is a published accessor with a rule attached.** `csrfProtection`
sets it to the field it took the token from, above every early return in the guard, so it is
present on every request the guard ran on — the `GET` that mints, the mutation that passes, and
the mutation it refuses alike. **Read it with `.getOptional`, never `.get`: absence is meaningful
rather than an error.** It is the honest answer that no guard ran on this request, and §2b is the
rule that depends on the distinction.

### 4b. Context Variable Typing

`contextVar<T>(name)` creates a typed accessor backed by a fresh `createContextKey<T>()`. The
generic prevents reading a slot with the wrong expected type.

**Each `contextVar` instance is the sole read/write point for its slot** — no raw `c.get(key)`
calls in consumer code.

---

## 5. Route Lifecycle

### 5a. Loader — `definePage` GET Data Source

A loader may return a plain object, exposed to the view through render state, or a `Response`
directly for a redirect or a stream.

**A loader must not mutate an already-built response's headers** — per-page headers belong in
`definePage({ headers, cache })`, and security headers come from `app.use` middleware.

### 5b. Action — the Mutation Terminal Step

Each builder's mutation step has its own shape, and the payload sits at the opposite end of each
— `defineAction`'s `handle` takes the validated data **first** and always returns a `Response`;
`definePage`'s `action` takes it **last** (§2a) and its return value reaches the view as
`state.actionData` unless it is a `Response`, which short-circuits. A plain action takes the
context alone. `src/app/types.ts` is authoritative for all three.

**Input validation must occur before any side effect** — which a declared `schema` makes
structural rather than a rule each route has to keep. The pipeline reads the body and hands the
schema's output to the terminal step, so `handle` and a schema-bearing page's `action` are each
reachable only through a passing `v.safeParse` (§2d). A `definePage` that declares no `schema`
keeps that obligation at its own boundary (§2a).

### 5c. View — `definePage` Render Function

A view builds a `Response` — typically `renderToString` over a JSX tree wrapped with
`htmlResponse` — and reads the nonce with `getNonce(c)`.

**Views must not perform I/O — all data fetching belongs in the loader.**

### 5d. The `AppContext` Surface

The context is `AppContext<Bindings>` — a `RequestContext` plus `.env` and `.executionCtx`.

Read the request through the standard Web API surface: `c.request.headers.get("X")`,
`c.request.json()`, `c.method`, `c.url` (a `URL`), `c.params`. Bindings are `c.env.*`;
background work is `c.executionCtx.waitUntil(p)`. Resolved config is `c.config`, or
`configStore.get(c.env)`.

**Build responses with the `http` helpers** — `htmlResponse`, `fragmentResponse`, `redirect`
([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §2, §3) — and read form bodies with `parseFormData(c)`
([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §2c). **Context slots are read through typed
`contextVar` accessors (§4), never raw keys.**

---

## 6. The Page Shell

**Every page forge mounts renders into one shell the app registers, resolved per request.** The
type is `PageShell` — `(c, content, slot) => JSXNode | Promise<JSXNode>` — and `src/app/shell.tsx`
is authoritative for it, alongside `ShellSlot`, `ShellDocument` and `pageShell`.

This is the same inversion `Config` already has. `definePage` does not take config as an option: it
reads `ConfigKey` off the request context, which `Forge` provisions from a store attached at
registration (§5d). A document shell is the same kind of fact — one app-wide decision, needed per
request, irrelevant to the contract of the page that needs it — so it is registered the same way and
read the same way.

### 6a. Registering a Shell

`createApp({ shell })` registers it, or `app.setShell(shell)` after construction; **`setShell` is
the single writer of that slot**, and a later call replaces an earlier one. The shell is provisioned
onto the request context beside `ConfigKey`, so no route, controller or mount has to pass it
anywhere.

A shell is a closure, which is what keeps forge's surface free of it: **the app's own per-request
context and layout stay inside it**, and forge sees only `JSXNode` in and `JSXNode` out.

```ts
createApp({ shell: async (c, content, slot) => <Layout ctx={await renderContext(c, config)}>{content}</Layout> });
```

**`pageShell({ stylesheet, script, lang })` is the form for a deployment whose whole chrome is a
stylesheet**, so reaching for the shell does not mean writing a layout component. Titles come from
`slot.title` either way.

**An app that registers no shell renders a bare document** — doctype, `<head>`, the slot's title,
content in `<body>`. That is the floor rather than a placeholder: handing a mount's content straight
to `renderPage` puts a doctype in front of a `<div>`, leaving the page no `<head>` and so no title
and no stylesheet.

### 6b. A Mountable Takes No Chrome Options

**A mountable that renders a full document takes no chrome options — no `layout`, no `context`, no
`document`.** It calls `renderShell(c, content, slot)` and names itself in the slot. `registerShowcase`,
`loadLogViewer` and `auth/web` each did own such options, in three shapes; the shell is the one seam
that replaced all three, and the next mountable is held to it rather than inventing a fourth.

**That is also why none of them carries a `Ctx` type parameter.** A `context`/`layout` option pair
has to thread the consumer's config and context types through every signature that might reach a
render. A closure holds both, so the generics are the consumer's problem where they belong and
forge's option types stay one-parameter.

**`slot.mount` is an open string.** A closed union of mount names would make every mountable forge
adds later a breaking change for every shell a consumer has already written — so a shell that
branches on `mount` needs a default arm.

The old options were removed outright, with no shim and no dual path
([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md) §7).

### 6c. Fragments Never Reach the Shell

**A fragment response is swapped into a document that already exists, so it is never wrapped.**
`renderShell` is the only path that writes `<html>`, which makes the rule structural rather than
three independent implementations of it: an htmx partial (`isPartial`, `isHxRequest`), a showcase
API endpoint, and a refusal like the log viewer's `403` all answer without calling it.


### 6d. The Meta Descriptor

**A slot carries a `PageMeta`, not a title** — `{ mount, page, meta }`, where `meta.title` is
required and everything else is optional. One field rather than a title beside a descriptor that
also holds one, because two spellings of the same fact can disagree.

**It is a typed shape, not an array of tag descriptors merged by key.** React Router merges meta
down a route hierarchy of arbitrary depth, which is what makes tag identity the only thing a merge
can key on. Forge has two levels — the site-wide base living in the shell's closure, and one page —
so a field does the same job and answers what a key-identity merge leaves open: whether a second
`og:image` overrides the first or joins it. `og.image` is one field, so it overrides.

**The decisive case is forge's own mounts.** `auth/web` states `{ title, robots: "noindex" }` from
inside the library. Under a tag array it would emit `{ name: "robots", content: "noindex" }` and
forge would own a dedupe function so its tag could not collide with a consumer's base — logic to
write, test and document, for a fact a field states.

**Every page forge mounts is `noindex`.** A sign-in page, an account page, an admin page and a log
viewer each say who a deployment's users are; the showcase is a reference. None is a page a search
result should land on, and the descriptor is what let forge say so.

**`metaTags(meta, { nonce })` is what turns a descriptor into markup**, and `pageShell` calls it —
so the bare floor and a consumer's shell render the same tags in the same order from the same
input. Without a single renderer the type is a data bag and every shell re-implements the escaping.

**`mergeMeta(base, page)` merges a page over the site's base**, shallow at the top and one level
deep for `og` and `twitter`. A plain spread drops a base `og` whole the first time a page states one
field of it. `extra` is concatenated base-first.

Three things the descriptor deliberately does not do:

- **`extra` is appended verbatim and never deduplicated** against the typed tags. It is the escape
  hatch for a tag `PageMeta` has no field for, in the same `{ name, content }` / `{ property,
  content }` / `{ tagName: "link", rel, href }` vocabulary React Router uses — not a second one.
- **`canonical` and `og.image` must be absolute, and forge derives neither.** A Worker behind a
  proxy sees a `c.url` that is not the public URL, so a derived canonical would be wrong in exactly
  the deployments where it matters. The shell's closure knows the site's origin; forge does not.
- **`jsonLd` is a field rather than an `extra` entry**, because the `application/ld+json` element it
  renders needs this request's nonce ([`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2d) —
  which `metaTags` is handed in `options`, and which an `extra` entry has no way to receive. Given
  none, it renders nothing rather than an element the policy would refuse.
