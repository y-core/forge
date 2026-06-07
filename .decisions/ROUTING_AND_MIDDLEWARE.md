---
title: Routing and Middleware
description: "route map, route() createRoutes, createController controller actions, app.map registration, definePage definePage loader view, defineAction parse validate handle, healthCheck, app.use path-scoped middleware, Middleware type, middleware ordering, context namespace, contextVar accessor, AppContext, htmlResponse fragmentResponse redirect, parseFormData"
weight: 21
---

# Routing and Middleware

> Authoritative source for forge's declarative route configuration and middleware composition
> patterns, including the router namespace and the internal context namespace.
>
> Complements [LIBRARY_ARCHITECTURE.md](./LIBRARY_ARCHITECTURE.md) §2,
> [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) (security middleware).

---

## 0. Quick Reference

- §1 router namespace: `route()` (route map), `createController`, `app.map`, the `Middleware` type
- §2 Page vs action routes: `definePage`, `defineAction`, `healthCheck`, controller middleware
- §3 Middleware composition and ordering rules (`app.use` global, controller-level route middleware)
- §4 context namespace: `contextVar` typed accessor (internal, no public export)
- §5 Route lifecycle: loader/view/action shapes and the response helpers

---

## 1. Router Namespace Exports

Imports from `@y-core/forge/router`:

- `route(defs)` — alias for `createRoutes`; builds a route MAP of name → `Route { method, pattern }`
- `createController(routes, controller)` — maps each route name to an action handler
- `createAction(route, action)` — type-checks a single action against its route pattern
- `createHref(pattern, args)` / a route's `.href(args)` — type-safe URL generation from a pattern
- `Route`, `RouteMap`, `RouteDef`, `RouteDefs` — route-map types
- `Controller`, `Action`, `RequestHandler` — controller and handler types
- `Middleware`, `MiddlewareContext`, `RequestContext` — middleware and context types
- `get`, `post`, `put`, `patch`, `del`, `head`, `options`, `resource`, `resources`, `form` — route
  authoring helpers for building `RouteDef`s

Registration happens on the app object (`Forge<Bindings>` from `@y-core/forge/app`) via
`app.map(routes, controller)`. There is no `applyRoutes`, `prefix`, `index`, or `layout` export, and
no imperative `app.get(...)`/`app.post(...)` — routes are declared only through the map + controller.

### 1a. Declarative Route Map Pattern

Routes are declared in a single `routes.ts` file as a name → `{ method, pattern }` map. Each name
becomes an addressable `Route` with a typed `.href()` for URL generation.

    // src/routes.ts
    import { route } from "@y-core/forge/router"

    export const routes = route({
      home:    { method: "GET",  pattern: "/" },
      contact: { method: "POST", pattern: "/api/contact" },
      health:  { method: "GET",  pattern: "/api/health" },
    })

The map carries no handlers — only method + pattern. Handlers are bound separately by the
controller (§1b), keeping the URL surface and the behaviour independently inspectable.

### 1b. Controller — Mapping Route Names to Actions

`createController(routes, { actions })` binds each route name to an action. An action is either a
bare `RequestHandler` (no route middleware) or an object `{ middleware, handler }` whose middleware
runs before the handler for that route only.

    // src/router.tsx
    import { healthCheck } from "@y-core/forge/app"
    import { createController } from "@y-core/forge/router"
    import { csrfVerifyGuard } from "./app/middleware"
    import { contactGuards, handleContact } from "./handlers/contact"
    import { homeView } from "./handlers/home"
    import { routes } from "./routes"

    export const controller = createController(routes, {
      actions: {
        home:    { middleware: [csrfVerifyGuard], handler: homeView },
        contact: { middleware: contactGuards, handler: handleContact },
        health:  healthCheck<AppEnv>({ csrf: () => true }),   // bare handler — no route middleware
      },
    })

Route middleware lives in the action object (`{ middleware, handler }`) — it is the only place
per-route guards are declared. The controller object may also carry a controller-level `middleware`
array that applies to every action it owns.

### 1c. Registering Routes with app.map

`app.map(routes, controller)` registers all routes on the app. Call it after global middleware is
registered (§3) so that `app.use` middleware wraps every matched route:

    // src/worker.ts
    const app = createApp<AppEnv>({ config: configStore, isDebug: (c) => configStore.get(c.env).debug })
    app.use("*", makeSecurityHeaders(security))   // consumer helper wraps app.use() calls
    app.map(routes, controller)           // declarative route registration
    applyAssets(app, { notFoundView })    // static-asset catch-all
    export default app

The route's HTTP method is taken from the map entry; the controller supplies the handler and any
per-route middleware. No method is inferred from the handler.

---

## 2. Page and Action Route Patterns

A route name's handler is produced by one of three factories from `@y-core/forge/app`
(`definePage`, `defineAction`, `healthCheck`) or by any plain `(c: AppContext<Bindings>) => Response`.
Each factory returns a `RequestHandler` that is placed under `handler` in the controller action.

### 2a. Full-Page Routes with definePage

`definePage({ loader, view, action?, headers?, cache?, onError? })` returns a handler that runs the
optional `loader`, then renders `view`. The loader's return value is exposed to the view through the
render state; a loader may instead return a `Response` to short-circuit (e.g. a redirect).

    import { definePage } from "@y-core/forge/app"

    export const homeView = definePage<AppEnv, AppConfig>({
      cache: "no-store",
      view: (c) => (c as AppContext).render((ctx) => <HomePage ctx={ctx} content={content} />),
    })

The view signature is `(c: AppContext<Bindings>, config, state) => Response | Promise<Response>`.
`state` carries `{ data, actionData, method }`. The view returns a `Response` (typically built by a
render helper) — it does not return a bare JSX element to the router. `definePage` does NOT accept a
`middleware` field; route middleware belongs in the controller action (§1b).

### 2b. Action-Only Routes with defineAction

API endpoints that mutate state use `defineAction({ parse, validate, handle, onValidationError?,
onError? })`. The pipeline parses the form body, validates it, then calls `handle`; validation
failures and oversized bodies (413) produce structured fragment responses automatically.

    import { defineAction } from "@y-core/forge/app"

    export const handleContact = defineAction<ContactInput, AppEnv, AppConfig>({
      parse: (formData) => readContactFields(formData),
      validate: (data) => ContactSchema(data),
      handle: async (data, c, config) => {
        await sendContactEmail(data, config.services.email)
        return fragmentResponse(renderSuccess("Thanks. We'll get back to you soon."))
      },
    })

`handle` returns a `Response` directly — an HTMX fragment, a JSON response, or a redirect. It never
delegates to a view. A plain `(c) => Response` action is equally valid when the parse/validate/handle
pipeline is not needed (see `handleContact` in the starter, which reads `parseFormData(c)`
itself). Like `definePage`, `defineAction` does NOT accept a `middleware` field.

### 2c. Health Check Route with healthCheck

`healthCheck<Bindings>(checks)` from `@y-core/forge/app` returns a `RequestHandler` that runs each
named check function concurrently and responds with JSON `{ ok, checks }` (200 when all pass, 503
otherwise, `cache-control: no-store`). The keys name the checks; pass `{ csrf: () => true }` to
record a `csrf` check that always passes:

    import { healthCheck } from "@y-core/forge/app"

    // In the controller actions map:
    health: healthCheck<AppEnv>({ csrf: () => true })

Because it is already a `RequestHandler`, the health action is registered as a bare handler with no
surrounding route middleware.

---

## 3. Middleware Composition and Ordering

### 3a. Global vs Route-Level Middleware

Global (path-scoped) middleware is registered on the app with `app.use(path, ...middleware)` and
runs for every request whose URL matches `path`. Route-level middleware is declared in the
`middleware` array of a controller action and runs only for that route.

`app.use` path conventions:

- `app.use("*", mw)` — runs for every request.
- `app.use("/api/*", mw)` — runs for `/api` and any path under it.

Recommended `app.use` registration order:

1. `makeSecurityHeaders` — injects CSP/HSTS/XFO headers and the per-request nonce.
2. `requestId` — generates and stores a request ID in context.
3. `requestLogger` — logs request method, path, status, and duration.
4. `cors` (scoped to `/api/*`) — adds CORS headers for API routes only.

Route-level (controller) middleware runs after all matching `app.use` middleware has completed.

### 3b. Middleware Handler Type

    import type { Middleware } from "@y-core/forge/router"   // also re-exported from @y-core/forge/context

    const myGuard: Middleware = async (c, next) => {
      if (!isAllowed(c)) return new Response("Forbidden", { status: 403 })
      return next()
    }

`Middleware` is `(context, next) => Response | Promise<Response>`. A middleware must either call
`next()` to continue the chain or return a `Response` to short-circuit. Failing to call `next()` and
not returning a response results in a hung request. The context is `AppContext<Bindings>` — read
request data via `c.request.headers.get("X")`, `c.method`, and `c.url` (§5).

### 3c. Route Middleware Array Ordering

Middleware in a controller action's `middleware` array executes left-to-right before the handler:

    contact: { middleware: [contactGuard, rateLimitGuard, csrfVerifyGuard], handler: handleContact }
    // Execution order:
    // contactGuard → rateLimitGuard → csrfVerifyGuard → handleContact

Place broad guards (origin checks, rate limiting) before narrow guards (CSRF token verification) so
cheap rejections occur before expensive ones.

### 3d. Security Middleware Placement

`makeSecurityHeaders` must always be the first `app.use("*", ...)` registration. It sets the nonce
used by CSP. Any middleware that reads or writes security headers must run after it. See
[SECURITY_HARDENING.md](./SECURITY_HARDENING.md) for the full nonce and CSP contract. Response
headers added by forge middleware are queued on an internal pending-header channel and flushed once
by the app's outermost header pass — middleware should add headers through that channel (or by
returning a `Response`), never by mutating an already-sent response.

---

## 4. Context Namespace (Internal)

### 4a. contextVar Typed Accessor

The internal `context` namespace provides `contextVar` — a factory for typed accessors over the
request context's variable store (`c.set` / `c.get` keyed by an opaque context key).

This namespace is for forge internals. Consumer code should not reach into it to invent ad-hoc
context slots; forge namespaces use it to build typed accessors that are then exported through their
own namespace (e.g., `requestIdCtx` from `@y-core/forge/security`, `csrfTokenCtx` from
`@y-core/forge/form`).

    // Inside a forge namespace (not consumer code):
    import { contextVar } from "../context/accessor"

    export const requestIdCtx = contextVar<string>("requestId")

    // Middleware that sets the value:
    const requestIdMiddleware: Middleware = (c, next) => {
      requestIdCtx.set(c, crypto.randomUUID())
      return next()
    }

    // Downstream middleware or handler that reads the value:
    const id = requestIdCtx.get(c)          // throws if not set
    const id = requestIdCtx.getOptional(c)  // returns undefined if not set

### 4b. Context Variable Typing

`contextVar<T>(name)` creates a typed accessor backed by a fresh `createContextKey<T>()`. The
generic `T` prevents callers from accidentally reading a context slot with the wrong expected type.
Each `contextVar` instance is the sole read/write point for its slot — no raw `c.get(key)` calls
appear in consumer code.

The typed accessor API surface:

| Method | Behaviour |
|---|---|
| `.set(c, value)` | Stores `value` under the key in context |
| `.get(c, message?)` | Returns the value; throws `Error` (optionally with `message`) if unset |
| `.getOptional(c)` | Returns the value or `undefined` if unset |
| `.key` | The underlying typed `ContextKey<T>` |

---

## 5. Route Lifecycle

A route's handler runs inside the matched middleware chain and returns a standard `Response`. The
internal loader/view/action types backing `definePage`/`defineAction` are summarised below; consumer
code constructs responses with the helpers in §5d rather than the framework methods of the old model.

### 5a. Loader — definePage GET Data Source

A loader has the shape `(c: AppContext<Bindings>, config) => LoaderData | Response | Promise<...>`.
It may:

- Return a plain object (`LoaderData`) — `definePage` exposes it to the view via render state.
- Return a `Response` directly — used for redirects or streaming responses.

Loaders should not mutate an already-built response's headers; per-page headers belong in the
`definePage({ headers, cache })` fields, and security headers are added by `app.use` middleware.

### 5b. Action — defineAction / handle Pattern

`defineAction`'s `handle` has the shape `(data, c: AppContext<Bindings>, config) => Response |
Promise<Response>`. A plain action is `(c: AppContext<Bindings>) => Response | Promise<Response>`.
Both always return a `Response`. Common return patterns:

- `fragmentResponse(renderSuccess(msg))` — HTMX partial HTML swap.
- `Response.json(data, { status })` — JSON API response.
- `redirect(url, 303)` — Post/Redirect/Get pattern.

Actions read the form body via `parseFormData(c)` (from `@y-core/forge/form`) or
`c.request.formData()`, and JSON via `c.request.json()`. With `defineAction`, the body is parsed by
the pipeline and `handle` receives validated `data`. Input validation must occur before any side
effects.

### 5c. View — definePage Render Function

A view has the shape `(c: AppContext<Bindings>, config, state) => Response | Promise<Response>`,
where `state` is `{ data, actionData, method }`. It builds a `Response` (typically via a render
helper that calls `renderToString` on a JSX tree and wraps it with `htmlResponse`). The context
provides the nonce (via `getNonce(c)` from `@y-core/forge/security`) for inline script attributes
and other per-request values. Views must not perform I/O — all data fetching belongs in the loader.

### 5d. Response and Context Helpers

The context is `AppContext<Bindings>` (a `RequestContext` plus `.env` and `.executionCtx`). It
replaces the old framework context-method surface:

| Old | Now |
|---|---|
| `c.html(x)` | `htmlResponse(x)` from `@y-core/forge/http` |
| `c.text(s, status)` | `new Response(s, { status })` |
| `c.json(d, status)` | `Response.json(d, { status })` |
| `c.redirect(url, 303)` | `redirect(url, 303)` from `@y-core/forge/http` |
| HTMX fragment | `fragmentResponse(fragment, status?)` from `@y-core/forge/http` |
| `c.req.formData()` | `parseFormData(c)` from `@y-core/forge/form` (or `c.request.formData()`) |
| `c.req.json()` | `c.request.json()` |
| `c.req.header("X")` | `c.request.headers.get("X")` |
| `c.env.MY_KV` | `c.env.MY_KV` (env bindings — unchanged) |
| `ctx.waitUntil(p)` | `c.executionCtx.waitUntil(p)` |
| `c.set(k,v)` / `c.get(k)` | typed `contextVar` accessors (§4) |

Resolved config is available as `c.config` (installed by the router) or via
`configStore.get(c.env)`. Method, URL, and params are `c.method`, `c.url` (a `URL`), and `c.params`.
