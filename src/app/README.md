---
title: App Bootstrap and Request Lifecycle
description: "Turns a route table, middleware and handlers into a single Workers fetch export, wrapped in a fail-closed error boundary."
audience: consumer
---

# `@y-core/forge/app`

A Worker's default export has to be one object with a `fetch` method, and everything a request needs — bindings, config, middleware, routing, a
document to render into, and an answer for anything that throws — has to be reachable from inside it. This namespace is that object.

Reach for it when you are writing the entry point, a route handler, or the document every page renders into.

```ts
import { applyMiddlewareChain, createApp, defineAction, definePage, healthCheck } from "@y-core/forge/app";
```

---

## Getting started

`createApp` returns a `Forge` instance whose `fetch` **is** the Workers module handler, so the whole entry point is one expression and an
`export default`.

```ts
import { applyMiddlewareChain, createApp, type AssetsFetcher } from "@y-core/forge/app";
import { consoleChannel } from "@y-core/forge/logging";
import { NONCE } from "@y-core/forge/security";

import { appConfig } from "./config";
import { EnvSchema } from "./env.schema";
import { registerRoutes } from "./routes";

export interface Bindings {
  CSRF_SECRET: string;
  ASSETS: AssetsFetcher;
}

export default createApp<Bindings>({
  config: appConfig,
  middleware: (app) =>
    applyMiddlewareChain(app, {
      logging: { channels: () => [consoleChannel()] },
      securityHeaders: { scriptSrc: ["'self'", NONCE] },
      bindings: EnvSchema,
    }),
  routes: registerRoutes,
  assets: true,
});
```

What that expression settles, and why to prefer it over wiring by hand:

- **The wiring hooks run in a fixed order** — `middleware`, `routes`, `finalize`, then `assets` — so the asset catch-all is registered last and
  cannot shadow a route, whatever order you wrote the fields in. `finalize` is for late registrations that must still precede it, such as a route
  only a development build registers.
- **`Bindings` types `c.env` everywhere downstream**, in middleware, loaders, views and handlers alike.
- **`config` is resolved once per request** and reaches handlers as their `config` argument, and the context as `c.config`. Pass a store built with
  `createConfig` from [`@y-core/forge/config`][config-readme].

Everything is optional: `createApp()` with no arguments is a valid app. Wiring by hand — `createApp()`, then `app.use`, `app.map` and `applyAssets`
in that order — stays supported for a layout the hooks cannot express, and is what the rest of this document shows piecemeal.

---

## Wiring the middleware chain

Global middleware order is load-bearing: a nonce provider that runs after its consumers produces a page with no styles, and a rate limiter that runs
before the logger costs you the record of what it refused. `applyMiddlewareChain` encodes that order once, so the choice you are making is **which
guards cover which paths**, not what runs when.

```ts
applyMiddlewareChain(app, {
  requestId: true, // on unless you set it false — the id the 500 page quotes
  logging: { channels: (c) => [consoleChannel()] },
  securityHeaders: { scriptSrc: ["'self'", NONCE] }, // the one required member
  bindings: EnvSchema,
  session: sessionMiddleware(storage, sessionCookie),
  globals: [csrfGuard], // after the session, because they read it
  guards: [
    {
      paths: ["/api/*"],
      origin: { allowedOrigins: (c) => [c.env.SITE_ORIGIN] },
      rateLimit: { limiter: (c) => c.env.RATE_LIMITER },
    },
  ],
});
```

The encoded chain, the guard-major grouping that keeps one rate limiter per group, and the global-before-route-level rule are
[`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e's and [§3a][ram-3a]'s; why the nonce provider must lead is [§3d][ram-3d]'s.

**`app.use` is the direct form**, for middleware the chain has no field for. `"*"` matches every request, `"/admin/*"` matches `/admin` and
everything beneath it, and an array of paths registers each handler **once**, matching any of them.

```ts
app.use("*", requestId());
app.use(["/admin/*", "/internal/*"], adminOnly);
```

`buildGuardChain(group)` expands one guard group into the ordered array `app.use` takes, for a group you want to register yourself.

---

## Registering routes

Routes are data: a map of names to `{ method, pattern }`, a controller binding those names to handlers, and one `app.map` call. The route map holds
no handlers — why, and what registration order against `app.use` means, are [`ROUTING_AND_MIDDLEWARE.md`][ram-1a] §1a's and [§1c][ram-1c]'s.

```ts
import type { Forge } from "@y-core/forge/app";
import { healthCheck } from "@y-core/forge/app";
import { createController, route } from "@y-core/forge/router";

import { contactAction, homePage } from "./controllers";
import { csrfGuard } from "./guards";

export const routes = route({
  home: { method: "GET", pattern: "/" },
  contact: { method: "POST", pattern: "/api/contact" },
  health: { method: "GET", pattern: "/api/health" },
});

export function registerRoutes(app: Forge<Bindings>): void {
  const controller = createController(routes, {
    actions: {
      home: homePage, // a bare handler
      contact: { middleware: [csrfGuard], handler: contactAction }, // route middleware lives here
      health: healthCheck<Bindings>({ kv: (c) => Boolean(c.env.MY_KV) }),
    },
  });

  app.map(routes, controller);
}
```

The `actions` keys must match the route names exactly, so a missing or misspelled handler is a compile error. Per-route middleware goes in the
controller entry and nowhere else — neither `definePage` nor `defineAction` accepts a `middleware` field ([`ROUTING_AND_MIDDLEWARE.md`][ram-1b]
§1b).

**A route pattern has a size ceiling, and `app.map` throws `MatcherResourceError` at registration when one exceeds it** — the same ceiling applies
to an `app.use` path. Nothing a hand-written pattern reaches; a generated one can, and it fails at startup rather than on a request
([`ROUTING_AND_MIDDLEWARE.md`][ram-1f] §1f).

---

## Rendering a page

`definePage` turns a loader and a view into a route handler. The loader does the I/O; the view turns state into a `Response`, typically via
`renderPage` from [`@y-core/forge/jsx`][jsx-readme]. Keeping I/O out of the view is [`ROUTING_AND_MIDDLEWARE.md`][ram-5c] §5c's rule.

```tsx
import { definePage } from "@y-core/forge/app";
import { renderPage } from "@y-core/forge/jsx";

export const homePage = definePage<Bindings, AppConfig>({
  cache: { maxAge: 300, scope: "public" },
  loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
  view: (_c, _config, state) => renderPage(<Home greeting={state.data.greeting} />),
  onError: (err, c) => renderErrorPage(err, c),
});
```

Either the loader or the view may return a `Response` to short-circuit — a redirect from a loader is the common case — and the configured headers
still apply to it.

**`cache` and `headers` answer different questions.** `cache` is the page's _default_ policy, set only on a response that states none of its own, so
a redirect or a `no-store` refusal keeps what it said. `headers` is applied last and overrides everything, including `cache`. The full lifecycle,
including what a `schema` on a page changes, is [`ROUTING_AND_MIDDLEWARE.md`][ram-2a] §2a's.

A page that also accepts a submission declares a `schema` and an `action`; the options that come with it are the next section's, and they mean the
same thing on a page as on an action.

---

## Handling a form submission

`defineAction` answers with a fragment; `definePage` with a whole page. That is the whole basis for choosing between them — both run the identical
read → guard → validate sequence first, and neither has a path to its own terminal step that goes around it
([`ROUTING_AND_MIDDLEWARE.md`][ram-2d] §2d).

```ts
import { defineAction } from "@y-core/forge/app";
import { fragmentResponse, renderSuccess } from "@y-core/forge/http";
import { formMultilineText, formText, v } from "@y-core/forge/validation";

const ContactSchema = v.strictObject({
  name: v.pipe(formText(), v.minLength(1)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

export const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  handle: async (data, c, config) => {
    await sendEmail(config.email, data);
    return fragmentResponse(renderSuccess("Thanks — we'll be in touch."));
  },
});
```

`handle` receives the schema's **output**, so a transform reaches it as the type it actually is. Reach for `v.strictObject` and the `formText`
family from [`@y-core/forge/validation`][validation-readme]: the body read passes values through exactly as submitted, so a bare
`v.pipe(v.string(), v.minLength(1))` accepts `" "`. The schema contract itself is [`INPUT_VALIDATION.md`][iv-1d] §1d's.

**The refusals are already written.** An oversized body, an unparseable one, a body the schema refused, and a throw all answer with a fragment
without you supplying anything. Optional hooks replace them one for one, and each is a decision about what a caller learns:

- `onValidationError` receives the **issues**, not formatted strings — an issue embeds the rejected value and, under a strict object, the caller's
  own key, so rendering more than the field name is a choice ([`INPUT_VALIDATION.md`][iv-1b] §1b).
- `onBotDetected` receives `{ guard, reason }`, so a siteverify outage can be told from an attack in your logs while the caller still sees what a
  mistyped field sees ([`INPUT_VALIDATION.md`][iv-4b] §4b).
- `onError` replaces the `500` fragment for anything that throws inside the sequence or in `handle`.

**Bot guards that read the body go here; transport guards do not.** `turnstile` names a field of _this_ form, so the pipeline verifies it and drops
the field before the schema sees it — no schema declares it. CSRF, origin and rate-limit guards decide from the request envelope and belong in the
controller's `middleware` array. What is dropped is derived from what a guard actually consumed, never declared
([`ROUTING_AND_MIDDLEWARE.md`][ram-2b] §2b).

```ts
turnstile: {
  secretKey: (c, config) => config.turnstile.secretKey,
  verify: (c) => ({ remoteIp: c.request.headers.get("cf-connecting-ip") ?? undefined, expectedHostname: "example.com" }),
},
```

---

## Declaring the generics once

TypeScript has no partial type-argument inference, so naming `Bindings` at a call site means naming the schema too. `createHandlerFactory` binds
both app-wide generics once and hands back the pair, after which a route module names nothing.

```ts
// app/handlers.ts
import { createHandlerFactory } from "@y-core/forge/app";

export const { definePage, defineAction } = createHandlerFactory<Bindings, AppConfig>();
```

```tsx
// controllers/home.tsx — no type arguments anywhere
import { definePage } from "../app/handlers";

export const homePage = definePage({
  loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
  view: (_c, _config, state) => renderPage(<Home greeting={state.data.greeting} />),
});
```

Per-call generics — loader data, action data, and the action's schema — are still inferred. The standalone `definePage` and `defineAction` are
unchanged; the factory is sugar.

---

## Wrapping pages in a document shell

One shell, registered on the app, is the document every mounted page renders into — forge's own auth pages and log viewer included. A mountable
takes no chrome options of its own, and the reasoning is [`ROUTING_AND_MIDDLEWARE.md`][ram-6] §6's.

```tsx
import { mergeMeta, metaTags } from "@y-core/forge/app";
import { getNonce } from "@y-core/forge/security";

const SITE_META = { title: "Acme", description: "…", og: { type: "website", image: "https://cdn.acme.com/og.png" } } as const;

createApp<Bindings>({
  shell: (c, content, slot) => (
    <html lang='en'>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        {metaTags(mergeMeta(SITE_META, slot.meta), { nonce: getNonce(c) })}
        <link rel='stylesheet' href={assets.path("css/main.css")} />
      </head>
      <body>{content}</body>
    </html>
  ),
});
```

Your app's per-request context and layout stay inside that closure, which is why no context type parameter reaches forge. `slot` is
`{ mount, page, meta }`; `mount` is an open string, so a shell that branches on it needs a default arm. `app.setShell(shell)` registers one after
construction and is the single writer of the slot ([`ROUTING_AND_MIDDLEWARE.md`][ram-6a] §6a).

**When the whole chrome is a stylesheet and a script**, `pageShell` is the shell:

```ts
import { pageShell } from "@y-core/forge/app";

createApp<Bindings>({ shell: pageShell({ stylesheet: "/assets/app.css", script: "/assets/app.js" }) });
```

**Render your own pages through the same shell** with `renderShell`, naming the slot yourself:

```tsx
view: (c, _config, state) => renderShell(c, <Home data={state.data} />, { mount: "app", page: "home", meta: { title: "Home" } }),
```

Meta is a typed descriptor, not a tag array: `mergeMeta` merges a page over the site base one level deep for `og` and `twitter`, and `metaTags`
renders it. `canonical` and `og.image` must be absolute, `jsonLd` needs the request nonce to render at all, and every page forge mounts states
`robots: "noindex"` — all of it [`ROUTING_AND_MIDDLEWARE.md`][ram-6d] §6d's. A fragment never reaches the shell ([§6c][ram-6c]).

---

## Serving static files and answering an unmatched URL

`assets: true` on `createApp` registers the catch-all over the `ASSETS` binding as the last route. Registering it by hand is the same thing, and the
same rule applies — **after every `app.map` call**, or it shadows them.

```tsx
import { applyAssets, createApp } from "@y-core/forge/app";

const app = createApp<Bindings>({ notFound: (c, config) => renderPage(<NotFound site={config.site} />) });
app.map(routes, controller);
applyAssets(app); // or applyAssets(app, "/static/*") for a narrower pattern
```

**`notFound` is the single answer to a URL that matches no route** — the router's no-match and every asset miss alike, so configuring assets changes
which path reaches it and never what a client gets. Omitted, forge answers a hardened plain-text `404` that does not echo the request path
([`ROUTING_AND_MIDDLEWARE.md`][ram-1e] §1e).

**A method mismatch reaches that same hook by default**, so a `POST` to a `GET`-only page is answered exactly as an unknown URL is, and a caller
cannot tell the two apart. Pass `methodMismatch: "advertise"` for the RFC answer instead — a hardened `405` with `Allow: GET, HEAD` and a body that
does not echo the method — which is usually what a JSON API wants and rarely what a page surface does:

```tsx
const app = createApp<Bindings>({ methodMismatch: "advertise" });
```

The trade, the guard line that bounds it, and why an `ANY` asset catch-all overrides it are [`ROUTING_AND_MIDDLEWARE.md`][ram-1e] §1e's.

`serveAssets(app)` is the underlying handler, for registering on a route of your own rather than a catch-all.

---

## Reporting whether the app is healthy

`healthCheck` takes named predicates, runs them concurrently, and answers `{ ok, checks }` as JSON — `200` when all pass, `503` otherwise, always
`no-store`. A predicate that throws or rejects counts as `false`, so a probe needs no error handling of its own.

```ts
health: healthCheck<Bindings>({
  kv: (c) => Boolean(c.env.MY_KV),
  r2: async (c) => (await c.env.MY_BUCKET.head("__probe")) !== null,
}),
```

It is a bare handler in the controller's `actions` map, with no route middleware ([`ROUTING_AND_MIDDLEWARE.md`][ram-2c] §2c).

---

## Validating bindings before anything reads them

Both forms check a Worker's bindings against a valibot schema and **throw** on failure, because a malformed environment is a deployment error rather
than a runtime condition ([`FORGE_ERRORS.md`][eh-5e] §5e). Choose by where you are standing:

- `validateBindings(schema)` — middleware. Validates `c.env` on the first request and again whenever the env reference changes. Pass it as
  `applyMiddlewareChain`'s `bindings` field, or register it with `app.use("*", …)`.
- `validateEnv(env, schema)` — one-shot, returning the typed env. Use it where you already hold the raw env, outside a request.

```ts
import { validateEnv } from "@y-core/forge/app";

const env = validateEnv(rawEnv, EnvSchema); // or throws `Invalid environment: <field>: <reason>; …`
```

**Generate the schema rather than writing it.** `forge cf gen env` emits `env.schema.ts` from `wrangler.jsonc` plus `.dev.vars`, so it cannot drift
from the real binding surface — see [`src/tooling/cf/README.md`][cf-readme], and [`src/config/README.md`][config-readme] for how the generated layer
sits under your app config. Hand-writing one stays fine for a small surface.

---

## Replacing the 500 page

Every throw already produces a hardened `500` carrying security headers, whether it happened inside the middleware chain or outside it
([`FORGE_ERRORS.md`][eh-5b] §5b). Replace the page when you want it to look like your app:

```ts
import { createApp, createErrorPage } from "@y-core/forge/app";

export default createApp<Bindings>({
  config: appConfig,
  dev, // minted in src/worker.dev.ts
  onError: createErrorPage<Bindings>({ dev, stylesheetHref: "/assets/css/main.css", homeHref: "/" }),
});
```

`createErrorPage` works as `definePage`'s `onError` too, and keeps the default boundary's guarantees: everything interpolated is escaped, and the
thrown message appears **only** under a `DevAllowance` granting `errorDetail`, which only a development entry can mint
([`@y-core/forge/dev`][dev-readme]). Passing `dev` to `createApp` does the same for the default page. A `stylesheetHref` resolver that throws yields
the page without the link rather than no page.

A `Reference: <id>` line appears when the `requestId` middleware ran, matching the `x-request-id` header for a user to quote. Neither page mints an
id, so without that middleware the line is absent.

The page is Tailwind-classed markup that `forge.css` does not scan, so add `@source "…/@y-core/forge/src/app";` to your own stylesheet or it renders
unstyled — the scanning boundary that makes this a README's business is [`FORGE_STRUCTURE.md`][la-3d] §3d.

---

## Testing a request through the whole chain

`app.request(path, init?, env?)` builds a `Request`, dispatches it through every middleware, and **awaits any `waitUntil` work** before resolving —
so fire-and-forget work has finished by the time you assert.

```ts
const res = await app.request(
  "/api/contact",
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: token, name: "Jane", email: "j@x.io", message: "Hello there" }),
  },
  MINIMUM_ENV,
);

expect(res.status).toBe(200);
```

A bare path is resolved against `http://localhost`; a full URL is used as given. `env` defaults to `{}`, and `executionCtx` is supplied for you.

---

## Gotchas

**`renderPage` is not in this namespace.** It comes from `@y-core/forge/jsx`, and a view calls it to turn a JSX tree into a `Response`.

**A `HEAD` request never reaches a handler as itself.** The app copy-constructs it into a `GET`, runs the full chain, then strips the body — so
handlers never special-case it, and `router` ships no `head` verb ([`ROUTING_AND_MIDDLEWARE.md`][ram-1d] §1d).

**A submission option without a `schema` throws at registration.** `turnstile`, `onBotDetected`, `onValidationError` and `maxBytes` configure a
pipeline that a schema-less page does not have, so `definePage` refuses them by name rather than ignoring them ([§2d][ram-2d]).

**Raising `maxBytes` on the handler is half the change.** A `csrfProtection` guard on the same route parses the body first, so its own cap is what a
large submission meets — see [`src/form/README.md`][form-readme].

**An aborted request gets no page and no log record.** A disconnected client is cancellation, not a failure: the boundary answers `499` and both
builders re-throw to it.

**No config store means `c.config` is `undefined`**, and handlers receive `undefined` for their `config` argument. Nothing throws.

**The router is built on the first request, not at construction.** Register everything before the app serves anything — which is what the wiring
hooks guarantee.

---

## See also

- [`docs/ROUTING_AND_MIDDLEWARE.md`][ram] — the route map, the middleware chain, the handler factories, and the page shell
- [`docs/FORGE_ERRORS.md`][eh] — the error boundary's three paths (§5b), and why the two builders recover differently (§5d)
- [`docs/INPUT_VALIDATION.md`][iv] — the submission sequence, and what a refusal is allowed to say
- [`src/config/README.md`][config-readme] — the store `createApp({ config })` resolves per request
- [`src/router/README.md`][router-readme] — `route`, `createController`, and route-pattern syntax
- [`src/dev/README.md`][dev-readme] — minting the `DevAllowance` that unlocks error detail

[cf-readme]: ../tooling/cf/README.md
[config-readme]: ../config/README.md
[dev-readme]: ../dev/README.md
[eh]: ../../docs/FORGE_ERRORS.md
[eh-5b]: ../../docs/FORGE_ERRORS.md#5b-unexpected-errors--the-router-error-boundary
[eh-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[form-readme]: ../form/README.md
[iv]: ../../docs/INPUT_VALIDATION.md
[iv-1b]: ../../docs/INPUT_VALIDATION.md#1b-vsafeparse-with-abortearly
[iv-1d]: ../../docs/INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[iv-4b]: ../../docs/INPUT_VALIDATION.md#4b-guard-refusal-shape-and-its-residual-oracle
[jsx-readme]: ../jsx/README.md
[la-3d]: ../../docs/FORGE_STRUCTURE.md#3d-css-source-scanning-stops-at-ui
[ram]: ../../docs/ROUTING_AND_MIDDLEWARE.md
[ram-1a]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1a-declarative-route-map-pattern
[ram-1b]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1b-controller--mapping-route-names-to-actions
[ram-1c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1c-registering-routes-with-appmap
[ram-1d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1d-no-head-verb-export
[ram-1e]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1e-the-unmatched-url
[ram-1f]: ../../docs/ROUTING_AND_MIDDLEWARE.md#1f-matcher-resource-budgets
[ram-2a]: ../../docs/ROUTING_AND_MIDDLEWARE.md#2a-full-page-routes-with-definepage
[ram-2b]: ../../docs/ROUTING_AND_MIDDLEWARE.md#2b-action-only-routes-with-defineaction
[ram-2c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#2c-health-check-route-with-healthcheck
[ram-2d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#2d-the-shared-submission-pipeline
[ram-3a]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3a-global-vs-route-level-middleware
[ram-3d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3d-security-middleware-placement
[ram-3e]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3e-applymiddlewarechain-canonical-chain-builder
[ram-5c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#5c-view--definepage-render-function
[ram-6]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[ram-6a]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6a-registering-a-shell
[ram-6c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6c-fragments-never-reach-the-shell
[ram-6d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6d-the-meta-descriptor
[router-readme]: ../router/README.md
[validation-readme]: ../validation/README.md
