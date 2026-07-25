---
title: Routing and Middleware
description: "Declarative route maps, controllers, the page and action pipeline builders, middleware composition order, and the context namespace."
---

# Routing and Middleware

> Owns forge's declarative route configuration, the `definePage` / `defineAction` builders,
> middleware ordering, and the `context` namespace's typed accessors.
>
> Defers to: [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) for what the security middleware
> does; [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §2 and §5d for response helpers and handler
> error recovery; [`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1d for the action pipeline's
> validation steps.

---

## 0. Quick Reference

- §1 Router Namespace Exports: what `router` ships and how routes register
- §1a Declarative Route Map Pattern: one `routes.ts`, name → method + pattern
- §1b Controller — Mapping Route Names to Actions: where route middleware lives
- §1c Registering Routes with app.map: ordering against global middleware
- §2 Page and Action Route Patterns: the three handler factories
- §2a Full-Page Routes with definePage: loader, view, and the render state
- §2b Action-Only Routes with defineAction: the mutation pipeline
- §2c Health Check Route with healthCheck: the bare-handler case
- §3 Middleware Composition and Ordering: global versus route-level
- §3a Global vs Route-Level Middleware: `app.use` scoping and registration order
- §3b Middleware Handler Type: the contract every middleware obeys
- §3c Route Middleware Array Ordering: cheap rejections first
- §3d Security Middleware Placement: why the nonce provider goes first
- §3e applyMiddlewareChain Canonical Chain Builder: the encoded order
- §4 Context Namespace: the public typed-accessor surface
- §4a contextVar Typed Accessor: building a namespace's own accessor
- §4b Context Variable Typing: the accessor API
- §5 Route Lifecycle: loader, action, and view shapes
- §5a Loader — definePage GET Data Source: data or a short-circuit Response
- §5b Action — defineAction handle Pattern: always returns a Response
- §5c View — definePage Render Function: no I/O in a view
- §5d The AppContext Surface: what a handler reads from `c`

---

## 1. Router Namespace Exports

From `@y-core/forge/router` (`src/router/mod.ts` is authoritative): `route(defs)` builds a route
map; `createController(routes, controller)` binds names to actions; `createAction` type-checks a
single action; `createHref` and a route's `.href(args)` generate typed URLs; `get` / `post` /
`put` / `patch` / `del` / `head` / `options` / `resource` / `resources` / `form` author route
definitions. The `Middleware`, `RequestHandler`, `Controller`, and `RouteMap` types come from
here too.

**Registration happens on the app object via `app.map(routes, controller)`.** There is no
`applyRoutes`, `prefix`, `index`, or `layout` export, and **no imperative `app.get(...)` /
`app.post(...)`** — routes are declared only through the map plus controller.

### 1a. Declarative Route Map Pattern

**Routes are declared in a single `routes.ts` as a name → `{ method, pattern }` map.** Each name
becomes an addressable `Route` with a typed `.href()`.

```typescript
export const routes = route({
  home:    { method: "GET",  pattern: "/" },
  contact: { method: "POST", pattern: "/api/contact" },
})
```

**The map carries no handlers** — only method and pattern. Handlers bind separately (§1b), which
keeps the URL surface and the behaviour independently inspectable.

### 1b. Controller — Mapping Route Names to Actions

`createController(routes, { actions })` binds each route name to an action: either a bare
`RequestHandler`, or an object `{ middleware, handler }` whose middleware runs only for that
route.

```typescript
export const controller = createController(routes, {
  actions: {
    home:    { middleware: [csrfVerifyGuard], handler: homeView },
    contact: { middleware: contactGuards, handler: handleContact },
    health:  healthCheck<AppEnv>({ csrf: () => true }),   // bare handler
  },
})
```

**Route middleware lives in the action object — it is the only place per-route guards are
declared.** A controller may also carry a controller-level `middleware` array applying to every
action it owns.

### 1c. Registering Routes with `app.map`

**Call `app.map` after global middleware is registered** (§3) so `app.use` middleware wraps every
matched route.

```typescript
const app = createApp<AppEnv>({ config: configStore, isDebug: (c) => configStore.get(c.env).debug })
app.use("*", createSecurityHeaders(security))
app.map(routes, controller)
applyAssets(app, { notFoundView })
export default app
```

**The HTTP method comes from the map entry — no method is inferred from the handler.**

---

## 2. Page and Action Route Patterns

A route's handler comes from one of three factories in `@y-core/forge/app` — `definePage`,
`defineAction`, `healthCheck` — or from any plain `(c: AppContext<Bindings>) => Response`.

### 2a. Full-Page Routes with `definePage`

`definePage({ loader, view, action?, headers?, cache?, onError? })` runs the optional `loader`,
then renders `view`. The loader's return value reaches the view through render state; a loader
may instead return a `Response` to short-circuit.

**The view returns a `Response`, not a bare JSX element.** Its signature is
`(c, config, state) => Response | Promise<Response>`, where `state` is
`{ data, actionData, method }`.

**`definePage` does not accept a `middleware` field** — route middleware belongs in the
controller action (§1b).

### 2b. Action-Only Routes with `defineAction`

`defineAction({ parse, validate, handle, onValidationError?, onError? })` parses the body,
validates it, then calls `handle`. Validation failures and oversized bodies produce structured
fragment responses automatically ([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §1d).

**`handle` returns a `Response` directly and never delegates to a view.** A plain
`(c) => Response` action is equally valid when the pipeline is not needed. **Like `definePage`,
it does not accept a `middleware` field.**

### 2c. Health Check Route with `healthCheck`

`healthCheck<Bindings>(checks)` runs each named check concurrently and responds with JSON
`{ ok, checks }` — `200` when all pass, `503` otherwise, `cache-control: no-store`.

Because it is already a `RequestHandler`, **register it as a bare handler** with no surrounding
route middleware.

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

```typescript
const myGuard: Middleware = async (c, next) => {
  if (!isAllowed(c)) return new Response("Forbidden", { status: 403 })
  return next()
}
```

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

```typescript
export const requestIdCtx = contextVar<string>("requestId")

requestIdCtx.set(c, crypto.randomUUID())
const id = requestIdCtx.get(c)          // throws if unset
const maybe = requestIdCtx.getOptional(c)  // undefined if unset
```

### 4b. Context Variable Typing

`contextVar<T>(name)` creates a typed accessor backed by a fresh `createContextKey<T>()`. The
generic prevents reading a slot with the wrong expected type.

**Each `contextVar` instance is the sole read/write point for its slot** — no raw `c.get(key)`
calls in consumer code.

| Method | Behaviour |
|---|---|
| `.set(c, value)` | Stores `value` under the key |
| `.get(c, message?)` | Returns the value; throws if unset |
| `.getOptional(c)` | Returns the value or `undefined` |
| `.key` | The underlying typed `ContextKey<T>` |

---

## 5. Route Lifecycle

### 5a. Loader — `definePage` GET Data Source

Shape: `(c, config) => LoaderData | Response | Promise<…>`. It may return a plain object exposed
to the view via render state, or a `Response` directly for a redirect or stream.

**A loader must not mutate an already-built response's headers** — per-page headers belong in
`definePage({ headers, cache })`, and security headers come from `app.use` middleware.

### 5b. Action — `defineAction` `handle` Pattern

Shape: `(data, c, config) => Response | Promise<Response>`; a plain action is
`(c) => Response | Promise<Response>`. **Both always return a `Response`.**

With `defineAction` the body is parsed by the pipeline and `handle` receives validated `data`.
**Input validation must occur before any side effect.**

### 5c. View — `definePage` Render Function

Shape: `(c, config, state) => Response | Promise<Response>`. It builds a `Response`, typically
via `renderToString` on a JSX tree wrapped with `htmlResponse`, and reads the nonce with
`getNonce(c)`.

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
