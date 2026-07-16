# `@y-core/forge/app`

App bootstrap and request lifecycle for `@y-core/forge` — the namespace that turns a set of routes, middleware, and handlers into a single Cloudflare Workers `fetch` default export.

`createApp` returns a `Forge` instance: a Workers-native request router wrapped in a fail-closed error boundary. Its `fetch(request, env, executionCtx)` method *is* the Workers module handler, so the entire wiring is `export default app`. Around routing it provides path-scoped middleware, per-request config/env injection, two route-handler factories (`definePage`, `defineAction`), a static-asset catch-all (`applyAssets`), startup binding validation (`validateEnv`, `validateBindings`), and a JSON health endpoint (`healthCheck`).

This namespace is an **integration namespace** — it composes `form`, `http`, `logging`, `result`, `router`, `security`, and `validation` into the app lifecycle. See [`.decisions/ROUTING_AND_MIDDLEWARE.md`](../../.decisions/ROUTING_AND_MIDDLEWARE.md) and [`.decisions/LIBRARY_ARCHITECTURE.md`](../../.decisions/LIBRARY_ARCHITECTURE.md) for the authoritative architecture.

---

## Features

- **One-line Workers entry** — `export default createApp(...)`; the `Forge` instance's `fetch` is a valid module-worker default export, including `HEAD` handling.
- **Fail-closed error boundary** — every throw inside or outside the middleware chain produces a hardened `500` page; an in-chain throw still flows back out through security headers.
- **Path-scoped middleware** — `app.use("*", ...)` / `app.use("/api/*", ...)` register guards that wrap matched routes.
- **Declarative route registration** — `app.map(routes, controller)` binds a route map to its controller.
- **Two route-handler factories** — `definePage` (loader → view, with caching and error recovery) and `defineAction` (parse → validate → handle, with automatic `413`/`400`/`422`/`500` error fragments).
- **Static-asset catch-all** — `applyAssets` serves the `ASSETS` binding with a typed `notFoundView` fallback.
- **Config injection** — a `Config` store passed to `createApp` is resolved once per request and exposed on the context (`ConfigKey`, `c.config`).
- **Startup binding validation** — `validateEnv` (one-shot, throws) and `validateBindings` (middleware form) check Worker bindings against a valibot schema.
- **Health endpoint** — `healthCheck` runs named predicates concurrently and returns `{ ok, checks }` as JSON (`200`/`503`).
- **Test harness** — `app.request(path, init?, env?)` builds a `Request`, dispatches the full chain, and awaits any `waitUntil` work.

---

## Usage

A complete Workers entry that wires middleware, routes, assets, and a health check:

```ts
import {
  createApp,
  applyAssets,
  definePage,
  defineAction,
  healthCheck,
  validateBindings,
} from "@y-core/forge/app";
import { renderPage } from "@y-core/forge/jsx";
import { route, createController } from "@y-core/forge/router";
import { createSecurityHeaders, NONCE } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";
import { configStore, type AppConfig } from "./config";

interface Bindings {
  CSRF_SECRET: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
  MY_KV: KVNamespace;
}

const app = createApp<Bindings>({
  config: configStore,                               // resolved once per request → c.config
  isDebug: (c) => configStore.get(c.env).site.debug, // show error detail when true
});

// Global, path-scoped middleware. "*" matches everything; "/api/*" matches the prefix.
app.use("*", createSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));
app.use("*", validateBindings(v.object({ CSRF_SECRET: v.string() })));

// Routes as data (single source of truth).
const routes = route({
  home:    { method: "GET",  pattern: "/" },
  contact: { method: "POST", pattern: "/api/contact" },
  health:  { method: "GET",  pattern: "/api/health" },
});

const controller = createController(routes, {
  actions: {
    home:    homePage,
    contact: { middleware: [csrfGuard], handler: contactAction },
    health:  healthCheck<Bindings>({ kv: (c) => Boolean(c.env.MY_KV) }),
  },
});

app.map(routes, controller);
applyAssets(app, { notFoundView });   // static-asset catch-all over the ASSETS binding

export default app;
```

> `renderPage` is imported from `@y-core/forge/jsx`, **not** from this namespace. Pages call it inside their `view` to turn a JSX tree into an `HtmlResponse`.

---

## Core Components & APIs

### `createApp(options?)`

Creates a `Forge` instance with a structured error boundary.

| Option | Type | Description |
|---|---|---|
| `config` | `Config<T>` (object) | A config store (from `@y-core/forge/config`). Registered against the app and resolved once per request; the result is exposed as `c.config` and to page/action handlers. |
| `isDebug` | `(c: AppContext<Bindings>) => boolean` | When it returns `true`, the default `500` page includes the error message; otherwise a generic message is shown. Throwing inside `isDebug` is caught and treated as `false`. |
| `onError` | `(error: Error, c: AppContext<Bindings>) => Response \| Promise<Response>` | Custom app-level error handler. Replaces the default `500` page. If it throws, forge falls back to the default page. |
| `logger` | `Logger` | Custom logger injected into the error handler. Defaults to `createLogger("app")`. |
| `middleware` | `(app: Forge<Bindings>) => void` | Wiring step 1 — register global middleware (typically one `applyMiddlewareChain` call). |
| `routes` | `(app: Forge<Bindings>) => void` | Wiring step 2 — register routes (`app.map` calls). |
| `finalize` | `(app: Forge<Bindings>) => void` | Wiring step 3 — late registrations (e.g. dev-only routes) that must precede the asset catch-all. |
| `assets` | `AssetOptions<Bindings>` | Wiring step 4 — registers the static-asset catch-all **last**, so real routes always win. |

All options are optional; `createApp()` with no arguments is valid. The generic `Bindings` parameter types `c.env` throughout the app.

The wiring fields make the whole bootstrap a single expression — `createApp` runs them in the enforced canonical order (`middleware` → `routes` → `finalize` → `assets`), so the register-last rule for the asset catch-all cannot be violated:

```ts
import { applyMiddlewareChain, createApp } from "@y-core/forge/app";

export default createApp<Bindings>({
  config: configStore,
  isDebug: (c) => configStore.get(c.env).site.debug,
  onError: (err, c) => renderErrorPage(c, err),
  middleware: (app) =>
    applyMiddlewareChain(app, {
      logging: { channels: (c) => [consoleChannel()] },
      securityHeaders: { scriptSrc: ["'self'", NONCE] },
      bindings: EnvSchema,
      guards: [{ paths: ["/api/save"], origin: { allowedOrigins: (c) => allowed(c) }, rateLimit: { limiter: (c) => c.env.RATE_LIMITER } }],
    }),
  routes: registerRoutes,
  finalize: registerDevRoutes, // optional — e.g. /admin/logs in dev builds only
  assets: { notFoundView: notFoundController },
});
```

Manual wiring (`createApp()` + `app.use` + `app.map` + `applyAssets`) remains fully supported for layouts the fields cannot express.

### `Forge` — the app object

`createApp` returns a `Forge<Bindings>`. The `Forge` class is also exported directly for typing.

| Member | Signature | Description |
|---|---|---|
| `fetch` | `(request: Request, env: Bindings, executionCtx?: ExecutionContext) => Promise<Response>` | The Workers module `fetch` handler. `HEAD` requests are served as `GET` with the body stripped. `executionCtx` defaults to a mock context for non-Workers environments. |
| `use` | `(path: string, ...handlers: Middleware[]) => void` | Registers path-scoped global middleware. `"*"` matches every request; `"/admin/*"` matches `/admin` and anything beneath it. |
| `map` | `(routes, controller) => void` | Declarative route registration — the canonical way to add routes. |
| `request` | `(path: string, init?: RequestInit, env?: Bindings) => Promise<Response>` | Test helper: builds a `Request` from `path`, dispatches the full chain, and awaits any `waitUntil` promises before returning. |

Because `fetch` is the module handler, the whole app ships as:

```ts
export default app;
```

The router is built lazily on the first request, with a static middleware stack: per-request state injection → header flush → path-scoped guards → error boundary → matched route. This ordering is why error responses still carry the consumer's security headers.

### `definePage(def)`

Wraps a `loader` (data) + `view` (JSX → `Response`) into a `RequestHandler`, with optional caching, custom headers, and error recovery.

| Field | Type | Description |
|---|---|---|
| `loader` | `(c, config) => LoaderData \| Response \| Promise<...>` | Optional. Fetches page data. Returning a `Response` (e.g. a redirect) short-circuits rendering — the response still gets the configured headers/cache applied. |
| `view` | `(c, config, state) => Response \| Promise<Response>` | Required. Builds the page response. `state` is `{ data, actionData, method }`; `state.data` is the loader's return value. |
| `cache` | `"no-store" \| CacheDirective` | Optional. Sets `Cache-Control`. `CacheDirective` is `{ maxAge: number; scope?: "public" \| "private" }` (scope defaults to `"public"`). |
| `headers` | `Record<string, string>` | Optional. Extra response headers, merged onto whatever the view returned. |
| `onError` | `(error: Error, c) => Response \| Promise<Response>` | Optional. Called if `loader` or `view` throws. If omitted, the error re-throws to the app's error boundary. |

```ts
import { definePage } from "@y-core/forge/app";
import { renderPage } from "@y-core/forge/jsx";

export const homePage = definePage<Bindings, AppConfig>({
  cache: { maxAge: 300, scope: "public" },
  loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
  view: (_c, _cfg, state) => renderPage(<Home greeting={state.data.greeting} />),
  onError: (err, c) => renderErrorPage(c, err),
});
```

The view receives the resolved `config` (the second argument) and the render `state` (the third). I/O belongs in the `loader`, not the `view`.

### `defineAction(def)`

Wires a `parse → validate → handle` pipeline into a POST handler that returns structured error fragments automatically.

| Field | Type | Description |
|---|---|---|
| `parse` | `(formData: ReadonlyFormData) => Input` | Reads typed fields out of the parsed form body. May throw on malformed input → `400`. |
| `validate` | `(data: Input) => ValidationResult<Input>` | Validates the parsed data. A `{ ok: false, error }` result (with `error: readonly string[]`) produces a `422` validation fragment. |
| `handle` | `(data: Input, c, config) => Response \| Promise<Response>` | Runs after validation succeeds. Receives the validated `data`, the context, and the resolved `config`. Returns the response directly. |
| `onValidationError` | `(errors: readonly string[], c) => Response \| Promise<Response>` | Optional. Overrides the default `422` validation fragment; receives the message list from the `ValidationResult` failure (`.error`). |
| `onError` | `(error: Error, c) => Response \| Promise<Response>` | Optional. Overrides the default `400`/`500` fragment when `parse` or `handle` throws. |

```ts
import { defineAction } from "@y-core/forge/app";
import { readFields } from "@y-core/forge/form";
import { renderSuccess } from "@y-core/forge/http";
import { fragmentResponse } from "@y-core/forge/http";

export const contactAction = defineAction<ContactInput, Bindings, AppConfig>({
  parse: (formData) => readFields(formData, ["name", "email", "message"]),
  validate: (data) => validateContact(data),         // ValidationResult<ContactInput>
  handle: async (data, c, config) => {
    await sendEmail(config.email, data);
    return fragmentResponse(renderSuccess("Thanks — we'll be in touch."));
  },
});
```

The automatic error responses (all are HTMX-swappable fragments):

| Status | Cause |
|---|---|
| `413` | Form body exceeds the size cap (`parseFormData` throws with `status: 413`). |
| `400` | Body is unparseable, or `parse` throws (and no `onError`). |
| `422` | `validate` returns `{ ok: false }` (and no `onValidationError`). |
| `500` | `handle` throws (and no `onError`); the failure is logged. |

### `createHandlerFactory<Bindings, ConfigData>()`

Returns `{ definePage, defineAction }` with the app's `Bindings` and `ConfigData` generics pre-bound, so individual route modules stop repeating them. Per-call generics (`LoaderData`, `ActionData`, `Input`) remain inferred as usual. Bind once in an `app/handlers.ts` module and import the bound pair everywhere:

```ts
// app/handlers.ts
import { createHandlerFactory } from "@y-core/forge/app";
export const { definePage, defineAction } = createHandlerFactory<Bindings, AppConfig>();

// controllers/home.tsx — no generic arguments needed:
import { definePage } from "../app/handlers";
export const homePage = definePage({
  loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
  view: (_c, _cfg, state) => renderPage(<Home greeting={state.data.greeting} />),
});
```

The standalone `definePage`/`defineAction` exports are unchanged — the factory is sugar, not a replacement.

### `healthCheck(checks)`

Returns a `RequestHandler` that runs each named predicate concurrently (`Promise.allSettled`) and responds with JSON. A check that throws or rejects is recorded as `false`.

- Each value is `(c: AppContext<Bindings>) => boolean | Promise<boolean>`.
- Response body is `HealthCheckResult` — `{ ok: boolean; checks: Record<string, boolean> }`.
- Status is `200` when every check passes, `503` otherwise; `Cache-Control: no-store` is always set.

```ts
import { healthCheck } from "@y-core/forge/app";

// In the controller actions map — registered as a bare handler, no route middleware:
health: healthCheck<Bindings>({
  kv: (c) => Boolean(c.env.MY_KV),
  r2: async (c) => (await c.env.MY_BUCKET.head("__probe")) !== null,
}),
```

### `applyAssets(app, options, path?)` / `serveAssets(app, options)`

`applyAssets` registers a catch-all route that serves static files from the `ASSETS` binding, falling back to a typed `notFoundView`. The `Bindings` type must include an optional `ASSETS` fetcher (`HasAssets`).

| Parameter | Type | Description |
|---|---|---|
| `app` | `Forge<Bindings>` | The app to register the catch-all on. |
| `options.notFoundView` | `(c, config) => Response \| Promise<Response>` | Rendered when the asset is missing, the binding is absent, or the method is not `GET`/`HEAD`. Receives the resolved app config. |
| `path` | `string` (default `"*"`) | Pattern for the catch-all route. |

```ts
import { applyAssets } from "@y-core/forge/app";

applyAssets(app, {
  notFoundView: (c, config) => renderPage(<NotFound site={config.site} />),
});
```

`serveAssets` is the underlying `RequestHandler` if you need to register it on a non-catch-all route yourself. It returns `notFoundView` on a `404` from the binding, on a missing `ASSETS` binding, or on a non-`GET`/`HEAD` method. Register `applyAssets` **last**, after `app.map`, so real routes take precedence over the catch-all.

### `createErrorPage(options?)`

Builds a styled, debug-gated full-page 500 handler for `createApp({ onError })` (and reusable as `definePage`'s `onError`). It preserves the default boundary's guarantees — the real error message appears **only** when `isDebug(c)` returns `true` (a throwing `isDebug` counts as `false`), and all interpolated content is HTML-escaped.

| Option | Type | Default | Description |
|---|---|---|---|
| `isDebug` | `(c) => boolean` | `() => false` | Gate for showing `error.message`. |
| `title` | `string` | `"Something went wrong"` | Page `<title>` and heading. |
| `stylesheetHref` | `string \| ((c) => string)` | — | Optional stylesheet link (static or per-request, e.g. hashed asset path). A throwing resolver renders the page without the link. |
| `homeHref` | `string` | — | Optional "Back to safety" link. |

```ts
import { createApp, createErrorPage } from "@y-core/forge/app";

const onError = createErrorPage<Bindings>({
  isDebug: (c) => configStore.get(c.env).site.debug,
  stylesheetHref: "/assets/css/main.css",
  homeHref: "/",
});
export default createApp<Bindings>({ config: configStore, onError });
```

### `validateEnv(env, schema)` / `validateBindings(schema)`

Two forms of binding validation against a valibot schema.

- `validateEnv(env, schema)` — one-shot. Returns the typed, validated env, or **throws** `Error("Invalid environment: …")` with the offending paths. Call it at startup when you have the raw env in hand.
- `validateBindings(schema)` — middleware form. Validates `c.env` on the first request, and again whenever the env reference changes (so a swapped binding set is re-checked). Throws on failure; it does not store or mutate the env — read bindings via `c.env` directly.

In production apps the schema is **typically generated**, not hand-written: `forge-cfgen` (`bun run gen:env`, from `@y-core/forge/validation/cli`) emits `env.schema.ts` from `wrangler.jsonc` + `.dev.vars`, so the schema can never drift from the actual binding surface. Hand-written schemas remain fine for small surfaces. See the standard setup guide in [src/config/README.md](../config/README.md).

```ts
import { validateEnv, validateBindings } from "@y-core/forge/app";
import { v } from "@y-core/forge/validation";

const EnvSchema = v.object({
  CSRF_SECRET: v.string(),
  TURNSTILE_SECRET_KEY: v.string(),
});

// One-shot:
const env = validateEnv(rawEnv, EnvSchema);

// Middleware form — validates on the first request:
app.use("*", validateBindings(EnvSchema));
```

### `ConfigKey`

A typed context key (`createContextKey<unknown>()`) under which the resolved app config is stored for the current request. forge's router injects it; `definePage` and `defineAction` read it for you and pass the typed config to your `view`/`handle`. Read it directly only when writing a custom `RequestHandler`:

```ts
import { ConfigKey } from "@y-core/forge/app";

const handler: RequestHandler = (context) => {
  const config = context.get(ConfigKey) as AppConfig;
  // …
};
```

In most code, prefer the `config` argument passed to your loader/view/handle, or `c.config`.

---

## Integration Guide

### 1. Declare routes as data

Build the route map with `route()` from `@y-core/forge/router` — names mapped to `{ method, pattern }`. The map carries no handlers.

```ts
import { route } from "@y-core/forge/router";

export const routes = route({
  home:    { method: "GET",  pattern: "/" },
  contact: { method: "POST", pattern: "/api/contact" },
});
```

### 2. Bind handlers in a controller

`createController(routes, { actions })` maps each route name to either a bare `RequestHandler` or `{ middleware, handler }`. The `actions` keys must match the route names exactly — a missing or misspelled handler is a compile error.

```ts
import { createController } from "@y-core/forge/router";

export const controller = createController(routes, {
  actions: {
    home:    homePage,                                            // bare handler
    contact: { middleware: [csrfGuard], handler: contactAction }, // per-route middleware
  },
});
```

### 3. Register on the app, then assets

```ts
app.use("*", createSecurityHeaders({ scriptSrc: ["'self'", NONCE] })); // globals first
app.map(routes, controller);                                          // routes
applyAssets(app, { notFoundView });                                   // catch-all last
export default app;
```

### Middleware ordering

**Prefer `applyMiddlewareChain`** — it encodes the canonical global order once, so apps never re-derive it:

```
requestId() → requestLogger(logging) → createSecurityHeaders(securityHeaders)
  → validateBindings(bindings) → session → per-path guards (origin → rateLimit → middleware[])
```

Global middleware (`app.use`) runs before route-level middleware (in the controller action); within each, handlers run left-to-right. When hand-writing a chain instead of using the builder, the load-bearing rule is: `createSecurityHeaders` must be registered **before any nonce consumer** (session, guards, views) — pure tracing middleware (`requestId`, `requestLogger`) may precede it. See [`.decisions/ROUTING_AND_MIDDLEWARE.md`](../../.decisions/ROUTING_AND_MIDDLEWARE.md) §3d/§3e for the authoritative contract.

### Page rendering

A `view` returns a `Response`, typically built by `renderPage` from `@y-core/forge/jsx`:

```ts
import { renderPage } from "@y-core/forge/jsx";

view: (_c, _cfg, state) => renderPage(<Home data={state.data} />),
```

`renderPage` converts the JSX tree to an `HtmlResponse` directly — there is no global render-middleware step.

---

## Advanced

### `HEAD` request handling

`Forge.fetch` rewrites `HEAD` to an internal `GET` (preserving headers), runs the full chain, then returns a body-less `Response` with the original status and headers. Handlers never need to special-case `HEAD`.

### Lazy router build and per-request state

The dispatching router is built once, on the first `fetch`, with a fixed middleware stack. Per-request `env`, `executionCtx`, and resolved `config` are stored in a `WeakMap` keyed by the `Request` and re-published onto the context inside the chain. If the request object is replaced between `fetch` and routing (an incompatible `@remix-run/fetch-router` version), forge throws a loud diagnostic rather than silently dropping `env`/`config`.

### Config resolution

When `createApp({ config })` is given a store, `fetch` calls `resolveConfig(store, env)` once per request and exposes the result via `ConfigKey` / `c.config`. `definePage` and `defineAction` read it and pass the typed value to your `view`/`handle`. `applyAssets`/`serveAssets` resolve the same store to pass `config` into `notFoundView`. No config means `c.config` is `undefined` and handlers receive `undefined` for their config argument.

### Testing with `app.request`

`app.request(path, init?, env?)` is the canonical way to exercise the full chain in `bun test`. It builds a `Request`, supplies a test `ExecutionContext`, dispatches through every middleware, and awaits any `waitUntil` promises before resolving — so fire-and-forget work has completed when you assert.

```ts
import { Forge } from "@y-core/forge/app";

const res = await app.request("/api/contact", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ __csrf: token, name: "Jane", email: "j@x.io", message: "Hello there" }),
}, MINIMUM_ENV);

expect(res.status).toBe(200);
```

---

## Security

- **Hardened error boundary.** Every throw — inside the middleware chain or in router internals outside it — yields a `500` page with `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'`, and `referrer-policy: no-referrer`. The in-chain path overlays the consumer's CSP via the pending-header pass; out-of-chain throws still get this baseline. Error responses thus carry security headers by construction.
- **Error detail is gated.** The default `500` page reveals the error message **only** when `isDebug(c)` returns `true`; otherwise it shows a generic message. Never wire `isDebug` to a value an attacker controls.
- **Validation failures are generic by default.** `defineAction` collapses parse/handle failures to neutral `400`/`500` fragments and renders validation errors as a `422` fragment — supply `onError`/`onValidationError` only if you control what is surfaced. Do not leak internal exception detail to clients.
- **Validate bindings at the edge.** Use `validateEnv`/`validateBindings` so a missing or malformed secret (e.g. `CSRF_SECRET`) fails loudly at startup or on the first request, never silently downstream.
- **Asset method gating.** `serveAssets` answers only `GET`/`HEAD`; every other method falls through to `notFoundView`, so the asset catch-all cannot be used as a write surface.

---

## Architecture

`app` is an **integration namespace**: it composes `form` (form parsing for `defineAction`), `http` (fragment/error responses, cache headers), `logging` (the error logger), `result` (`ValidationResult`, `toError`), `router` (the underlying `@remix-run/fetch-router`), `security`, and `validation` (`validateEnv` schemas). Consumers reach all of it through `@y-core/forge/app` and never import `@remix-run/*` directly — the facade isolates version churn ([`.decisions/LIBRARY_ARCHITECTURE.md`](../../.decisions/LIBRARY_ARCHITECTURE.md) §1a, §2b).

Per the Workers runtime model, `createApp` is a factory that captures bindings at request time, not at module evaluation — module-level state stays request-independent across V8 isolates. Use `c.executionCtx.waitUntil` for work that should outlive the response.

Related docs:

- [`.decisions/ROUTING_AND_MIDDLEWARE.md`](../../.decisions/ROUTING_AND_MIDDLEWARE.md) — route map, controller, middleware ordering, `definePage`/`defineAction` lifecycle.
- [`.decisions/LIBRARY_ARCHITECTURE.md`](../../.decisions/LIBRARY_ARCHITECTURE.md) — facade pattern, namespace tiers, Workers runtime constraints.

---

## Exports

| Symbol | Kind | Summary |
|---|---|---|
| `createApp` | function | Creates a `Forge` app with a structured error boundary. |
| `Forge` | class | The app object — a Workers-native router with `fetch`/`use`/`map`/`request`. |
| `definePage` | function | Loader + view → `RequestHandler`, with caching and error recovery. |
| `defineAction` | function | `parse → validate → handle` POST pipeline with auto error fragments. |
| `createHandlerFactory` | function | Returns `definePage`/`defineAction` with `Bindings`/`ConfigData` pre-bound. |
| `HandlerFactory` | type | The pre-bound pair returned by `createHandlerFactory`. |
| `healthCheck` | function | Concurrent named checks → JSON `{ ok, checks }` (`200`/`503`). |
| `applyAssets` | function | Registers the static-asset catch-all over the `ASSETS` binding. |
| `serveAssets` | function | The underlying asset-serving `RequestHandler`. |
| `validateEnv` | function | One-shot env validation against a valibot schema (throws). |
| `validateBindings` | function | Middleware-form binding validation (first request / on change). |
| `ConfigKey` | const | Context key holding the resolved per-request app config. |
| `ActionDefinition` | type | The `defineAction` config shape. |
| `AppOptions` | type | The `createApp` options shape. |
| `AssetOptions` | type | The `applyAssets`/`serveAssets` options (`notFoundView`). |
| `AssetsFetcher` | type | Shape of the `ASSETS` binding (`fetch(req)`). |
| `CacheDirective` | type | `{ maxAge; scope? }` for `definePage({ cache })`. |
| `HealthCheckResult` | type | `{ ok; checks }` health response body. |
| `PageDefinition` | type | The `definePage` config shape. |
