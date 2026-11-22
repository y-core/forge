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
import { applyMiddlewareChain, createApp, createHandlerFactory, healthCheck } from "@y-core/forge/app";
```

---

## Getting started

`createApp` returns a `Forge` instance whose `fetch` **is** the Workers module handler, so the whole entry point is one expression and an
`export default`.

```ts
import { applyMiddlewareChain, createApp, type AssetsFetcher } from "@y-core/forge/app";
import { consoleChannel } from "@y-core/forge/logging";
import { NONCE } from "@y-core/forge/security";

import type { KVNamespace } from "@y-core/forge/storage/kv";

import { appConfig } from "./config";
import { EnvSchema } from "./env.schema";
import { registerRoutes } from "./register";

export interface Bindings {
  CSRF_SECRET: string;
  TASKS: KVNamespace;
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

What that expression settles:

- **The wiring hooks run in a fixed order** — `middleware`, `routes`, `finalize`, then `assets` — so the asset catch-all cannot shadow a route,
  whatever order you wrote the fields in. `finalize` is for late registrations that must still precede it, such as a route only a development build
  registers.
- **`Bindings` types `c.env` everywhere downstream**, in middleware, loaders, views and handlers alike.
- **`config` is resolved once per request** and reaches handlers as their `config` argument, and the context as `c.config`. Pass a store built with
  `createConfig` from [`@y-core/forge/config`][config-readme].

Everything is optional: `createApp()` with no arguments is a valid app. Wiring by hand — `createApp()`, then `app.use`, `app.map` and `applyAssets`
in that order — stays supported for a layout the hooks cannot express, and is what the rest of this document shows piecemeal.

---

## Wiring the middleware chain

`applyMiddlewareChain` encodes the global middleware order once, so the choice you are making is **which guards cover which paths**, not what runs
when.

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { consoleChannel } from "@y-core/forge/logging";
import { NONCE } from "@y-core/forge/security";
import { sessionMiddleware } from "@y-core/forge/session";

applyMiddlewareChain<Bindings>(app, {
  requestId: true, // on unless you set it false — the id the 500 page quotes
  trustCfHeaders: true, // behind Cloudflare only: every rateLimit keys by CF-Connecting-IP; a group's throws at registration without it
  logging: { channels: (c) => [consoleChannel()] },
  securityHeaders: { scriptSrc: ["'self'", NONCE] }, // the one required member
  bindings: EnvSchema,
  rateLimits: RATELIMITS, // generated beside EnvSchema by `forge cf gen env`
  session: sessionMiddleware(storage, sessionCookie),
  csrf: { ring: csrfRing, subject: "session" }, // the app's one policy, bound to the session above
  guards: [
    {
      paths: ["/api/*"],
      origin: { allowedOrigins: (c) => [c.env.SITE_ORIGIN] },
      rateLimit: { binding: "RATE_LIMITER" },
    },
  ],
});
```

**A group's `rateLimit` names a binding declared in two places**: in `bindings`, required or optional, or in a contribution's binding
specs, and as a key of `rateLimits`. Pass an array to stack limits, which run in order, and `methods` to count only some methods. What
throws at registration and how a limit refuses are the guard policy table's ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e).

**`session` takes only the `SessionMiddleware` that `createAnonymousSession` or `sessionMiddleware` returns**, and a request it leaves without a
session throws. `subject: "session"` binds every CSRF token to that session's id, and a chain given it with no session slot throws at
registration ([`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h).

The encoded chain, the guard-major grouping that keeps one rate limiter per group, and the global-before-route-level rule are
[`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e's and [§3a][ram-3a]'s; why the nonce provider must lead is [§3d][ram-3d]'s.

**`app.use` is the direct form**, for middleware the chain has no field for. `"*"` matches every request, `"/admin/*"` matches `/admin` and
everything beneath it, and an array of paths registers each handler **once**, matching any of them.

```ts
import { requestId } from "@y-core/forge/security";

app.use("*", requestId());
app.use(["/admin/*", "/internal/*"], adminOnly);
```

Those two are the only wildcard forms, and `use` throws at registration on any other — `"/admin*"` included.

**`exclude` carves a subtree out of a guard group, or out of one global**, so the middleware does not test the path itself:

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";

applyMiddlewareChain(app, {
  securityHeaders: {},
  globals: [{ middleware: navIdentity, exclude: ["/api/*"] }],
  guards: [{ paths: ["/admin/*"], exclude: ["/admin/health"], guards: [adminOnly] }],
});
```

Which groups verify the CSRF token, and in what order, is the guard policy table's ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e).

**`onRefuse` answers every guard's refusal in one place.** Declared on the chain, it receives the request and a `Refusal` narrowed by `guard` —
`csrf`, `origin`, `rate-limit` or `admin` — with its `status` and, for the operator, a `reason`. A group's own `onRefuse` answers that group's
origin check, rate limit and CSRF verify instead. Which hook answers where none is declared is the same table's.

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { htmlResponse, jsonResponse } from "@y-core/forge/http";

applyMiddlewareChain(app, {
  securityHeaders: {},
  csrf: { ring: csrfRing, subject: false },
  onRefuse: (_c, refusal) => htmlResponse(refusedPage(refusal.status), refusal.status),
  guards: [
    {
      paths: ["/api/*"],
      origin: { allowedOrigins: ["https://example.com"] },
      onRefuse: (_c, refusal) => jsonResponse({ status: refusal.status }, refusal.status),
    },
  ],
});
```

The hook picks the representation, never the outcome: it has no `next`, and it never writes `refusal.reason` into the response
([`FORGE_ERRORS.md`][eh-3e] §3e).

**forge ships one hook per medium.** `refuseAsProblem()` answers RFC 9457 `application/problem+json` — `type` `about:blank`, the status
phrase as `title`, and the `status` — for a JSON client. `refuseAsFragment({ target, swap, render })` answers the panel `render` returns,
wrapped in an element carrying `ANNOUNCE_FAILURE_ATTR` with its `message`, so the announcer speaks it; under htmx it sets `HX-Retarget` to
`target` and `HX-Reswap` to `swap` (default `innerHTML`), since the request's own target is the form it submitted. The panel needs no live
region of its own. A hook may branch on `isHxRequest` to pick between a fragment and a page, never to decide whether to refuse:

```tsx
import { applyMiddlewareChain, refuseAsFragment, refuseAsProblem, type RefusalPanel } from "@y-core/forge/app";
import type { Refusal } from "@y-core/forge/context";
import { htmlResponse } from "@y-core/forge/http";
import { isHxRequest } from "@y-core/forge/render/htmx";

const panelFor = (refusal: Refusal): RefusalPanel => {
  const message = refusal.status === 429 ? "Too many attempts. Wait a minute and try again." : "That did not go through. Reload and try again.";
  return { message, panel: <p>{message}</p> };
};
const asFragment = refuseAsFragment({ target: "#form-status", render: (_c, refusal) => panelFor(refusal) });

applyMiddlewareChain(app, {
  securityHeaders: {},
  onRefuse: (c, refusal) => (isHxRequest(c) ? asFragment(c, refusal) : htmlResponse(refusedPage(refusal.status), refusal.status)),
  guards: [{ paths: ["/api/*"], origin: { allowedOrigins: ["https://example.com"] }, onRefuse: refuseAsProblem() }],
});
```

An HTML `4xx` swaps under forge's client runtime; an app without it configures htmx's `responseHandling` to swap one. Neither helper writes the
reason to the client.

**`contributions` lets each feature slice bring its own part of the chain** without the entry point importing what is inside it. Each
`MiddlewareContribution` may carry `bindings`, a `session`, `globals` and `guards`; each lands in the slot of the same name, after the
options' own entries, in array order. It may also carry `sessionMaxAgeAtLeastMs`, the shortest session cookie it serves under, and
`csrfCovers`, a sample URL for each route it mints a CSRF token on. A `MiddlewareGuardGroup` may carry `csrfCovers` too, so the covers stay
with a group spread into another contribution.

```ts
import { applyMiddlewareChain, type MiddlewareContribution } from "@y-core/forge/app";
import { sessionMiddleware } from "@y-core/forge/session";

const databaseMiddleware: MiddlewareContribution<Bindings> = { bindings: [d1BindingSpec("DB")] };
const authMiddleware: MiddlewareContribution<Bindings> = {
  session: sessionMiddleware(storage, sessionCookie),
};

applyMiddlewareChain(app, {
  securityHeaders: {},
  csrf: { ring: csrfRing, subject: "session" }, // the app's policy, written at the root
  contributions: [databaseMiddleware, authMiddleware],
});
```

**Write the CSRF policy at the root.** The app root owns it ([`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h); a contribution has no `csrf`, and one
that carries it anyway throws at registration. A slice contributes its bindings as `BindingSpec`s, as `databaseMiddleware` does; the options'
own `bindings`, shown in the chain above, is one schema for an app that has no slices.

**A session cookie shorter than a contribution needs throws at registration.** The chain compares the largest `sessionMaxAgeAtLeastMs` with
the session slot's `maxAge`, and names both where the cookie is shorter or sets none. `createAuthGuards` contributes the auth session's absolute
lifetime this way ([`ROUTING_AND_MIDDLEWARE.md`][ram-3h] §3h).

**A CSRF policy that leaves a contribution's or a guard group's `csrfCovers` uncovered throws at registration**: no `csrf` at all, `paths`
that miss a URL, or an `exclude` entry that matches one, named with the URL and the contribution or group listing it. Every group
`createAuthGuards` returns carries every auth route this way, and `defineApproval`'s contribution the approval prompt.

The chain takes one session, so a second throws at registration, the options' own included. A binding name contributed
twice throws too. That check cannot see inside `bindings`, which is an opaque schema, so a binding named in both is validated by both. A throw
registers nothing.

---

## Registering routes

Routes are data: a map of names to `{ method, pattern }`, a controller binding those names to handlers, and one `app.map` call. The route map holds
no handlers — why, and what registration order against `app.use` means, are [`ROUTING_AND_MIDDLEWARE.md`][ram-1a] §1a's and [§1c][ram-1c]'s.

```ts
// routes.ts
import { route } from "@y-core/forge/router";

export const routes = route({
  task: { method: "GET", pattern: "/tasks/:id" },
  addNote: { method: "POST", pattern: "/tasks/:id/notes" },
  contact: { method: "POST", pattern: "/api/contact" },
  health: { method: "GET", pattern: "/api/health" },
});

// register.ts
import type { Forge } from "@y-core/forge/app";
import { healthCheck } from "@y-core/forge/app";
import { createController } from "@y-core/forge/router";

import { addNote, contactAction, requireTaskMember, taskPage } from "./controllers";

export function registerRoutes(app: Forge<Bindings>): void {
  const controller = createController(routes, {
    actions: {
      task: taskPage, // a bare handler
      addNote: { middleware: [requireTaskMember], handler: addNote }, // a check that reads c.params, so it needs the route matched
      contact: contactAction,
      health: healthCheck<Bindings>({ kv: (c) => Boolean(c.env.MY_KV) }),
    },
  });

  app.map(routes, controller);
}
```

The `actions` keys must match the route names exactly, so a missing or misspelled handler is a compile error, and so is a page mapped to a route
whose params differ from the one it was built for. Per-route middleware goes in the controller entry and nowhere else — neither `definePage` nor
`defineAction` accepts a `middleware` field ([`ROUTING_AND_MIDDLEWARE.md`][ram-1b] §1b). It holds only the checks that need the route matched; a
content-type check, an origin check or an address-keyed rate limit goes on a guard group covering the route ([§3f][ram-3f]).

**A route pattern has a size ceiling, and `app.map` throws `MatcherResourceError` at registration when one exceeds it** — the same ceiling applies
to an `app.use` path. Nothing a hand-written pattern reaches; a generated one can, and it fails at startup rather than on a request
([`ROUTING_AND_MIDDLEWARE.md`][ram-1f] §1f).

---

## Rendering a page

`definePage` turns a loader and a view into a route handler. The loader does the I/O; the view turns state into a `Response`, typically via
`renderPage` from [`@y-core/forge/render/jsx`][jsx-readme]. Keeping I/O out of the view is [`ROUTING_AND_MIDDLEWARE.md`][ram-5c] §5c's rule.

Take `definePage` and `defineAction` from one module that binds the app's `Bindings` and config type once:

```ts
// handlers.ts
import { createHandlerFactory } from "@y-core/forge/app";

export const { definePage, defineAction } = createHandlerFactory<Bindings, AppConfig>();
```

Then each page names its route first and states no type arguments — the params, the loader's data, the action's data and the schema are all
inferred:

```tsx
// controllers/task.tsx
import { renderPage } from "@y-core/forge/render/jsx";

import { definePage } from "../handlers";
import { routes } from "../routes";

export const taskPage = definePage(routes.task, {
  cache: { maxAge: 60 },
  loader: async (c, config) => ({ task: await c.env.TASKS.get(c.params.id), site: config.site.name }),
  view: (_c, _config, state) => renderPage(<Task task={state.data.task} site={state.data.site} />),
  onError: (err, c) => renderErrorPage(err, c),
});
```

**`c.params` is typed from the route.** `c.params.id` is a `string` because `/tasks/:id` always captures it; a param inside an optional segment is
`string | undefined`, and reading a name the pattern does not capture is a compile error. A helper the loader hands `c` to types it with
`RouteParams` from [`@y-core/forge/router`][router-readme].

**A `query` schema validates the query string before the loader runs**, on every method, and the loader receives its output as a third argument:

```tsx
export const tasksPage = definePage(routes.tasks, {
  query: v.object({ page: v.pipe(v.string(), v.digits(), v.transform(Number)) }),
  loader: async (c, _config, query) => ({ tasks: await listTasks(c.env.TASKS, query.page) }),
  view: (_c, _config, state) => renderPage(<TaskList tasks={state.data.tasks} />),
});
```

A refused query answers `400` naming the field, and neither the loader nor the view runs. `onQueryError` receives the issues and renders your own
refusal instead ([`ROUTING_AND_MIDDLEWARE.md`][ram-2d] §2d).

Either the loader or the view may return a `Response` to short-circuit — a redirect from a loader is the common case — and the configured headers
still apply to it.

**`cache` and `headers` answer different questions.** `cache` is the page's _default_ policy, set only on a response that states none of its own, so
a redirect or a `no-store` refusal keeps what it said. `headers` is applied last and overrides everything, including `cache` — except
that a `public` on a response carrying a `Set-Cookie` is rewritten to `private`.

**`scope` defaults to `"private"`** — the browser may store the page, a shared cache may not. Write `scope: "public"` when the page is the same for
every reader and you want an edge or proxy to serve it. The full lifecycle, including what a `schema` on a page changes, is
[`ROUTING_AND_MIDDLEWARE.md`][ram-2a] §2a's.

A page that also accepts a submission declares a `schema` and an `action`; the options that come with it are the next section's, and they mean the
same thing on a page as on an action.

---

## Handling a form submission

`defineAction` answers with a fragment; `definePage` with a whole page. That is the whole basis for choosing between them — both run the identical
read → guard → validate sequence first ([`ROUTING_AND_MIDDLEWARE.md`][ram-2d] §2d).

```ts
// controllers/contact.ts
import { fragmentResponse } from "@y-core/forge/http";
import { renderSuccess } from "@y-core/forge/render/htmx";
import { formMultilineText, formText, v } from "@y-core/forge/validation";

import { defineAction } from "../handlers";
import { routes } from "../routes";

const ContactSchema = v.strictObject({
  name: v.pipe(formText(), v.minLength(1)),
  email: v.pipe(formText(), v.email()),
  message: v.pipe(formMultilineText(), v.minLength(10)),
});

export const contactAction = defineAction(routes.contact, {
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

**Bot guards that read the body go here; transport guards do not.** `turnstile` names a field of _this_ form, and the pipeline drops that field
before the schema sees it — no schema declares it. CSRF, origin and address-keyed rate-limit guards decide from the request envelope and belong
in the chain or the controller's `middleware` array ([`ROUTING_AND_MIDDLEWARE.md`][ram-2b] §2b).

`turnstile: {}` reads the secret from `TURNSTILE_SECRET_KEY`, pins the request's own hostname and forwards `CF-Connecting-IP`; `secretKey` and
`verify` override those defaults, `verify` merged over them:

```ts
defineAction(routes.contact, {
  schema: ContactSchema,
  turnstile: { verify: () => ({ expectedHostname: "example.com" }) },
  handle: async (data) => sendContact(data),
});
```

**`rateLimit` limits a submission by who sent it or what it targets.** It runs first in the guard step: after the chain's CSRF verify and the
route's own identity check, ahead of Turnstile and the schema, with `c.params` resolved. It takes the options `rateLimit` from
[`@y-core/forge/security`][security-readme] takes, or an array of them, spent in order until one refuses, and refuses as every rate limit
does ([`ROUTING_AND_MIDDLEWARE.md`][ram-3e] §3e). A limit keyed by address belongs on a guard group, ahead of CSRF, so a route that needs
both splits them ([`ROUTING_AND_MIDDLEWARE.md`][ram-3f] §3f):

```ts
import { applyMiddlewareChain } from "@y-core/forge/app";
import { createController, route } from "@y-core/forge/router";

import { defineAction } from "../handlers";

const routes = route({ addNote: { method: "POST", pattern: "/notebooks/:nb/notes" } });

applyMiddlewareChain<Bindings>(app, {
  securityHeaders: {},
  trustCfHeaders: true,
  rateLimits: RATELIMITS,
  guards: [{ paths: ["/notebooks/*"], rateLimit: { binding: "ADDRESS_LIMITER" } }],
});

const addNote = defineAction(routes.addNote, {
  schema: NoteSchema,
  rateLimit: { binding: "NOTE_LIMITER", key: (c) => `${memberOf(c).userId}:${c.params.nb}` },
  handle: async (data, c) => saveNote(c.params.nb, data),
});

createController(routes, { actions: { addNote: { middleware: [requireMember], handler: addNote } } });
```

A `GET` page or a route without a `schema` has no guard step, so it mounts `rateLimit` from `@y-core/forge/security` in its `middleware` array.

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

`slot.mount` is an open string, so a shell that branches on it needs a default arm. `app.setShell(shell)` registers
one after construction ([`ROUTING_AND_MIDDLEWARE.md`][ram-6a] §6a).

**When the whole chrome is a stylesheet and a script**, `pageShell` is the shell:

```ts
import { createApp, pageShell } from "@y-core/forge/app";

createApp<Bindings>({ shell: pageShell({ stylesheet: "/assets/app.css", script: "/assets/app.js" }) });
```

**Render your own pages through the same shell** with `renderShell`, naming the slot yourself:

```tsx
view: (c, _config, state) => renderShell(c, <Home data={state.data} />, { mount: "app", page: "home", meta: { title: "Home" } }),
```

Meta is a typed descriptor, not a tag array: `mergeMeta` merges a page over the site base one level deep for `og` and `twitter`, and `metaTags`
renders it. `canonical` and `og.image` must be absolute, `canonical` is not rendered beside `noindex`, `jsonLd` needs the request nonce to
render at all, and every page forge mounts states `robots: "noindex"` — all of it [`ROUTING_AND_MIDDLEWARE.md`][ram-6d] §6d's. A fragment never
reaches the shell ([§6c][ram-6c]).

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

**`notFound` is the single answer to a URL that matches no route** — the router's no-match and every asset miss alike. Omitted, forge answers a
hardened plain-text `404` that does not echo the request path ([`ROUTING_AND_MIDDLEWARE.md`][ram-1e] §1e).

**A method mismatch reaches that same hook by default**, so a `GET` to a `POST`-only route is answered exactly as an unknown URL is. Pass
`methodMismatch: "advertise"` for the RFC answer instead — a hardened `405` with `Allow` naming the route's methods — which is usually what a JSON
API wants and rarely what a page surface does:

```tsx
const app = createApp<Bindings>({ methodMismatch: "advertise" });
```

**A mutation without a valid token never reaches either answer on a path the CSRF policy covers.** The check runs before routing, so under the
default `paths: ["*"]` a tokenless `POST` answers `403` on real and unreal paths alike. Only a token-bearing mutation or a safe-method request
reaches the `methodMismatch` answer, `404` by default or `405` with `Allow` under `"advertise"`.

The trade, the guard line that bounds it, and why an `ANY` asset catch-all overrides it are [`ROUTING_AND_MIDDLEWARE.md`][ram-1e] §1e's.

`serveAssets(app)` is the underlying handler, for registering on a route of your own rather than a catch-all.

---

## Reporting whether the app is healthy

`healthCheck` takes named predicates, runs them concurrently, and answers `{ ok, checks }` as JSON — `200` when all pass, `503` otherwise, always
`no-store`. A predicate that throws or rejects counts as `false`, so a probe needs no error handling of its own. One still pending after
`timeoutMs` — 5 s unless `healthCheck(checks, { timeoutMs })` sets it — counts as `false` too, so a hung binding cannot hang the probe.

```ts
import { healthCheck } from "@y-core/forge/app";

const health = healthCheck<Bindings>({
  kv: (c) => Boolean(c.env.MY_KV),
  r2: async (c) => (await c.env.MY_BUCKET.head("__probe")) !== null,
});
```

It is a bare handler in the controller's `actions` map, with no route middleware ([`ROUTING_AND_MIDDLEWARE.md`][ram-2c] §2c).

**`createHealthChecks` lets each feature slice bring its own checks.** The slice that owns a binding exports its checks as a plain object, and
the app root passes the list of them. The route maps `handler()`, which takes the same options as `healthCheck`. The JSON lists checks in list
order, and a name two slices both use throws when the app root builds it.

```ts
import { createHealthChecks } from "@y-core/forge/app";
import type { AppContext } from "@y-core/forge/context";

// the slice that owns the binding
export const storageChecks = { kv: (c: AppContext<Bindings>) => Boolean(c.env.MY_KV) };

// the app root
const health = createHealthChecks<Bindings>([storageChecks, authChecks]);
// …and in the controller's actions map:
const actions = { /* … */ health: health.handler({ timeoutMs: 2_000 }) };
```

---

## Letting feature slices contribute

`createContributionSlots<AppSlots>(list)` gives an app named, ordered lists that feature slices fill — home-page sections, shell parts, anything a
page assembles from slices it does not import. You declare the slots and what each holds. Each slice exports the slots it fills as a plain
object, and the app root passes the list of them; an item of the wrong type fails `bun check`.

```ts
import { createContributionSlots } from "@y-core/forge/app";
import type { JSXNode } from "@y-core/forge/render/jsx";

interface AppSlots {
  home: HomeSection;
  headerActions: JSXNode;
}

// the contact slice
export const contactSlots = { home: [{ title: "Contact", href: routes.contact.href() }] };

// the app root
export const slots = createContributionSlots<AppSlots>([contactSlots, notebookSlots]);
const sections = slots.contributions("home"); // in the home page
```

`contributions(slot)` returns the slot's items in list order, frozen, and an empty list for a slot nobody filled. The same item object listed
twice throws. Why a slice exports data rather than calling into the app is [`ROUTING_AND_MIDDLEWARE.md`][ram-3g] §3g's. For the navbar, use
`createPrimaryNav` from [`src/ui/README.md`][ui-readme] instead.

---

## Validating bindings before anything reads them

Both forms check a Worker's bindings against a valibot schema and **throw** on failure ([`FORGE_ERRORS.md`][eh-5e] §5e). Choose by where you are
standing:

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
  onError: createErrorPage<Bindings>({ stylesheetHref: () => assets.path("css/main.css"), homeHref: "/" }),
});
```

`createErrorPage` works as `definePage`'s `onError` too, and keeps the default boundary's guarantees: everything interpolated is escaped, and the
thrown message appears **only** under [`forge cf dev`][cf-dev], so you see what broke locally and a deployed Worker never says. It takes no
option for this. A `stylesheetHref` resolver
that throws yields the page without the link rather than no page.

A `Reference: <id>` line appears when the `requestId` middleware ran, matching the `x-request-id` header for a user to quote. Neither page mints an
id, so without that middleware the line is absent.

The page is Tailwind-classed markup that `forge.css` does not scan, so import its `@source` lines with
`@import "@y-core/forge/app/sources.css";` in your own stylesheet, or it renders unstyled ([`FORGE_STRUCTURE.md`][la-3d] §3d).

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

`app.fetch` supplies nothing: it takes all three Workers arguments, and the entry point you export must pass them all on.

```ts
export default { fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx) };
```

`fetch` refuses a missing `ctx` rather than degrading. Outside a Worker, `@y-core/forge/testing` supplies `mockExecutionContext()` and
`collectExecutionContext()`.

---

## Gotchas

**A `HEAD` request never reaches a handler as itself.** The app copy-constructs it into a `GET`, runs the full chain, then strips the body — so
handlers never special-case it, and `router` ships no `head` verb ([`ROUTING_AND_MIDDLEWARE.md`][ram-1d] §1d).

**A submission option without a `schema` throws at registration.** `definePage` refuses `rateLimit`, `turnstile`, `onBotDetected`,
`onValidationError` and `maxBytes` by name rather than ignoring them ([§2d][ram-2d]).

**Raising `maxBytes` on the handler is half the change.** The app's CSRF policy parses the body first, so its cap, which is app-wide, is what a
large submission meets — see [`src/form/README.md`][form-readme].

**An aborted request gets no page and no log record.** The boundary answers `499`.

**No config store means `c.config` is `undefined`**, and handlers receive `undefined` for their `config` argument. Nothing throws.

**The router is built on the first request, not at construction.** Register everything before the app serves anything — which is what the wiring
hooks guarantee. A `use()` after the first request throws rather than being silently dropped; a `map()` after it still takes effect.

---

## See also

- [`docs/ROUTING_AND_MIDDLEWARE.md`][ram] — the route map, the middleware chain, the handler factory and why a handler names its route (§2e), and
  the page shell
- [`docs/FORGE_ERRORS.md`][eh] — the error boundary's three paths (§5b), and why the two builders recover differently (§5d)
- [`docs/INPUT_VALIDATION.md`][iv] — the submission sequence, and what a refusal is allowed to say
- [`src/config/README.md`][config-readme] — the store `createApp({ config })` resolves per request
- [`src/router/README.md`][router-readme] — `route`, `createController`, and route-pattern syntax

[cf-dev]: ../tooling/cf/README.md#running-the-app-locally
[cf-readme]: ../tooling/cf/README.md
[config-readme]: ../config/README.md
[eh]: ../../docs/FORGE_ERRORS.md
[eh-3e]: ../../docs/FORGE_ERRORS.md#3e-one-refusal-contract-for-every-guard
[eh-5b]: ../../docs/FORGE_ERRORS.md#5b-unexpected-errors--the-router-error-boundary
[eh-5e]: ../../docs/FORGE_ERRORS.md#5e-startup-invariants--env-validation-and-binding-resolvers-throw
[form-readme]: ../form/README.md
[iv]: ../../docs/INPUT_VALIDATION.md
[iv-1b]: ../../docs/INPUT_VALIDATION.md#1b-vsafeparse-with-abortearly
[iv-1d]: ../../docs/INPUT_VALIDATION.md#1d-defineaction--the-schema-contract
[iv-4b]: ../../docs/INPUT_VALIDATION.md#4b-guard-refusal-shape-and-its-residual-oracle
[jsx-readme]: ../render/jsx/README.md
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
[ram-3f]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3f-one-csrf-policy-per-app-verified-once
[ram-3g]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3g-a-slice-exports-its-contribution-as-data
[ram-3h]: ../../docs/ROUTING_AND_MIDDLEWARE.md#3h-the-session-is-a-typed-chain-slot
[ram-5c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#5c-view--definepage-render-function
[ram-6]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6-the-page-shell
[ram-6a]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6a-registering-a-shell
[ram-6c]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6c-fragments-never-reach-the-shell
[ram-6d]: ../../docs/ROUTING_AND_MIDDLEWARE.md#6d-the-meta-descriptor
[router-readme]: ../router/README.md
[security-readme]: ../security/README.md
[ui-readme]: ../ui/README.md#compose-the-bar-from-contributions
[validation-readme]: ../validation/README.md
