---
title: Routing and Middleware
description: "route declarative config, route() function, index, layout, prefix, applyRoutes, middleware composition, middleware ordering, context namespace, contextVar accessor, Hono context variables, RouteConfig, RouteView, RouteAction, RouteLoader"
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

- §1 router namespace: `route()`, `index`, `layout`, `prefix`, `applyRoutes`, `App`, `Context`
- §2 Declarative route config pattern: `RouteConfig`, `RouteConfigEntry` shape
- §3 Middleware composition and ordering rules
- §4 context namespace: `contextVar` typed accessor (internal, no public export)
- §5 Route lifecycle: loader (GET) and action (POST) handler types

---

## 1. Router Namespace Exports

Imports from `@y-core/forge/router`:

- `route(path, config)` — creates a `RouteConfigEntry`
- `index` — shorthand for `route("/", config)`
- `layout(path, config)` — wraps children in a layout component
- `prefix(path, children)` — groups routes under a shared path prefix
- `applyRoutes(app, routes)` — registers all routes on the Hono app
- `App` — Hono app type (re-export of Hono class as `App`)
- `Context`, `MiddlewareHandler`, `Next` — Hono types re-exported for consumer use

### 1a. Declarative Route Config Pattern

Routes are declared in a single `routes.tsx` or `routes.ts` file as `RouteConfig<Env>`.
The config is a flat or nested array of `RouteConfigEntry` objects.

    // src/routes.tsx
    import { route, type RouteConfig } from "@y-core/forge/router"
    import type { AppEnv } from "./app/context"

    export const routes: RouteConfig<AppEnv> = [
      route("/", { loader: homeLoader, view: HomeView }),
      route("/api/contact", { middleware: [csrfGuard], action: contactAction }),
    ]

Pass the config array to `applyRoutes` in the worker factory:

    applyRoutes(app, routes)

### 1b. RouteConfigEntry Shape

Each `RouteConfigEntry` accepts:

| Field | Type | Purpose |
|---|---|---|
| `path` | `string` | URL pattern; supports `:param` and `*` wildcards |
| `loader` | `RouteLoader<E>` | Handles GET; returns loader data or a `Response` |
| `action` | `RouteAction<E>` | Handles POST/PUT/DELETE; returns `Response` |
| `view` | `RouteView<E>` | JSX component that receives loader data |
| `middleware` | `MiddlewareHandler<E>[]` | Per-route guards; run before loader/action |

All fields except `path` are optional. A route may have any combination of
`loader`, `action`, and `view`. A `view` without a `loader` is valid when the
view needs no data from the server.

### 1c. applyRoutes Registration

`applyRoutes(app, routes)` iterates the config array and registers each entry
on the Hono app:

- Routes with both `loader` and `action` → GET and POST handlers registered.
- Routes with only `loader` → GET handler only.
- Routes with only `action` → POST handler only.
- Per-route `middleware` is prepended to the handler chain in array order.

`applyRoutes` must be called after all app-level middleware is registered so that
app-level middleware executes first in the chain.

---

## 2. Declarative Route Config Patterns

### 2a. Full-Page Routes with Loader and View

A loader fetches or computes data; the view renders it as a full HTML page.
The loader return value is passed directly to the view component.

    route("/", {
      loader: async (c) => {
        const config = configStore.get(c.env)
        const ctx = await renderContext(c, config)
        return { ctx, content: homeContent }
      },
      view: HomeView,
    })

The view component signature receives the loader data and the Hono context:

    const HomeView = (data: HomeData, c: Context<AppEnv>): JSX.Element => (
      <Layout ctx={data.ctx}>
        <Home content={data.content} />
      </Layout>
    )

### 2b. Action-Only Routes

API endpoints that mutate state or send messages use `action` only.
Multiple middleware guards compose in declaration order.

    route("/api/contact", {
      middleware: [contactSecurityGuard, rateLimitGuard, csrfVerifyGuard],
      action: handleContactAction,
    })

The action returns a `Response` directly — either an HTMX fragment, a JSON
response, or a redirect. It never delegates to a view.

### 2c. Health Check Route

The `healthCheck` factory from `@y-core/forge/app` produces a loader compatible
with the standard route shape. Pass a `csrf` predicate to control whether
CSRF validation is required for the health endpoint (typically always `true`).

    import { healthCheck } from "@y-core/forge/app"

    route("/api/health", { loader: healthCheck<AppEnv>({ csrf: () => true }) })

### 2d. Grouped Routes with prefix

`prefix` keeps related routes co-located and avoids repeating path segments:

    import { prefix, route } from "@y-core/forge/router"

    const apiRoutes = prefix("/api", [
      route("/contact", { middleware: [csrfVerifyGuard], action: contactAction }),
      route("/health",  { loader: healthCheck<AppEnv>({ csrf: () => true }) }),
    ])

    export const routes: RouteConfig<AppEnv> = [
      route("/", { loader: homeLoader, view: HomeView }),
      ...apiRoutes,
    ]

---

## 3. Middleware Composition and Ordering

### 3a. App-Level vs Route-Level Middleware

App-level middleware is registered on the Hono app before `applyRoutes` and
runs for every request regardless of route. Route-level middleware is declared
in the `middleware` array of a `RouteConfigEntry` and runs only for that route.

Recommended app-level registration order:

1. `makeSecurityHeaders` — injects CSP/HSTS/XFO headers and the per-request nonce.
2. `requestId` — generates and stores a request ID in context.
3. `requestLogger` — logs request method, path, status, and duration.
4. `cors` (scoped to `/api/*`) — adds CORS headers for API routes only.

Route-level middleware runs after all app-level middleware has completed.

### 3b. Middleware Handler Type

    import type { MiddlewareHandler } from "@y-core/forge/router"

    const myGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
      if (!isAllowed(c)) return c.text("Forbidden", 403)
      return next()
    }

A middleware must either call `next()` to continue the chain or return a
`Response` to short-circuit. Failing to call `next()` and not returning a
response results in a hung request.

### 3c. Middleware Array Ordering on Routes

Middleware in the `middleware` array executes left-to-right before the
`loader` or `action` is invoked:

    route("/api/contact", {
      middleware: [contactSecurityGuard, rateLimitGuard, csrfVerifyGuard],
      action: handleContactAction,
    })
    // Execution order:
    // contactSecurityGuard → rateLimitGuard → csrfVerifyGuard → handleContactAction

Place broad guards (origin checks, rate limiting) before narrow guards (CSRF
token verification) so cheap rejections occur before expensive ones.

### 3d. Security Middleware Placement

`makeSecurityHeaders` must always be the first app-level middleware. It sets the
nonce used by CSP. Any middleware that reads or writes security headers must run
after it. See [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) for the full
nonce and CSP contract.

---

## 4. Context Namespace (Internal)

### 4a. contextVar Typed Accessor

The internal `context` namespace provides `contextVar` — a factory for typed
accessors over Hono's `c.set` / `c.get` context variable store.

This namespace has **no public export path** in `package.json`. Consumer code
must never import from `@y-core/forge/context`. It is used only inside forge
namespaces to create typed accessors that are then exported via their own
namespace (e.g., `@y-core/forge/security`).

    // Inside a forge namespace (not consumer code):
    import { contextVar } from "../context/accessor"

    export const requestIdCtx = contextVar<string>("requestId")

    // Middleware that sets the value:
    const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
      requestIdCtx.set(c, crypto.randomUUID())
      return next()
    }

    // Downstream middleware or handler that reads the value:
    const id = requestIdCtx.get(c)          // throws if not set
    const id = requestIdCtx.getOptional(c)  // returns undefined if not set

### 4b. Context Variable Typing

`contextVar<T>(key)` creates a typed accessor bound to the string key `key`.
The generic `T` prevents callers from accidentally reading a context slot with
the wrong expected type. Each `contextVar` instance is the sole read/write point
for its slot — no raw `c.get("requestId")` calls appear in consumer code.

The typed accessor API surface:

| Method | Behaviour |
|---|---|
| `.set(c, value)` | Stores `value` under the key in context |
| `.get(c)` | Returns the value; throws `Error` if the key is unset |
| `.getOptional(c)` | Returns the value or `undefined` if unset |

---

## 5. Route Lifecycle

### 5a. Loader — GET Handler Pattern

    type RouteLoader<E extends Env> = (c: Context<E>) => Promise<LoaderData> | Response

A loader handles GET requests. It may:

- Return a plain object (`LoaderData`) — `applyRoutes` passes it to the view.
- Return a `Response` directly — used for redirects or streaming responses.

Loaders should not write response headers directly; delegate header concerns to
app-level middleware (`makeSecurityHeaders` already sets security headers).

### 5b. Action — POST Handler Pattern

    type RouteAction<E extends Env> = (c: Context<E>) => Promise<Response>

An action handles POST, PUT, and DELETE requests. It always returns a `Response`.
Common return patterns:

- `c.html(fragment)` — HTMX partial HTML swap.
- `c.json(data, status)` — JSON API response.
- `c.redirect(url, 303)` — Post/Redirect/Get pattern.

Actions read form data via `c.req.formData()` or JSON via `c.req.json()`.
Input validation must occur at the top of the action body before any side effects.

### 5c. View — JSX Render Component

    type RouteView<E extends Env> = (data: LoaderData, c: Context<E>) => JSX.Element

A view receives the loader's return value as its first argument and the Hono
context as its second. It returns a Hono JSX element rendered to HTML by
`applyRoutes`. The context argument provides access to the nonce (via the
security namespace) for inline script attributes and other per-request values.

Views live in `src/views/` and import layout wrappers from the same directory.
They must not perform I/O — all data fetching belongs in the loader.
