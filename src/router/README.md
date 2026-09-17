---
title: Declarative Route Configuration
description: "Declaring routes as data, binding them to handlers, generating URLs from the same map, and wiring middleware onto the paths it declares."
audience: consumer
---

# `@y-core/forge/router`

Routes in a forge app are **data**: a map of names to `{ method, pattern }` pairs, written once and bound to handlers separately. That one map is
what dispatch, URL generation, and middleware wiring all read, so a path exists in exactly one place.

The namespace is a curated re-export of the [`@remix-run/fetch-router`](https://github.com/remix-run/fetch-router) engine and the
[`@remix-run/route-pattern`](https://github.com/remix-run/route-pattern) URL helpers, plus forge's own `routePaths` and `forMethod`. Pattern syntax
and the resource helpers are upstream's to document; this file covers the shape forge expects you to use.

```ts
import { createController, get, post, route, routePaths } from "@y-core/forge/router";
```

---

## Getting started

Describe the routes, bind each name to a handler, then register the pair on the app.

```ts
import { createController, get, post, route } from "@y-core/forge/router";

const routes = route({
  home: get("/"),
  save: post("/api/save"),
  logs: get("/admin/logs"),
});

const controller = createController(routes, {
  middleware: [requestLogger], // every action in this controller
  actions: {
    home: homeHandler, // a bare handler
    save: { middleware: [csrfGuard, originGuard], handler: saveHandler }, // guards for this route only
    logs: { middleware: [adminAuth], handler: logsHandler },
  },
});

app.map(routes, controller); // `app` is a `Forge` from `@y-core/forge/app`
```

The binding is checked structurally: every route name needs exactly one action and every action needs a route, so a misspelled or forgotten handler
is a type error rather than a 404 you find in production. At dispatch the order is controller middleware, then action middleware, then the handler.
Register global middleware before `app.map`, or it will not wrap these routes — that rule and the rest of the registration contract are
[`ROUTING_AND_MIDDLEWARE.md`][ram-1c] §1c's.

A route definition can be any of four things, all producing the same `Route`:

```ts
const routes = route({
  home: get("/"), // verb helper: get, post, put, patch, del, options
  save: { method: "POST", pattern: "/api/save" }, // object literal
  health: new Route("ANY", "/health"), // explicit Route
  legacy: "/legacy/*path", // bare pattern — method ANY
});
```

For a handler living in its own file, `createAction(routes.save, handler)` types it against its route so `context.params` is inferred. It returns
the handler untouched. For whole RESTful maps, upstream's `resource`, `resources` and `form` helpers are re-exported here too.

---

## Grouping routes under a shared prefix

`route()` nests, and an optional first argument is a base pattern joined onto every pattern inside.

```ts
const routes = route({
  home: get("/"),
  admin: route("/admin", {
    logs: get("/logs"), // → /admin/logs
    users: get("/users"), // → /admin/users
  }),
});

routes.admin.logs.href(); // "/admin/logs"
```

A nested name is addressed by its path through the map, which is also how the controller's `actions` object is shaped. Prefer a base pattern to
repeating the prefix in each child: renaming the mount point then touches one line, and every `href` and `routePaths` result follows.

---

## Building a URL for a route

Never concatenate a path. The pattern's params are part of its type, so a forgotten required param is a compile error and a wrong one throws.

```ts
const routes = route({ user: get("/users/:id"), search: get("/search") });

routes.user.href({ id: "42" }); // "/users/42"
routes.search.href(undefined, { searchParams: { q: "a b&c" } }); // "/search?q=a+b%26c" — search values are encoded
```

Params come first, everything else under the options object: `searchParams` takes a `URLSearchParams` or a record of strings, numbers and arrays of
them, and `baseURL` takes an absolute URL to render the target against. Give `baseURL` the page the link sits on and a same-origin target comes back
path-relative — useful when the markup is rendered once and served under more than one origin. It throws a `TypeError` where the value is not
absolute, or where no same-origin target can be resolved from it.

For a pattern that is not part of a route map, `createHref(pattern, params, options)` does the same job standalone, and `joinPatterns(a, b)`
performs exactly the join `route(base, defs)` applies — useful when you are computing a mount point rather than declaring one.

```ts
createHref("/search", undefined, { searchParams: { q: "a b&c" } }); // "/search?q=a+b%26c"
```

---

## Listing the paths a route map declares

`routePaths(routes, filter?)` flattens the map into its declared path strings, recursing into nested maps and preserving declaration order. It is
how you drive a navigation menu, a sitemap, or a middleware loop from the routes themselves instead of a second hand-written list.

```ts
import { forMethod, routePaths } from "@y-core/forge/router";

routePaths(routes); // every declared path, in order
routePaths(routes, { method: "POST" }); // paths that serve POST

for (const path of routePaths(routes, { method: "POST" })) {
  app.use(path, forMethod("POST", csrfGuard));
}
```

**The filter answers "which paths serve this method?", not "which were declared with it".** A route declared `ANY` serves every method, so it shows
up under any concrete filter; `{ method: "ANY" }` is the one exception and selects only the routes declared `ANY`.

**`app.use` matches on path alone** — dispatch never consults the method — so a filtered list selects paths, not method-and-path pairs. `forMethod`
is what closes the gap: it wraps a middleware so it runs for the given method (or array of them) and calls `next()` otherwise. Without it, the loop
above would guard every method those paths serve, `/health` on GET included. `forMethod` reads `context.method`, the same value dispatch matched on,
so a method override is honoured, and `forMethod("GET", …)` also covers `HEAD`.

---

## Gotchas

**There is no `head` verb, on purpose.** Forge rewrites a `HEAD` request into a derived `GET` before dispatch, so a route declared `head(...)` could
never match ([`ROUTING_AND_MIDDLEWARE.md`][ram-1d] §1d). A `HEAD` branch inside a middleware is still correct.

**A method filter that matches nothing throws.** The result of `routePaths` is nearly always fed to a middleware loop, and an empty list would
attach that middleware to nothing — a silent hole is worse than an error naming the method. An unfiltered call never throws, and neither does a
route map with no routes in it.

**`href` and `createHref` throw `CreateHrefError`, not a `Result`.** Its `details` carries a discriminant (`missing-params`, `missing-hostname`,
`nameless-wildcard`, …) for a caller that wants to branch. A missing _required_ param is caught at compile time; this is the runtime backstop for
values that were not statically known.

**A route pattern and a URL are both held to a budget, and both throw `MatcherResourceError`.** `app.map` and `app.use` throw it at registration
when a pattern exceeds forge's per-pattern ceiling; a URL that exhausts the match-work budget throws it during matching, where the error boundary
answers `500`. Its `details` carries the discriminant that tells the two apart, typed as `MatcherResourceErrorDetails`. Catch it by importing from
`@y-core/forge/router` — never from route-pattern directly. The budgets themselves are [`ROUTING_AND_MIDDLEWARE.md`][ram-1f] §1f's.

**`createRouter` is here but is rarely yours to call.** `createApp` from [`src/app/README.md`][app-readme] builds and owns the router, including its
`defaultHandler` and matcher. Reach for the bare constructor only outside the forge app lifecycle.

---

## See also

- [`docs/ROUTING_AND_MIDDLEWARE.md`][ram] — the governing doctrine: routes as a map (§1a), controllers (§1b), registration order (§1c), the absent
  `head` verb (§1d), and middleware composition (§3)
- [`src/app/README.md`][app-readme] — `createApp`, `app.map`, and the `definePage` / `defineAction` builders that fill a controller's actions
- [`src/context/README.md`][context-readme] — what a handler reads off the context these routes dispatch to

[app-readme]: ../app/README.md
[context-readme]: ../context/README.md
[ram]: ../../docs/ROUTING_AND_MIDDLEWARE.md
[ram-1c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1c-registering-routes-with-appmap
[ram-1d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1d-no-head-verb-export
[ram-1f]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1f-matcher-resource-budgets
