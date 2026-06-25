# `@y-core/forge/router`

Declarative, type-safe route configuration for forge apps. Routes are plain **data** — a map of
names to `{ method, pattern }` definitions — bound to handlers by a structurally-checked controller
and registered on the app in one call. The same route map powers type-safe URL generation and
route-table introspection.

This namespace is a **curated re-export** of the `@remix-run/fetch-router` routing engine and the
`@remix-run/route-pattern` URL helpers, plus one forge-specific addition (`routePaths`). The
re-exported surface is documented in brief here; for deep reference on the underlying engine, see the
[`@remix-run/fetch-router`](https://github.com/remix-run/fetch-router) and
[`@remix-run/route-pattern`](https://github.com/remix-run/route-pattern) packages.

```typescript
import { route, createController, get, post } from "@y-core/forge/router";
```

---

## Features

- **Routes as data.** Declare every route once with `route({ … })`. The resulting map is the single
  source of truth for dispatch, URL generation, and introspection.
- **Structural controller binding.** `createController(routes, { actions })` checks that every route
  name has exactly one handler — a missing or misspelled action is a **compile error**, not a
  runtime 404.
- **Type-safe URLs.** `routes.name.href(params)` and `createHref(pattern, params)` derive URL strings
  from the pattern type. Required params that you forget are compile errors; bad params throw at
  runtime.
- **Verb shorthands.** `get`, `post`, `put`, `patch`, `del`, `head`, `options` build typed `Route`
  objects without spelling out `{ method, pattern }`.
- **Route-table introspection.** `routePaths(routes, filter?)` flattens a route map into its path
  strings — useful for navigation menus, sitemaps, or wiring per-path middleware.
- **Per-route and per-controller middleware.** Each action can carry a `middleware` array; the
  controller can carry one shared array that runs before every action.

---

## Usage

### Declare routes, bind handlers, register

The canonical three-step flow: describe routes, bind them to handlers, map them onto the app
(`Forge` from [`@y-core/forge/app`](../app/README.md)).

```typescript
import { route, createController, get, post } from "@y-core/forge/router";

// 1. Describe the routes as data — the single source of truth.
const routes = route({
  home: get("/"),
  save: post("/api/save"),
  load: get("/api/load"),
  settingsPut: post("/api/settings"),
  logs: get("/admin/logs"),
});

// 2. Bind each route name to a handler — bare, or `{ middleware, handler }`.
const controller = createController(routes, {
  actions: {
    home: homeController,
    save: { middleware: [csrfGuard, originGuard], handler: saveController },
    load: loadController,
    settingsPut: settingsPutController,
    logs: { middleware: [adminAuth], handler: logsController },
  },
});

// 3. Register on the app (`app` is a `Forge` instance from `@y-core/forge/app`).
app.map(routes, controller);
```

Every route leaf in `routes` must have a matching entry in `actions`, and vice-versa. The mapping is
checked structurally, so a missing, extra, or misspelled handler fails type-checking.

### Two ways to declare a route

A route definition is either a **verb helper** or an object literal. Both produce the same `Route`.
A bare string or `RoutePattern` is also accepted and defaults to method `ANY`.

```typescript
import { route, get, post, Route } from "@y-core/forge/router";

const routes = route({
  home: get("/"),                                   // verb helper
  save: { method: "POST", pattern: "/api/save" },   // object literal
  any: new Route("ANY", "/health"),                 // explicit Route
  catchAll: "/legacy/*path",                         // bare string → method ANY
});
```

### Nesting and base patterns

`route()` accepts nested maps, and an optional **base pattern** as the first argument that is joined
onto every contained pattern.

```typescript
const routes = route({
  home: get("/"),
  api: route({
    save: post("/api/save"),
    load: get("/api/load"),
  }),
});

// Base pattern joined onto each child:
const admin = route("/admin", {
  logs: get("/logs"),     // → "/admin/logs"
  users: get("/users"),   // → "/admin/users"
});
```

Nested route names are addressed by path: `routes.api.save.href()`.

### Generate URLs

Build URLs from the route, never by string concatenation. The pattern's params are part of its type,
so the call is checked.

```typescript
const routes = route({
  user: get("/users/:id"),
  save: post("/api/save"),
});

routes.save.href();                          // "/api/save"
routes.user.href({ id: "42" });              // "/users/42"
routes.user.href({ id: "42" }, { tab: "x" }); // "/users/42?tab=x"
```

For a raw pattern string (not part of a route map), use `createHref` directly:

```typescript
import { createHref } from "@y-core/forge/router";

createHref("/users/:id", { id: "42" });   // "/users/42"
```

### Introspect the route table

`routePaths` flattens a route map into its declared path strings, optionally filtered by method. It
recurses into nested maps and preserves declaration order.

```typescript
import { routePaths } from "@y-core/forge/router";

const routes = route({
  home: get("/"),
  save: post("/api/save"),
  importDoc: post("/api/import"),
});

routePaths(routes);                      // ["/", "/api/save", "/api/import"]
routePaths(routes, { method: "POST" });  // ["/api/save", "/api/import"]
```

---

## Core Components & APIs

### Route authoring

| Symbol | Signature | Description |
|---|---|---|
| `route` | `route(defs)` / `route(base, defs)` | Build a typed `RouteMap` from a `RouteDefs` object. With a `base` pattern, joins it onto every child. Alias of `createRoutes`. |
| `get` `post` `put` `patch` `del` `head` `options` | `(pattern) => Route` | Verb shorthands. Each returns a `Route` typed to that method and pattern (`del` ⇒ `DELETE`). |
| `Route` | `new Route(method, pattern)` | A single route definition: `.method`, `.pattern` (parsed AST), and `.href(...args)`. |
| `resource` | `resource(name, options?)` | Build the route map for a **singular** RESTful resource. See upstream docs. |
| `resources` | `resources(name, options?)` | Build the route map for a **collection** RESTful resource. See upstream docs. |
| `form` | `form(pattern, options?)` | Build a GET + POST pair for a form endpoint. See upstream docs. |

`route()` definitions (`RouteDef`) accept three shapes: a bare pattern string, a `RoutePattern`, or
`{ method?, pattern }` (method defaults to `ANY` when omitted).

### Controllers and actions

| Symbol | Signature | Description |
|---|---|---|
| `createController` | `createController(routes, controller)` | Bind route names to actions. `controller` is `{ actions, middleware? }`. Action keys are structurally checked against `routes`. |
| `createAction` | `createAction(route, action)` | Type a single action against its route so `context.params` is inferred. Returns the action unchanged. |
| `Action` | _type_ | A handler `(context) => Response \| Promise<Response>`, or `{ middleware?, handler }`. |
| `Controller` | _type_ | `{ actions, middleware? }` mapping a `RouteMap`'s leaves to actions. |
| `RequestHandler` | _type_ | `(context) => Response \| Promise<Response>`. |

An action is either a bare handler or an object with per-action middleware:

```typescript
const controller = createController(routes, {
  middleware: [requestLogger],   // runs before every action in this controller
  actions: {
    home: homeController,                                   // bare handler
    save: { middleware: [csrfGuard], handler: saveAction }, // per-action middleware
  },
});
```

Middleware order at dispatch: controller middleware → action middleware → handler.

### Middleware and context

| Symbol | Signature | Description |
|---|---|---|
| `createMiddleware` | `createMiddleware(...middleware)` | Preserve a middleware chain's exact tuple type when stored in a variable. Prefer plain inline arrays elsewhere. |
| `createContextKey` | `createContextKey()` | Mint a typed key for storing per-request values on the context. |
| `RequestContext` | _class_ | The base context object passed to every handler and middleware. forge extends it at runtime with the Workers `env`/`executionCtx` — see [`@y-core/forge/context`](../context/README.md). |
| `Middleware` `MiddlewareContext` | _types_ | The middleware function type and the context it produces. |

### Type-safe URL generation

| Symbol | Signature | Description |
|---|---|---|
| `createHref` | `createHref(pattern, params?, searchParams?)` | Build a URL string from a raw pattern. `params` is required when the pattern has required params. Throws `CreateHrefError` on missing/invalid params or a hostname-only pattern. |
| `CreateHrefError` | _class_ | Thrown by `createHref` / `Route.href` when args don't satisfy the pattern. Carries a `details` discriminant (`missing-params`, `missing-hostname`, `nameless-wildcard`, …). |
| `joinPatterns` | `joinPatterns(a, b)` | Join two route-pattern segments into one normalized pattern (the same join `route(base, defs)` applies). |
| `CreateHrefArgs` `JoinPatterns` | _types_ | The argument tuple for a pattern, and the joined-pattern type. |

### Route-table introspection (forge-specific)

The only addition forge layers over the upstream engine.

| Symbol | Signature | Description |
|---|---|---|
| `routePaths` | `routePaths(routeMap, filter?)` | Collect every `Route`'s path string from a `RouteMap`, in declaration order, recursing into nested maps. |
| `RouteFilter` | `{ method?: RequestMethod \| "ANY" }` | Restrict `routePaths` to routes whose method matches exactly. Omit `method` to match all. |

```typescript
// Wire per-path middleware onto only the mutating endpoints.
for (const path of routePaths(routes, { method: "POST" })) {
  app.use(path, csrfGuard);
}
```

### Lower-level router engine

Most apps never touch these — `createApp` from [`@y-core/forge/app`](../app/README.md) builds and
owns the router for you.

| Symbol | Signature | Description |
|---|---|---|
| `createRouter` | `createRouter(options?)` | Construct a bare `Router`. Used internally by `createApp`; reach for it only when you need a router outside the forge app lifecycle. |
| `RouterOptions` `RouterTypes` | _types_ | Router construction options and the router's context/type configuration. |
| `RouteEntry` `MatchData` | _types_ | The normalized entry stored in the matcher (`pattern`, `handler`, `method`, `middleware`). |

`RouterOptions` accepts `defaultHandler` (the no-match fallback, default `404`), a `matcher`, and
router-wide `middleware`.

---

## Type reference

Re-exported types, grouped by concern:

| Concern | Types |
|---|---|
| Route maps | `RouteMap`, `RouteDef`, `RouteDefs`, `BuildRoute`, `RequestMethod` |
| Resource helpers | `ResourceMethod`, `ResourceOptions`, `ResourcesMethod`, `ResourcesOptions`, `FormOptions` |
| Controllers / actions | `Action`, `Controller`, `RequestHandler`, `Middleware`, `MiddlewareContext` |
| URL generation | `CreateHrefArgs`, `JoinPatterns` |
| Router engine | `RouterOptions`, `RouterTypes`, `RouteEntry`, `MatchData` |
| Introspection | `RouteFilter` |

---

## See also

- [`@y-core/forge/app`](../app/README.md) — `createApp`, `definePage`, `defineAction`, and
  `app.map(routes, controller)`, which consume the route maps built here.
- [`@y-core/forge/context`](../context/README.md) — the `AppContext` extensions to `RequestContext`.
- [`@remix-run/fetch-router`](https://github.com/remix-run/fetch-router) — upstream engine reference
  for `createRouter`, controllers, middleware, and the `resource`/`resources`/`form` helpers.
- [`@remix-run/route-pattern`](https://github.com/remix-run/route-pattern) — upstream reference for
  pattern syntax, `createHref`, and `joinPatterns`.
