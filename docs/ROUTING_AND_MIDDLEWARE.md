---
title: Routing and Middleware
description: "Declarative route maps, controllers, the page and action pipeline builders, middleware composition order, and the context namespace."
audience: consumer
---

# Routing and Middleware

> Owns forge's declarative route configuration, the `definePage` / `defineAction` builders, middleware ordering, how a slice's contributions reach
> the app root, and the `context` namespace's typed accessors.
>
> Defers to: [`SECURITY_HARDENING.md`][sh] for what the security middleware does; [`FORGE_ERRORS.md`][eh-2] §2 and §5d for response helpers and
> handler error recovery; [`INPUT_VALIDATION.md`][iv-1d] §1d for the submission pipeline's validation steps.

---

## 0. Quick Reference

- §1 Router Namespace Exports: what `router` ships and how routes register
- §1a Declarative Route Map Pattern: one `routes.ts`, name → method + pattern
- §1b Controller — Mapping Route Names to Actions: where a route's own guards live
- §1c Registering Routes with app.map: ordering against global middleware
- §1d No `head` Verb Export: why a HEAD route could never match
- §1e The Unmatched URL: one `notFound` hook, and the `methodMismatch` choice between hiding a route and advertising it
- §1f Matcher Resource Budgets: the limits forge sets for every matcher, and where each failure lands
- §2 Page and Action Route Patterns: the handler factories
- §2a Full-Page Routes with definePage: loader, view, the render state, and the optional schema
- §2b Action-Only Routes with defineAction: the handle terminal step and the derive-only drop rule
- §2c Health Check Route with healthCheck: the bare-handler case
- §2d The Shared Submission Pipeline: one sequence, two terminal steps, and where the builders diverge
- §2e A Page or Action Names Its Route: the handler factory's route argument, and why the builders come only from the factory
- §3 Middleware Composition and Ordering: global versus route-level
- §3a Global vs Route-Level Middleware: `app.use` scoping, registration order, and a read-only `context.url`
- §3b Middleware Handler Type: the contract every middleware obeys
- §3c Route Middleware Array Ordering: only the checks that need the route matched
- §3d Security Middleware Placement: why the nonce provider goes first
- §3e applyMiddlewareChain Canonical Chain Builder: the encoded order, and the guard policy at a glance
- §3f One CSRF Policy per App, Verified Once: the ruling, what holds the single check, and the alternatives rejected
- §3g A Slice Exports Its Contribution as Data: the list the app root passes each factory, keys not labels, and the alternatives rejected
- §3h The Session Is a Typed Chain Slot: the asserted slot, `subject: "session"`, the root-owned CSRF policy, one auth store, lifetimes,
  sign-out, the cookie primitives, and the alternatives rejected
- §4 Context Namespace: the public typed-accessor surface
- §4a contextVar Typed Accessor: building a namespace's own accessor, and the published ones
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

**Registration happens on the app object via `app.map(routes, controller)`.** There is no `applyRoutes`, `prefix`, `index`, or `layout` export, and
**no imperative `app.get(...)` / `app.post(...)`** — routes are declared only through the map plus controller.

### 1a. Declarative Route Map Pattern

**Routes are declared in a single `routes.ts` as a name → `{ method, pattern }` map.** Each name becomes an addressable `Route` with a typed
`.href()`. **The map carries no handlers** — only method and pattern. Handlers bind separately (§1b), which keeps the URL surface and the
behaviour independently inspectable.

### 1b. Controller — Mapping Route Names to Actions

`createController(routes, { actions })` binds each route name to an action: either a bare `RequestHandler`, or an object `{ middleware, handler }`
whose middleware runs only for that route. **A route's own guards — the checks that need the route matched — live in the action object**; the
checks that need only the request sit on a chain guard group whose `paths` cover the route, and §3f splits the two. A controller may also carry a
controller-level `middleware` array applying to every action it owns.

### 1c. Registering Routes with `app.map`

**Call `app.map` after global middleware is registered** (§3) so `app.use` middleware wraps every matched route. **The HTTP method comes from the
map entry — no method is inferred from the handler.**

### 1d. No `head` Verb Export

**`router` exports no `head` verb.** `Forge.fetch` rewrites a `HEAD` request into a derived `GET` before dispatch, and `dispatchMatches` compares
`route.method` strictly — so a route declared `head(...)` can never be reached through Forge, and exporting the shorthand advertises a shape that
does not work. **A `HEAD` branch inside a middleware or a unit is still correct**, because such a unit may be composed onto a bare `createRouter`
where no rewrite happens; those branches encode HTTP method semantics, not an assumption about `Forge.fetch`.

### 1e. The Unmatched URL

**One hook answers a URL that matches no route: `createApp({ notFound })`.** It is the router's `defaultHandler` and also what the asset
catch-all renders on a miss — a `404` from the `ASSETS` binding, an absent binding, or a non-`GET`/`HEAD` method — so configuring `assets`
changes which code path reaches the hook, never what a client sees. The hook receives the resolved app config as its second argument. **Omitted,
forge answers a hardened plain-text `404 Not Found`** carrying `nosniff`, `default-src 'none'` and `no-referrer`, and it **never echoes the
request path**, which fetch-router's own default does.

**A matched URL with no route for the method reaches the same hook by default, and `createApp({ methodMismatch })` is what decides.** fetch-router
answers such a request with `405`, a body echoing the method sent, and an `Allow` header naming every method registered at that URL. Forge's
innermost middleware replaces that response, because the answer is a disclosure decision the app owns rather than the router's:

| `methodMismatch` | A method mismatch answers | What a prober learns |
| --- | --- | --- |
| `"notFound"` (default) | whatever the `notFound` hook renders, or forge's hardened `404` | nothing — identical to a URL matching no pattern |
| `"advertise"` | hardened plain-text `405` with `Allow` | the URL exists, and which methods it serves |

**The default closes an enumeration oracle.** Under `"advertise"`, `GET /internal/webhook` answering `405` while `GET /internal/no-such-hook`
answers `404` tells an unauthenticated caller which is a real route, and `Allow` names the method to forge a body for. **Choose `"advertise"`
where the routes are not a secret**, which is most JSON APIs: RFC 9110, section 15.5.6 asks for it, and clients and proxies expect it. Either way
the disclosure stops at the guard line — a guard registered with `app.use` that answers without calling `next()` means no `405` is ever built.

**Under `"advertise"` only the mismatch `405` is rebuilt, and hardened rather than forwarded**: the `404`'s three headers, the fixed body
`Method Not Allowed` that **never echoes the method**, and `Allow` exactly as the router computed it, `HEAD` included wherever `GET` is. A `405` a
route handler or a `notFound` hook returns is left untouched. The rebuild happens inside the router middleware chain, so a global middleware's
headers land on it as on a `404`. **An `ANY` catch-all is its limit:** with `assets` configured the catch-all matches the mismatched method first
and renders `notFound`, which is inherent — a route matching every method has answered the request.

**A mutation without a valid token answers the CSRF `403` before routing, on real and unreal paths alike.** The router's final verify runs ahead
of the method-mismatch answer and `defaultHandler`, so under the default `paths: ["*"]` a tokenless `POST` answers the same `403 Forbidden`
whether its path has no route, serves only `GET`, or is mounted in development but not in production, under either `methodMismatch` mode: a `404`
or `405` beside a `403` would tell a prober which paths exist. **`methodMismatch` decides only a safe-method mismatch and a mutation carrying a
valid token.** A path the policy does not cover, through its `paths` or its `exclude`, reaches the answers above unverified (§3e).

Because `defaultHandler` runs inside `dispatchMatches`, a no-match flows back out through the pending-header flush and both error-boundary depths
exactly as a matched route does ([`FORGE_ERRORS.md`][eh-5b] §5b).

### 1f. Matcher Resource Budgets

**Forge builds every matcher, so forge sets the budget.** The route matcher and each `app.use` guard matcher share one `limits` — a per-pattern
ceiling, a whole-matcher ceiling, and a per-match work budget — whose values `src/app/forge-app.ts` owns. They are tighter than route-pattern's
defaults: a consumer cannot reach the matcher to set them, and an unbounded default is a budget nobody chose.

**The two failures land in different places.** A pattern over the per-pattern ceiling throws `MatcherResourceError` at registration, before a
request ever arrives; a URL that exhausts the work budget throws during matching, and the error boundary answers `500`
([`FORGE_ERRORS.md`][eh-5b] §5b). Import the class and its `MatcherResourceErrorDetails` from `@y-core/forge/router`, never from route-pattern.
**The work budget is calibrated against measurement:** 500 routes matched against a 32 KB URL, twice what Cloudflare delivers, cost roughly half
of it, so raising it answers a measured match, never a suspicion.

---

## 2. Page and Action Route Patterns

A route's handler comes from `@y-core/forge/app` — `definePage` and `defineAction` from the app's `createHandlerFactory` (§2e), or
`healthCheck` — or from any plain `(c: AppContext<Bindings>) => Response`.

### 2a. Full-Page Routes with `definePage`

`definePage(route, { loader, view, action?, schema?, query?, headers?, cache?, onError? })` runs the optional `action` on an unsafe request, then
the optional `loader`, then renders `view`. Both return values reach the view through render state; either may instead return a `Response` to
short-circuit. **The view returns a `Response`, not a bare JSX element**, and **`definePage` does not accept a `middleware` field** (§1b).

**`action` is skipped entirely on a `GET`**, leaving `state.actionData` undefined and `state.method` `"GET"`; a `HEAD` reaches the page as that
`GET`. **Any other safe method — `OPTIONS`, `TRACE` — answers `405` and runs neither `action` nor `loader`.** `Allow` names every method a page
answers — `GET, HEAD, POST, PUT, PATCH, DELETE` — on an `ANY` route, `GET, HEAD` on a safe-method route, and the route's own method otherwise.
The `405` is the app's own method-mismatch answer, plain text with the baseline hardening headers and without the page's `cache` and `headers`,
because it is answered before the page runs. The guards in front of a page admit every safe method unchecked — `originProtection` and
`requireFreshStepUp` read the shared set in `http/method`, and the CSRF policy exempts only `GET` and `HEAD`, deliberately stricter — so a page
treating `OPTIONS` as a mutation would run its action past the origin and step-up checks.

**Declaring a `schema` puts `action` behind the shared submission pipeline (§2d), and the action cannot get around it.** Only a body that passed
reaches `action`, as its **third** argument — `(c, config, data)`, last because `view(c, config, state)` puts its payload there too. A refused body
becomes a `422` fragment carrying the page's `cache` and `headers`, and `action`, `loader` and `view` all go unrun. A `schema` declared without
an `action` guards nothing. **A page that declares no `schema` runs no pipeline**: `action` receives the unparsed context, `data` is `undefined`,
and validating at its own boundary is that action's obligation ([`BOUNDARIES.md`][boundaries-3a] §3a).

**`cache` is a default, not an override; `headers` is an override.** `cache` is set only on a response that carries no `cache-control` of its own,
so a redirect, or a refusal that answered `no-store`, keeps what it stated — a page's cache policy must not make a one-off response publicly
cacheable. `headers` is applied last and wins, the escape hatch for a route that does want to overwrite.

### 2b. Action-Only Routes with `defineAction`

`defineAction(route, def)` is the shared pipeline (§2d) with `handle` as its terminal step, so **`handle` is unreachable except through a passing
`v.safeParse`**. `ActionDefinition` (`src/app/types.ts`) is authoritative for the options; the schema contract and the failure statuses belong to
[`INPUT_VALIDATION.md`][iv-1d] §1d. **`handle` returns a `Response` and never delegates to a view**, and a plain `(c) => Response` is equally
valid where no pipeline is needed. **It does not accept a `middleware` field either** — a route's guards belong in a covering guard group or the
controller action (§1b), and the pipeline's body-content guards are configured on `def`.

**The dropped-field set is derived, never declared.** The pipeline removes a field from the body only because something on that request consumed it:
the route's own guards supply the names they were given, and the app's CSRF policy publishes the field it reads the token from on `csrfFieldCtx`
(§4a). No option names a field to drop, and a schema-bearing page derives the same names the same way. A second declaration of a name a guard
already holds is an invariant nothing enforces, and it fails silently and only in production — the form stops submitting, against a status that
reads as success.

**Absent `csrfFieldCtx` means the CSRF policy did not cover the request, so nothing was consumed and nothing is dropped.** A `_csrf` field arriving
in that body is then an ordinary undeclared field, and a strict schema refuses it, pointing at the missing middleware instead of absorbing its
absence. These alternatives were rejected.

- **A permissive default** — drop the default CSRF field name regardless — makes an unguarded route indistinguishable from a guarded one, and it
  can only guess the default name, so a route that renamed the field breaks anyway.
- **A blanket `403`** on the variable's absence refuses routes that legitimately run no CSRF guard and submit no token, and it misreports the fault:
  `403` claims a token was checked and rejected when none was checked at all.

**Deriving makes middleware ordering load-bearing** — the guard must run before the handler for its name to be on the context. The controller
action's array is ordered (§3c), and every `app.use` registration, the CSRF policy's mint stage among them, completes before the handler (§3a), so
the ordinary composition satisfies this; a hand-built chain that defers the guard does not.

### 2c. Health Check Route with `healthCheck`

`healthCheck<Bindings>(checks)` runs each named check concurrently and responds with JSON `{ ok, checks }` — `200` when all pass, `503` otherwise,
`cache-control: no-store`. Because it is already a `RequestHandler`, **register it as a bare handler** with no surrounding route middleware.

### 2d. The Shared Submission Pipeline

**There is one submission sequence, and both builders are terminal steps over it.** The steps themselves — read, guard, drop what a guard consumed,
validate, refuse or continue — belong to [`INPUT_VALIDATION.md`][iv-1d] §1d. What this section owns is that neither builder has a copy:
`defineAction`'s terminal step is `handle`, and `definePage`'s is `action`. No path to either goes around the sequence, which makes
validate-before-side-effect structural (§5b). **The sequence is internal to `app` and not exported**; declaring a `schema` composes it.

**The sequence is shared, and so are its options.** `PageDefinition` inherits `rateLimit`, `turnstile`, `onBotDetected`, `onValidationError` and
`maxBytes` from the projection of `ActionDefinition` the pipeline consumes, so neither builder can drift. A route picks its builder by what it
answers with — a fragment or a page — never by the guards it needs. **`schema` is the one member a page states for itself**, being optional there.

**A pipeline option without a `schema` is refused, at the type level and at registration**, because it would configure nothing — a page could
declare a bot guard that never ran. `PageDefinition` is a union of a `{ schema: S }` arm carrying the options and a `{ schema?: never }` arm
forbidding each, the forbidding arm a **mapped type over the same projection**, so a new option extends both arms at once. `definePage` also
**throws at registration** naming the stated keys, because a union's own diagnostic is not one a developer can act on. The key list lives once, as
`PIPELINE_ONLY_KEYS` in `pipeline.ts`, and both the type and the guard read it.

**What the builders do not share is the recovery arm: a throw from inside the sequence lands on the builder's own, deliberately.** The sequence
answers what it can — a refused body, a tripped guard, an oversized body — and lets a throw escape, because the builders already recover
differently and that divergence is ratified: a `defineAction` throw becomes a logged `500` fragment, and a `definePage` throw reaches `onError` or
re-throws to the router boundary ([`FORGE_ERRORS.md`][eh-5d] §5d). One shared answer would have a page render a bare fragment where every other
failure of its renders a page.

**A page's refusal carries the page's headers; an action's does not.** A `definePage` refusal goes through the same header pass as its view, so
the route's `cache` and `headers` apply — which matters most for `no-store`, since a `422` that escaped a page's cache directive would be the one
response on that route a cache could keep.

**A page's `query` is parsed ahead of the sequence, on every method, and is not part of it.** Its reader, its `400` and `onQueryError` are
[`INPUT_VALIDATION.md`][iv-1d] §1d's. The loader receives the output as its **third** argument, `(c, config, query)`, and a refused query goes
through the page's header pass with nothing after it run. `onQueryError` is separate from `onValidationError` because the two refuse different
inputs, so `PIPELINE_ONLY_KEYS` does not list it. `defineAction` takes no `query`.

### 2e. A Page or Action Names Its Route

**A page or action names its route as its first argument, and an app takes `definePage` and `defineAction` from `createHandlerFactory`.** The app
binds its bindings and config types once, with `createHandlerFactory<AppEnv, AppConfig>()` from `@y-core/forge/app`, and each handler it returns
takes the route before the definition. `c.params` is typed from that route's pattern (§5d), and the handler's type carries those params, so
`createController` refuses it on a route whose params differ — the shape fetch-router's own `createAction(route, action)` already has.

**That is also why the `app` barrel exports no standalone `definePage` or `defineAction`.** A standalone builder is called with explicit type
arguments, as in `definePage<AppEnv, AppConfig, Data>`, and TypeScript infers no type parameter of a call that states any explicitly, so a route
argument on it would never be inferred. The factory gives the explicit arguments a call of their own. The other shapes lost for these reasons:

- **An optional `route` field in the definition** keeps a second way to define a handler, and falls to the same inference failure as soon as a
  caller states a type argument.
- **No route at all** leaves `c.params` loose: apps write `c.params.x ?? ""`, and a param renamed in `routes.ts` still compiles in every handler.

**A handler mapped to several routes takes a route whose params are identical on all of them**, and one built on a route with no params fits any
of them. A helper shared across routes whose params differ types its context on the params they share, for example
`AppContext<AppEnv, RouteParams<typeof routes.task>>`, with `RouteParams` imported from `@y-core/forge/router`.

---

## 3. Middleware Composition and Ordering

### 3a. Global vs Route-Level Middleware

Global middleware registers with `app.use(path, ...middleware)` and runs for every request whose URL matches `path` — `"*"` for all, `"/api/*"` for
a subtree. Route-level middleware is declared in a controller action and runs only for that route, **after all matching `app.use` middleware has
completed.** The global chain's order is stated once, in §3e, and `applyMiddlewareChain` produces it; a hand-written chain must reproduce it.

**The route is resolved before the first `app.use` middleware runs**, so a global middleware reads `matchedRoutePattern` before `next()`; it stays
unset when no route matches the URL and method. A method override mounted with `app.use` runs after resolution, so the pattern reflects the
request's original method.

**`context.url` is read-only once forge has the request.** Once a middleware changes its `href` in place, the fragment included, or
assigns it a new `URL`, the next `app.use` middleware, route middleware or handler is not run: forge throws an error naming both paths,
and the error boundary answers `500`. A prefix strip or a subpath mount belongs in the Worker's `fetch` export, which passes
`app.fetch` a `Request` rebuilt on the rewritten URL.

**A handler that changes `context.url`'s `href` in place or assigns it a new `URL`, and then returns a `405`, answers `500`, never `405` or
`404`.** The method-mismatch answer (§1e) refuses the rewrite before re-matching the URL, and the error boundary logs the error, under either
`methodMismatch` mode.

### 3b. Middleware Handler Type

**A middleware must either call `next()` to continue or return a `Response` to short-circuit.** Doing neither hangs the request.

### 3c. Route Middleware Array Ordering

Middleware in an action's `middleware` array **executes left to right** before the handler.

**The array holds only the checks that need the route matched, in the order §3f gives them.** An origin check, an address-keyed rate limit and
CSRF verification are never in it: they belong to a covering guard group, where they run before the verify (§3f).

### 3d. Security Middleware Placement

**`createSecurityHeaders` sets the per-request CSP nonce, so it must be registered before any middleware or handler that reads the nonce or
security headers.** Pure tracing middleware (`requestId`, `requestLogger`) may precede it — they neither read nor render with the nonce.

**Middleware adds response headers through the pending-header channel** (or by returning a `Response`) — never by mutating an already-sent
response. The app's outermost header pass flushes them once.

### 3e. `applyMiddlewareChain` Canonical Chain Builder

`applyMiddlewareChain(app, options)` is the primary way to register the global chain — **it encodes the canonical order once, and this is the
normative statement of that order; every other page defers here rather than restating it**:

    before[] → requestId() → requestLogger(logging) → createSecurityHeaders(securityHeaders)
      → validateBindings(bindings) → session → csrf mint (the policy's paths, outside its exclude) → globals[]
      → every matching group's shape[] → origin → rateLimit
      → csrf verify (in the first matching group with an origin check, a rate limit or guards) → every matching group's guards[]
      → [Forge] csrf verify of anything still armed

**The guard policy at a glance.** Each row names where a concern is declared, what holds when nothing more is said, and how it refuses:

| Concern | Declared on | Default | Refusal | Log line |
| --- | --- | --- | --- | --- |
| Session | `session`, the root's or one contribution's | no slot | throws: `500` | `Unhandled error` |
| CSRF | the root's `csrf` alone | `paths: ["*"]`; all but `GET`, `HEAD`, a CORS preflight; 24 h token | `403`; `413`/`400` for the body | `security.csrf.refused` |
| Origin | a group's `origin` | off; safe methods pass; no signal refused | `403` | `security.origin.refused` |
| Rate limit, by address | a group's `rateLimit` | off; every method; by client IP | `429`, `Retry-After`; `503` | `security.rate-limit.refused` |
| Rate limit, by user or param | the builders' `rateLimit` (§2d) | off; every method | `429`, `Retry-After`; `503` | `security.rate-limit.refused` |
| Administrator | `requireAdmin` in `guards[]` or `middleware` | off | `403` | `security.admin.refused` |

- **Each rule has one owner.** The session is §3h's and CSRF §3f's. Origin is [`SECURITY_HARDENING.md`][sh-3e] §3e's, and a rate limit — by
  `binding:` name, one or an array, `methods` — is [`SECURITY_HARDENING.md`][sh-4e] §4e's. The statuses, reasons and log fields are
  [`FORGE_ERRORS.md`][eh-3e] §3e's, and a missing session is that document's error boundary ([`FORGE_ERRORS.md`][eh-5b] §5b).
- **Every refusal but the session's goes through one hook.** The guard's own `onRefuse`, else its group's for the stages a group expands, else
  the chain's, else forge's plain text; a hook that returns `undefined` declines, passing the refusal to the next of them. A CSRF refusal at a
  group's verify takes the hook of the last-registered matching group, outside its `exclude`, that verifies and declares one, whichever group's
  verify ran it; the chain's answers otherwise and at the router's final stage ([`FORGE_ERRORS.md`][eh-3e] §3e).
- **What throws at registration:** a contribution carrying `csrf`; a second session; `subject: "session"` with no session slot; a slot whose
  cookie `maxAge` is unset or shorter than a contribution's `sessionMaxAgeAtLeastMs`; a contribution's or guard group's `csrfCovers` path
  under no `csrf` policy, outside its `paths` or inside its `exclude`; a `maxAgeMs` that is not a whole number of at least one millisecond; a
  group's binding missing from `bindings` or `rateLimits`; and a group's limit with no `key` under a chain that does not set
  `trustCfHeaders` ([`SECURITY_HARDENING.md`][sh-4d] §4d).
- **The guard order.** Every matching group's `shape[]`, `origin` and `rateLimit` run, then the first verify, then every matching group's
  `guards[]`, then the router's final verify, the route's `middleware`, and a submission's `rateLimit` stage, Turnstile and schema. A limit
  therefore spends before the token is checked: a tokenless `POST` answers `403` inside the limit and `429` past it, and either answers before an
  auth guard's `401` and its D1 read. So a group's rate-limit `key` must not read what a guard sets: identity for a key comes from `globals[]`
  middleware such as `resolveAuth`, and a limit keyed by what a guard establishes, or by a route param, goes on the route (§3f).
- **Where the policy arms.** Under the default `paths: ["*"]` every request but a `GET`, a `HEAD` or a CORS preflight is armed, and an armed request
  is verified by the first matching group with an `origin`, a `rateLimit` or `guards[]`, or else at the router's final stage. A group's `exclude`
  does not reach that stage, and `unboundPaths` still demands a token. So an endpoint taking a mutation with no token — one a server or a tool
  calls, such as an MCP or JSON API endpoint, or a `POST` that changes no state, such as a preview — goes on the policy's `exclude`, where nothing
  is minted or armed, or it answers `403`. A URL no route matches is armed too (§1e), and on a page narrowed `paths` or `exclude` leave
  uncovered `authNav` gives a signed-in viewer a link to the sign-out confirm page in place of the form.
- **`cors` has one placement: `app.use("/api/*", cors(...))`, registered after `applyMiddlewareChain`.** It answers a preflight without calling
  `next`, and a preflight reaches it through a group's checks: the CSRF policy never arms a CORS preflight, an `OPTIONS` carrying both `Origin` and
  `Access-Control-Request-Method`, and a group's `origin` check passes `OPTIONS` as a safe method. A group's rate limit counts a preflight, and its
  `guards` run on it, so a guard that refuses an uncredentialed request — a browser sends a preflight without cookies — must pass one. Every other
  `OPTIONS` is armed ([`SECURITY_HARDENING.md`][sh-3a] §3a).

**`contributions[]` fills the same slots and has no position of its own.** Each contribution's `globals` and `guards` join their slot after the
options' own, in array order, and its `bindings` are validated right after the options' `bindings`. **`validateBindings` sits after
`createSecurityHeaders` because a shape refusal throws**, and a throw that precedes the header factory strips the error page of every header it
would have set, `Strict-Transport-Security` and `X-Request-Id` among them; "validate first" is the wrong reading ([`FORGE_ERRORS.md`][eh-5b] §5b).

**A guard group registers its whole chain once, for all of its `paths`** — they compile into one matcher, which `app.use(paths, ...chain)`
accepts. Registering per path would instantiate one `rateLimit` per path, so two overlapping patterns (`/api/*` and `/api/users`) would spend a
request's budget twice and halve the effective limit.

**A group's `exclude`, a `globals` entry written as `{ middleware, exclude }`, and the CSRF policy's `exclude` skip every URL they match**, even
where the `paths` beside them match. They take `app.use`'s syntax and compile into one matcher each, so the route audit
([`BOUNDARIES.md`][boundaries-apps-2b] §2b) reads a skipped subtree off the chain declaration, not from a path test inside the middleware.

**Every slot except `securityHeaders` is optional**, and an omitted slot leaves the relative order of the rest alone. `before[]`, `globals[]` and a
group's `shape[]` and `guards[]` take prebuilt `Middleware`, which keeps `app` free of route-specific dependencies. **`before[]` and `globals[]`
are where a consumer's own global middleware goes**, so the chain stays the builder's to register. `before[]` is for tracing that must wrap
everything, including `requestId`, which §3d permits; only `trustCfHeaders`, `onRefuse` and `rateLimits` are published ahead of it, so a rate
limit there behaves as one anywhere else does. `globals[]` is for everything that must see the session.

**An approval's guards are a chain contribution.** `approval.contribution` carries the prompt's origin check and rate limit as a guard group, so
they run in the chain's first pass and the token is verified after them, whichever chain group also covers the prompt's path; its limit keys under
the chain's `trustCfHeaders`. `registerApproval` maps only the prompt, which answers 500 on a request its guards did not run on.

**A group's `shape[]` holds its request-shape guards**, such as method and content-type checks, ahead of `origin`. **A group's `origin` and
`rateLimit` are policy data, not middleware**: the chain expands each group into the order above, and spreading `group.guards` alone drops both,
silently. Hand-written `app.use` chains remain valid for layouts the builder cannot express, but **must respect §3d**.

### 3f. One CSRF Policy per App, Verified Once

**An app has one CSRF policy, supplied by the chain: it is minted after the session, armed on a mutation, and verified exactly once — at the
first verify stage after the request's origin check and rate limit, or at the router's final stage — and there is no inline verifier.**

**Exactly once is held by the armed slot, not by where the verify stages sit.** The mint stage arms a mutation with its own verification, and each
verify stage clears that slot before it checks, so every later stage finds nothing armed. One policy means one mint stage, so a request is armed
at most once, which is what lets every group with an origin check, a rate limit or `guards[]` carry a verify stage.

**Where the verify lands is [`BOUNDARIES.md`][boundaries-apps-2c] §2c's order**: origin and rate limit before CSRF. A group with neither, and no
`guards[]`, has nothing to verify after, and a verify stage there could run ahead of a group registered later, so it carries none and the
router's final stage covers it. An app wiring `app.use` by hand mounts `csrfMintStage` after its session, and the final stage is its verify.

**A route with checks of its own splits them at the verify.** A guard group on the chain's `guards[]`, whose `paths` cover the route, holds what
exists before routing: `origin` and a `rateLimit` keyed by address, with the verify after them. The route holds what needs the route matched: its
`middleware` array the identity check and a membership check reading `c.params`, then the `rateLimit` keyed by that identity or param — the
`defineAction` or `definePage` stage on a submission route, `middleware` on any other ([`SECURITY_HARDENING.md`][sh-4e] §4e). CSRF therefore runs
before the membership check's store read; an origin check or address-keyed limit left on the route would run after the final verify, too late.

The ruling has two consequences an app lives with:

- **One `maxBytes` per app.** A route that needs a larger CSRF body parse raises the policy's `maxBytes`. Each later `parseFormData` caller
  re-checks the bytes read against its own cap ([`INPUT_VALIDATION.md`][iv-2c] §2c), so the route's `defineAction` `maxBytes` stays its tighter
  cap. The cost is that a tokenless request to any covered path can make the CSRF parse read up to the raised cap before its 403.
- **More groups verify ahead of a late-mounted check.** Every chain group with an origin check, a rate limit or `guards[]` verifies, so an
  origin check or rate limit mounted after the chain with `app.use` keeps its place before the verify only on a path none of them matches.

These alternatives were rejected:

- **Keeping `csrfProtection` as a route-inline escape hatch.** It left two APIs for one policy and three verify sites: inline, a group's, and the
  router's final stage. The chain kept the inline verifier out of its own slots by recognising the function `csrfProtection` returned, and a
  one-line wrapper passed that check. Every route that reached for it is a guard group, which verifies in order without its author placing it.
- **Several path-scoped policies, refused when their `paths` could match one URL.** A request is minted and verified under one policy either way,
  so a second policy bought per-path options at the price of an overlap check over route-pattern syntax, which had to refuse whatever it did not
  model. One policy's `paths` and `exclude` say everything the disjoint policies said.

### 3g. A Slice Exports Its Contribution as Data

**A feature slice exports what it contributes as a plain value, and the app root passes the list of them to each factory — `applyMiddlewareChain`'s
`contributions`, `createHealthChecks`, `createContributionSlots` and `createPrimaryNav` — which throws on a duplicate key and returns a frozen
result.**

**The app's composition is one array the root writes.** Which slices contribute, and in what order, is read off that list, not off which module
happened to be imported first; a contribution cannot arrive after the route that reads it is mapped, and a test builds the same result from it.
**A duplicate is a wiring mistake, so the factory throws when it is built** — letting the later one win, or rendering both, hides the mistake —
and the frozen result lets nothing added later past that check. What counts as a duplicate in each factory is its namespace README's to say.

**Identity is a key the code chooses, never a display label.** Bar-level menus that share a `key` merge, which is how independent slices fill one
menu; the same `key` under a different `label` throws. These alternatives were rejected:

- **A module-scope `contribute()` on a factory the app creates first.** The factory's state then depends on import order, and a health handler
  that read it on every request answered a later request differently after a late import. [`WORKERS_PLATFORM.md`][wp-1b] §1b allows a
  module-level constant and refuses module-level mutable state; [`CODE_RULES.md`][cr-1a] §1a's remedy is to inject state as a factory parameter,
  which is what the list is.
- **Identity by display label.** Merging menus by their trimmed, lower-cased label made visible wording into identity: rewording one menu split it
  from the menu it joined, and two unrelated menus that happened to share a label merged.
- **An umbrella `Slice` type carrying every kind of contribution.** Four lists composed at the root express every case, and a type bundling them
  would be one more shape to learn, tying `app` to `ui/chrome` for nothing the lists cannot do.

### 3h. The Session Is a Typed Chain Slot

**The chain's `session` slot takes only a `SessionMiddleware`, the branded value `createAnonymousSession` and `sessionMiddleware` return, and after
it runs the chain checks that a session is on the context. The CSRF policy binds to that session with `subject: "session"`, the app root owns the
policy, and nothing else is derived from the session.**

**"Session" means the visitor's `Session` on `sessionCtx`.** The auth session is the D1 row its token names, a flash is a one-read message, and a
D1 bookmark is replica state; none of them is the slot.

**A slot that sets no session is a wiring error, caught on the first request.** A middleware that forgets the session, or a hand-rolled one
registered in its place, would otherwise surface later as a CSRF `unbound-subject` refusal or a guard's `NO_SESSION` throw, far from the cause.
The check is one context lookup per request, and it is the reason `app` imports `session` at all, through an edge declared in
`config/namespaces.ts` ([`SOURCE_OF_TRUTH.md`][sot-3b] §3b).

**`subject: "session"` binds every token to the chain session's id, and a chain given it with no session slot throws at registration.** `app`
resolves the literal, so `form` never imports `session`; `subject` stays required, and its other choices are [`INPUT_VALIDATION.md`][iv-3a] §3a's.
A path the policy leaves unbound stays path-only beside `"session"`, so one page can carry a bound sign-out token and an unbound contact token.

**The app root owns the CSRF policy.** It is an option of `applyMiddlewareChain` itself, never a contribution's, so a slice that does not depend on
the auth slice never inherits a policy from it, and the app's one policy has one author.

**Auth's session rules follow from the slot, and [`AUTH_MOUNTING.md`][am-1] §1 holds their detail.** Auth sessions use cookie storage, as
[`src/session/README.md`][session-readme] rules, and auth keeps one session store per request, which the guards read rather than building their
own. **The cookie outlives the auth session, checked at build:** the auth contribution states the absolute lifetime it needs, and the chain throws
at registration where the slot's cookie `maxAge` is shorter or absent. **Sign-out destroys the session**, so a shared device keeps no visitor data,
unless the app passes the named `signOut: { keepVisitorData: true }`; data a visitor must not lose to a sign-out belongs in the browser.

**Cookie primitives live in `http`, which owns headers:** `createUnsignedCookie` and the shared attribute defaults, which `createSignedCookie`,
`d1Sessions` and the flash cookie build on. `createSignedCookie` stays in `session`, because it needs `crypto/keyring`.

**With the database down, a request with no sign-in token serves public pages, and one with a token answers `503` and is never treated as
anonymous.** The session, CSRF, auth and app key rings rotate independently, and the slot derives none of them from another.

These alternatives were rejected:

- **An untyped slot, trusted to set the session.** Every consumer of the session then guards against its absence its own way, and a miswired
  slot is found by whichever guard reads it first.
- **The CSRF subject defaulting to the session id.** Omitting `subject` stops being a decision anyone made, against
  [`INPUT_VALIDATION.md`][iv-3a] §3a, and an app with no session would get a refusal at the first mutation instead of a type error.
- **KV as the auth session backend.** Identity is the D1 row, so revocation never depended on the cookie. KV adds a read per request and a write
  per change under a per-key write limit, and its deletes reach other locations up to a minute late.
- **Keeping visitor data by default at sign-out.** It leaves a previous visitor's state on a shared device, and buys nothing for open tabs,
  whose tokens already fail because sign-in and sign-out both regenerate the id.

---

## 4. Context Namespace

`@y-core/forge/context` is a **public subpath**. Consumers need its `Middleware` and `AppContext` types and the `contextVar` accessor, which sit
over fetch-router's `RequestContext`. It is also the canonical home of `validateBindings`, `validateEnv`, and `ConfigKey`.

### 4a. `contextVar` Typed Accessor

`contextVar` is a factory for typed accessors over the request context's variable store. **Forge namespaces use it to build accessors that they
then export under their own name** — `requestIdCtx` from `security`, `csrfMinterCtx` from `form` — **and consumer code uses those published
accessors rather than inventing ad-hoc context slots.**

**`csrfFieldCtx` (from `form`) is a published accessor with a rule attached.** The CSRF policy's mint stage sets it to the field the token is
read from before it arms anything, so it is present on every request the policy covers, refused or not. **Read it with `.getOptional`, never
`.get`: absence is meaningful rather than an error** — the honest answer that no guard ran on this request, which §2b depends on.

---

## 5. Route Lifecycle

### 5a. Loader — `definePage` GET Data Source

A loader may return a plain object, exposed to the view through render state, or a `Response` directly for a redirect or a stream. **A loader
must not mutate an already-built response's headers** — per-page headers belong in the page's `headers` and `cache`, and security headers come
from `app.use` middleware.

### 5b. Action — the Mutation Terminal Step

`defineAction`'s `handle` takes the validated data **first** and always returns a `Response`; `definePage`'s `action` takes it **last** (§2a),
and its return value reaches the view as `state.actionData` unless it is a `Response`, which short-circuits. A plain action takes the context
alone, and `src/app/types.ts` is authoritative for each shape. **Input validation must occur before any side effect** — which a declared `schema`
makes structural (§2d); a `definePage` that declares none keeps that obligation at its own boundary (§2a).

### 5c. View — `definePage` Render Function

A view builds a `Response` — typically `renderToString` over a JSX tree wrapped with `htmlResponse` — and reads the nonce with `getNonce(c)`.
**Views must not perform I/O — all data fetching belongs in the loader.**

### 5d. The `AppContext` Surface

The context is `AppContext<Bindings, Params>` — a `RequestContext` plus `.env`, `.executionCtx` and `.config`. **Inside a `definePage` or
`defineAction` hook, `c.params` is typed from the route the handler names (§2e)**: a captured param is a `string`, one inside an optional segment
`string | undefined`, and a name the pattern does not capture is a compile error. **Outside a hook — middleware, a plain handler, a helper
typed `AppContext<Bindings>` — `c.params` is `Record<string, string | undefined>`**, so any route's context reaches such code; a helper that
needs a `string` names its params with `RouteParams` (§2e).

**Read the request through the standard Web API surface**, bindings through `c.env`, and resolved config through `c.config`. **Build responses
with the `http` helpers** ([`FORGE_ERRORS.md`][eh-2] §2, §3), read form bodies with `parseFormData(c)` ([`INPUT_VALIDATION.md`][iv-2c] §2c),
and read context slots through typed `contextVar` accessors (§4), never raw keys.

---

## 6. The Page Shell

**Every page forge mounts renders into one shell the app registers, resolved per request.** The type is `PageShell`, and `src/app/shell.tsx` is
authoritative for it and its neighbours. This is the inversion `Config` already has: `definePage` takes no config option but reads `ConfigKey`
off the request context (§5d). A document shell is the same kind of fact — one app-wide decision, needed per request, irrelevant to the contract
of the page that needs it — so it is registered and read the same way.

### 6a. Registering a Shell

`createApp({ shell })` registers it, or `app.setShell(shell)` after construction; **`setShell` is the single writer of that slot**, and a later call
replaces an earlier one. The shell is provisioned onto the request context beside `ConfigKey`, so no route, controller or mount passes it. A shell
is a closure, which keeps forge's surface free of it: **the app's own per-request context and layout stay inside it**, and forge sees only
`JSXNode` in and `JSXNode` out. Writing one is [`src/app/README.md`][app-readme]'s.

**`pageShell({ stylesheet, script, lang })` is the form for a deployment whose whole chrome is a stylesheet**, so reaching for the shell does not
mean writing a layout component. **It loads each `script` as a module in `<head>`, never in `<body>`**, because a `<script src>` in a body that a
boosted navigation swaps in breaks that navigation under Trusted Types ([`SECURITY_HARDENING.md`][sh-2g] §2g).

**An app that registers no shell renders a bare document** — doctype, `<head>`, the slot's title, content in `<body>`. That is the floor, not a
placeholder: handing a mount's content straight to `renderPage` would leave the page no `<head>`, and so no title and no stylesheet.

### 6b. A Mountable Takes No Chrome Options

**A mountable that renders a full document takes no chrome options — no `layout`, no `context`, no `document`.** It calls
`renderShell(c, content, slot)` and names itself in the slot. `loadLogViewer` and `auth/web` both go through that one seam, and the next mountable
is held to it. **That is also why none of them carries a `Ctx` type parameter**: a `context`/`layout` pair would thread the consumer's config and
context types through every signature that might reach a render, where a closure holds both and forge's option types stay one-parameter.

**`slot.mount` is an open string.** A closed union of mount names would make every mountable forge adds later a breaking change for every shell a
consumer has already written — so a shell that branches on `mount` needs a default arm.

### 6c. Fragments Never Reach the Shell

**A fragment response is swapped into a document that already exists, so it is never wrapped.** `renderShell` is the only path that writes `<html>`,
which makes the rule structural: an htmx partial (`isPartial`, `isHxRequest`) and a refusal like the log viewer's `403` answer without calling it.

### 6d. The Meta Descriptor

**A slot carries a `PageMeta`, not a title** — `{ mount, page, meta }`, where `meta.title` is required and everything else is optional, because a
title beside a descriptor that also holds one is two spellings of a fact that can disagree.

**It is a typed shape, not an array of tag descriptors merged by key.** React Router merges meta down a route hierarchy of arbitrary depth, which
makes tag identity the only thing a merge can key on. Forge has two levels — the site-wide base in the shell's closure, and one page — so a field
does the job and settles what a key-identity merge leaves open: `og.image` is one field, so a second one overrides rather than joins. **The decisive
case is forge's own mounts:** `auth/web` states `{ title, robots: "noindex" }` from inside the library, where a tag array would have forge own a
dedupe function so its tag could not collide with a consumer's base. **Every page forge mounts is `noindex`**: a sign-in, account or admin page
and a log viewer each say who a deployment's users are, and none is a page a search result should land on.

**`metaTags(meta, { nonce })` turns a descriptor into markup**, and `pageShell` calls it, so the bare floor and a consumer's shell render the
same tags in the same order; without one renderer every shell re-implements the escaping. **`mergeMeta(base, page)` merges a page over the
site's base**, shallow at the top and one level deep for `og` and `twitter`, since a plain spread drops a base `og` whole the first time a page
states one field of it. `extra` is concatenated base-first.

What the descriptor deliberately does not do:

- **`extra` is appended verbatim and never deduplicated** against the typed tags. It is the escape hatch for a tag `PageMeta` has no field for, in
  the same `{ name, content }` / `{ property, content }` / `{ tagName: "link", rel, href }` vocabulary React Router uses — not a second one.
- **`canonical` and `og.image` must be absolute, and forge derives neither.** A Worker behind a proxy sees a `c.url` that is not the public URL, so
  a derived canonical would be wrong in exactly the deployments where it matters. The shell's closure knows the site's origin; forge does not.
- **`canonical` is not rendered beside `noindex`.** `metaTags` drops it when `robots` is or includes `noindex`, so a site canonical merged under
  a `noindex` page sends crawlers no conflicting signal; `mergeMeta` stays a plain merge. A robots tag in `extra` does not count.
- **`jsonLd` is a field rather than an `extra` entry**, because the `application/ld+json` element it renders needs this request's nonce
  ([`SECURITY_HARDENING.md`][sh-2d] §2d), which `metaTags` is handed in `options` and an `extra` entry has no way to receive. Given none, it
  renders nothing rather than an element the policy would refuse.

[am-1]: ./AUTH_MOUNTING.md#1-the-mount-in-order
[app-readme]: ../src/app/README.md#wrapping-pages-in-a-document-shell
[boundaries-3a]: ../warden/canon/libs/BOUNDARIES.md#3a-the-boundary-rule
[boundaries-apps-2b]: ../warden/canon/apps/BOUNDARIES.md#2b-guards-are-declared-never-inline
[boundaries-apps-2c]: ../warden/canon/apps/BOUNDARIES.md#2c-guard-order-within-a-route
[cr-1a]: ../warden/canon/shared/CODE_RULES.md#1a-no-module-level-mutable-variables
[eh-2]: ./FORGE_ERRORS.md#2-fragment-renderers-renderhtmx-namespace
[eh-3e]: ./FORGE_ERRORS.md#3e-one-refusal-contract-for-every-guard
[eh-5b]: ./FORGE_ERRORS.md#5b-unexpected-errors--the-router-error-boundary
[eh-5d]: ./FORGE_ERRORS.md#5d-defineaction-and-definepage-error-recovery
[iv-1d]: ./INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[iv-2c]: ./INPUT_VALIDATION.md#2c-parseformdata--body-read-with-size-limit
[iv-3a]: ./INPUT_VALIDATION.md#3a-the-csrf-policy--guard-mutating-routes
[session-readme]: ../src/session/README.md#choosing-a-storage-backend
[sh]: ./SECURITY_HARDENING.md
[sh-2d]: ./SECURITY_HARDENING.md#2d-getnonce-and-automatic-url-sanitization
[sh-2g]: ./SECURITY_HARDENING.md#2g-trusted-types-and-htmx--the-forge-htmx-policy
[sh-3a]: ./SECURITY_HARDENING.md#3a-cors-middleware-for-api-routes
[sh-3e]: ./SECURITY_HARDENING.md#3e-origin-guard-tiering--which-guard-when
[sh-4d]: ./SECURITY_HARDENING.md#4d-rate-limit-key-selection
[sh-4e]: ./SECURITY_HARDENING.md#4e-one-declaration-per-rate-limit
[sot-3b]: ./SOURCE_OF_TRUTH.md#3b-the-namespace-graph-rows
[wp-1b]: ../warden/canon/apps/WORKERS_PLATFORM.md#1b-safe-and-unsafe-module-scope
