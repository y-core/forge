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
- **Two route-handler factories** — `definePage` (loader → view, with caching and error recovery) and `defineAction` (read → bot guards → schema → handle, with automatic `413`/`400`/`422`/`500` error fragments).
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

The router is built lazily on the first request, with a static middleware stack: per-request state injection → header flush → error boundary → path-scoped guards → error boundary → matched route. The inner boundary is why error responses still carry the consumer's security headers — the error response flows back out through the guards that queue them. The outer boundary catches a throw from a guard itself, which would otherwise escape the router and skip the header flush entirely. Config resolution runs inside the same `try` as routing, so an invalid env produces the app's own error page rather than the runtime's.

### `definePage(def)`

Wraps an `action` (mutation) + `loader` (data) + `view` (JSX → `Response`) into a `RequestHandler`, with optional caching, custom headers, and error recovery.

| Field | Type | Description |
|---|---|---|
| `action` | `(c, config, data) => ActionData \| Response \| Promise<...>` | Optional. Runs on every non-`GET` request, before the loader, so the view renders post-mutation state. Its return value reaches the view as `state.actionData`; returning a `Response` short-circuits rendering. Skipped entirely on a `GET`. `data` is the `schema`'s output, and is `undefined` on a page that declares none. |
| `schema` | `S extends v.GenericSchema` | Optional. Routes every non-`GET` request through the same read → guard → validate sequence `defineAction` runs, so `action` is unreachable without a passing `v.safeParse` and receives the output as its third argument. A refused body becomes a `422` fragment (with the configured `cache`/`headers` applied) and `action`, `loader` and `view` never run. Omitting it leaves the page as it was. |
| `loader` | `(c, config) => LoaderData \| Response \| Promise<...>` | Optional. Fetches page data. Returning a `Response` (e.g. a redirect) short-circuits rendering — the response still gets the configured headers/cache applied. |
| `view` | `(c, config, state) => Response \| Promise<Response>` | Required. Builds the page response. `state` is `{ data, actionData, method }`: `state.data` is the loader's return value, `state.actionData` the action's (`undefined` on a `GET`), and `state.method` is `"GET"` or `"POST"`. |
| `cache` | `"no-store" \| CacheDirective` | Optional. Sets `Cache-Control`. `CacheDirective` is `{ maxAge: number; scope?: "public" \| "private" }` (scope defaults to `"public"`). |
| `headers` | `Record<string, string>` | Optional. Extra response headers, merged onto whatever the view returned. |
| `onError` | `(error: Error, c) => Response \| Promise<Response>` | Optional. Called if `action`, `loader`, or `view` throws. If omitted, the error re-throws to the app's error boundary. |

**The submission sequence's options are declared here too.** `honeypot`, `turnstile`, `onBotDetected`, `onValidationError` and `maxBytes` mean on a page exactly what they mean on an action — `PageDefinition` inherits them, so they are documented once, in the `defineAction` table below. `onValidationError` is what lets a self-posting page answer a refused body by re-rendering its own view with the field errors in place, instead of the default `422` fragment.

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

The view receives the resolved `config` (the second argument) and the render `state` (the third). I/O belongs in the `loader` or the `action`, not the `view`.

### `defineAction(def)`

Wires a `read → guard → validate → handle` pipeline into a POST handler that returns structured error fragments automatically.

**The schema is the only way in.** `defineAction` reads the parsed body itself and `handle` is unreachable except through a passing `v.safeParse` of `schema`, so a route cannot accept a body nothing checked. This replaced a `parse`/`validate` pair of arbitrary callbacks, which fixed the *order* the two ran in but never that either involved a schema — `validate: (d) => ok(d)` compiled and was accepted.

**The body-content guards live here; transport guards do not.** The honeypot and Turnstile checks each read a named field out of this form, so they belong where the body is read and where the field they consume can be dropped in the same step. CSRF, origin and rate-limit guards decide from the request's envelope and need to know nothing about the route's fields, so they stay in the controller action's `middleware` array (`defineAction` accepts no `middleware` field).

`defineAction<S, Bindings, ConfigData>` takes three type arguments and infers `S` from `def.schema`. TypeScript has no partial type-argument inference, so a call site naming `Bindings` names the schema too (`defineAction<typeof ContactSchema, Bindings, AppConfig>`); `createHandlerFactory` removes the need for any of them.

| Field | Type | Description |
|---|---|---|
| `schema` | `S extends v.GenericSchema` | The body schema. Prefer `strictObject` from `@y-core/forge/validation` — it is what turns a field nobody declared into a refusal rather than a value silently dropped, and it holds for every key a caller can send. |
| `handle` | `(data: v.InferOutput<S>, c, config) => Response \| Promise<Response>` | Runs after the schema passes. Receives the schema's **output** (so a transform reaches it as the type it actually is), the context, and the resolved `config`. |
| `onValidationError` | `(issues: readonly v.BaseIssue<unknown>[], c) => Response \| Promise<Response>` | Optional. Replaces the default validation fragment. It receives the **issues**, not formatted strings: an issue embeds the rejected value, and under a strict object the caller's own key, so how much of a caller's text travels back in a refusal is the app's decision. |
| `onError` | `(error: Error, c) => Response \| Promise<Response>` | Optional. Overrides the default `500` fragment for anything that throws inside the validate-and-handle region — `handle`, the schema, or `onValidationError`. |
| `honeypot` | `string` | Optional. The field carrying this route's decoy — the same value the view gave `<Honeypot field={…} />`, best held as one app-owned constant referenced by both. Naming it here is what checks the decoy **and** drops it, so the schema never declares a field no human fills. No default and no shorthand: a name forge could supply is a name every bot already knows to skip. |
| `turnstile` | `ActionTurnstileOptions` | Optional. `{ secretKey, tokenField?, verify }`. The pipeline verifies the token and drops the token field, so the schema is never asked to declare it. `tokenField` is fixed at definition time (the field is dropped whether or not verification reaches the network); `secretKey` and `verify` resolve per request. |
| `onBotDetected` | `(rejection: BotRejection, c) => Response \| Promise<Response>` | Optional. Replaces the refusal a tripped guard renders. `BotRejection` is `{ guard: "honeypot" }` or `{ guard: "turnstile"; reason }`, so an app can tell a siteverify outage from an attack. The default says nothing about the guard at all. |
| `maxBytes` | `number` | Optional. Body-size cap for this route's form parse. Defaults to `FORM_MAX_BYTES_DEFAULT` (100 KB). A `csrfProtection` guard on the same route parses the body first, so raising this also means raising the guard's own `maxBytes`. |

**What reaches the schema.** Every entry the caller sent, minus the fields a guard on that request consumed. An **absent field is absent** rather than `""`, which is what keeps `v.optional` reachable and required-ness a presence check. A **repeated key arrives as an array**, so a scalar schema refuses it in its own words and a route that genuinely accepts many says so with `v.array`. A **`File` passes through unchanged**, so an upload schema can see one.

**Nothing is dropped on a guess.** The honeypot and Turnstile fields are dropped because this pipeline checked them; the CSRF field is dropped because `csrfProtection` published the field it took the token from. A route with no CSRF middleware drops nothing for CSRF, so a submitted `_csrf` is an ordinary undeclared field that a strict schema refuses — which names the missing middleware instead of absorbing its absence. See [`.decisions/ROUTING_AND_MIDDLEWARE.md`](../../.decisions/ROUTING_AND_MIDDLEWARE.md) §2b for the rule and the alternatives it rejects.

**Text normalization belongs to the schema, not the pipeline.** Use `formText()` for a single-line control and `formMultilineText()` for a `<textarea>` — both from `@y-core/forge/validation`. The body read passes values through exactly as submitted, so a bare `v.pipe(v.string(), v.minLength(1))` accepts `"   "`.

```ts
import { defineAction } from "@y-core/forge/app";
import { fragmentResponse, renderSuccess } from "@y-core/forge/http";
import { formMultilineText, formText, strictObject, v } from "@y-core/forge/validation";
import { CONTACT_DECOY } from "./forms";

const ContactSchema = strictObject({
  name: v.pipe(formText(), v.minLength(1)),
  email: v.pipe(formText(), v.email()),
  phone: v.optional(formText()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

export const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  honeypot: CONTACT_DECOY,
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
| `400` | Body is unparseable as form data. |
| `422` | The schema refused the body and no `onValidationError` was supplied — a well-formed request the server understood and declined. The fragment carries one `<li>` naming the failing field and nothing else: validation runs `abortEarly`, and each issue is rendered through `describeValidationIssue`, so neither the submitted value nor the schema's own rule travels back, and the response length cannot be steered by what the caller sent. |
| `422` | A bot guard tripped and no `onBotDetected` was supplied. Byte-identical to the refusal above — one `<li>` naming a field the schema declares, never the decoy — so a bot cannot tell a guard from a mistyped field by comparing answers. |
| `500` | Anything in the validate-and-handle region throws, and no `onError` was supplied; the failure is logged. That covers `handle`, a schema whose `v.transform`/`v.check` throws on malformed input (valibot does not catch those), and a throwing `onValidationError`. A throwing schema is a route defect, not a bad request, which is why it is a `500` and not a `400`. |

### `createHandlerFactory<Bindings, ConfigData>()`

Returns `{ definePage, defineAction }` with the app's `Bindings` and `ConfigData` generics pre-bound, so individual route modules stop repeating them. Per-call generics (`LoaderData`, `ActionData`, and the action's schema) remain inferred as usual — and since the schema infers from `def.schema`, a bound `defineAction` needs no type arguments at all. Bind once in an `app/handlers.ts` module and import the bound pair everywhere:

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

The page is Tailwind-classed markup that `forge.css` does not scan, so add
`@source "…/@y-core/forge/src/app";` to your own stylesheet or the page renders unstyled.

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
  body: new URLSearchParams({ _csrf: token, name: "Jane", email: "j@x.io", message: "Hello there" }),
}, MINIMUM_ENV);

expect(res.status).toBe(200);
```

---

## Security

- **Hardened error boundary.** Every throw — inside the middleware chain or in router internals outside it — yields a `500` page with `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'`, and `referrer-policy: no-referrer`. The in-chain path overlays the consumer's CSP via the pending-header pass; out-of-chain throws still get this baseline. Error responses thus carry security headers by construction.
- **Error detail is gated.** The default `500` page reveals the error message **only** when `isDebug(c)` returns `true`; otherwise it shows a generic message. Never wire `isDebug` to a value an attacker controls.
- **Validation failures are generic by default.** `defineAction` collapses body-parse and handler failures to neutral `400`/`500` fragments — supply `onError` only if you control what is surfaced, and do not leak internal exception detail to clients.
- **A refusal names the field and nothing else.** A valibot issue embeds the rejected value, `issue.expected` can be the source text of the schema's own `v.regex`, and under a strict object the caller's own key lands in the issue path. The default refusal reproduces none of it: `abortEarly` bounds the issue count and `describeValidationIssue` bounds the description, so a 50,000-character value and a 5-character one produce the same response and extra fields cannot multiply it. **`onValidationError` opts out of that bound** — it receives the raw issues, so an app rendering more than the field name is choosing to. `formatValidationIssues` reproduces `issue.message` and is an internal diagnostic; never put its output in a response.
- **A tripped bot guard is indistinguishable from a schema refusal.** Same status, same single `<li>`, naming a field the schema declares rather than the decoy — so a bot learns neither which guard it tripped nor that one is there. `onBotDetected` receives the reason for logging or banning without changing what the caller sees.
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
| `defineAction` | function | Schema-validated POST pipeline with auto error fragments. |
| `createHandlerFactory` | function | Returns `definePage`/`defineAction` with `Bindings`/`ConfigData` pre-bound. |
| `HandlerFactory` | type | The pre-bound pair returned by `createHandlerFactory`. |
| `healthCheck` | function | Concurrent named checks → JSON `{ ok, checks }` (`200`/`503`). |
| `applyAssets` | function | Registers the static-asset catch-all over the `ASSETS` binding. |
| `serveAssets` | function | The underlying asset-serving `RequestHandler`. |
| `validateEnv` | function | One-shot env validation against a valibot schema (throws). |
| `validateBindings` | function | Middleware-form binding validation (first request / on change). |
| `ConfigKey` | const | Context key holding the resolved per-request app config. |
| `ActionDefinition` | type | The `defineAction` config shape. |
| `ActionTurnstileOptions` | type | `{ secretKey, tokenField?, verify }` for `turnstile` on either builder. |
| `BotRejection` | type | Why a guard refused — `{ guard: "honeypot" }` or `{ guard: "turnstile"; reason }`. |
| `AppOptions` | type | The `createApp` options shape. |
| `AssetOptions` | type | The `applyAssets`/`serveAssets` options (`notFoundView`). |
| `AssetsFetcher` | type | Shape of the `ASSETS` binding (`fetch(req)`). |
| `CacheDirective` | type | `{ maxAge; scope? }` for `definePage({ cache })`. |
| `HealthCheckResult` | type | `{ ok; checks }` health response body. |
| `PageDefinition` | type | The `definePage` config shape, inheriting the submission sequence's options. |
