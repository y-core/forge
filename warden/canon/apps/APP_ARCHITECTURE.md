---
title: Application Architecture
description: "The composition-root factory, the layer stack and its dependency rules, dependency injection through config, concern-first placement, and the feature sequence."
---

# Application Architecture

> Owns how an application is assembled: the single composition root, the layers it wires, the
> rules governing which layer may import which, how dependencies reach a handler, and the order
> in which a feature is built.
>
> Defers to: [`FORGE_CONSUMPTION.md`](./FORGE_CONSUMPTION.md) for what to take from the shared
> library before writing app code; [`WORKERS_PLATFORM.md`](./WORKERS_PLATFORM.md) for the
> runtime constraints the composition root operates under;
> [`BOUNDARIES.md`](./BOUNDARIES.md) for middleware ordering and guard placement.

---

## 0. Quick Reference

- §1 The Composition Root: one factory, one place the application is assembled
- §1a The Worker Factory: what it takes as a parameter and why
- §1b Composition Order: the fixed sequence inside the factory
- §1c The Dev and Production Entry Split: making an environment difference structural
- §2 The Layer Stack: what layers exist and what each owns
- §2a Layer Roster: the canonical directory per layer
- §2b Layer Dependency Rules: which layer may import which
- §2c No Layer Skipping: the handler-to-service boundary
- §2d Views Are Pure: no services, no business rules
- §3 Dependency Injection Through Config: never a global, never a raw binding read
- §3a Typed Config Access: one accessor, validated once
- §3b Environment and Context Type Parameters: threading bindings through the app
- §3c Per-Request Presentation State: what a view is handed
- §4 Concern-First Placement: deciding where a new unit belongs
- §4a The Resolution Order: concern, then latency, then jank
- §4b When Two Layers Fit: pick the one further from the request path
- §4c What a Layer Must Never Accumulate: the drift each layer is prone to
- §5 Feature Development Sequence: the fixed order for adding a feature
- §5a The Ordered Steps: model through tests
- §5b Handler Structure: parse, validate, act, respond

---

## 1. The Composition Root

### 1a. The Worker Factory

**The application is assembled in exactly one function, and that function is exported as a
factory rather than as a built app.** Every difference between deployments is an argument to it.

```ts
export function createWorker(security: SecurityHeadersOptions) {
  const app = createApp<AppEnv>({ config: configStore, isDebug: (c) => configStore.get(c.env).site.debug });
  registerMiddleware(app, security);
  app.map(routes, controller);
  applyAssets(app, { notFoundView: notFoundController });
  return app;
}
export default createWorker(securityHeaders); // the production app
```

**The parameter list is the honest statement of what varies between environments.** A factory
that takes nothing, and reads an environment flag internally to decide policy, has moved the
difference somewhere no reader can see it.

### 1b. Composition Order

The steps inside the factory execute in a fixed order, and the order is load-bearing:

1. **Create the app** — with config integration and the debug predicate.
2. **Register middleware** — security headers, request identity, logging, CORS.
3. **Map routes to controllers** — the declarative route map bound to its controller.
4. **Apply static assets** — including the not-found handler.

**Middleware precedes routes** so that headers and request context are established before any
handler runs. **Assets are last** because that step catches every unmatched path; anything
registered after it is unreachable.

### 1c. The Dev and Production Entry Split

**Where a development environment needs a weaker policy than production, express the difference
as a separate entry module — never as a runtime flag.**

The canonical case is a content-security policy: a dev server injects a live-reload script whose
hash must be allowed, and that allowance must not exist in production. A separate dev entry that
merges the extra source onto the base policy makes the guarantee **structural**: the production
default export cannot contain the dev allowance, because it is not in that file.

Two properties follow, and both are the reason for the shape:

- A build flag can be set wrongly; a module that does not import the value cannot leak it.
- Upgrading the tool that injects the script means editing one constant in the dev entry, with
  the production policy provably unaffected.

---

## 2. The Layer Stack

### 2a. Layer Roster

    worker entry           ← the composition root (§1)
    app/                   ← config schema, context types, middleware registration
    routes                 ← the declarative route map — data only
    router                 ← controller binding: routes to handlers and middleware
    controllers/           ← request handling: loaders, views, mutation handlers
    services/              ← external integrations — the only layer that calls out
    views/                 ← JSX components — pure rendering
    model/                 ← domain types and schemas
    client/                ← browser-only entry, bundled for the page
    assets/                ← stylesheets and static source

### 2b. Layer Dependency Rules

Each layer may import only from the layers listed:

| Layer | May import from |
| --- | --- |
| `controllers/` | `services/`, `model/`, `app/`, `views/`, routes, the shared library |
| `services/` | `model/`, app config |
| `views/` | `model/`, app context types, other views |
| `app/` middleware | app config, the shared library |
| routes | nothing — route data only, no handlers and no views |
| router | `controllers/`, `app/` middleware |
| worker entry | routes, router, `controllers/`, `app/` |

**A controller must not import another controller.** Shared behaviour between two controllers is
either middleware or a service; making one controller a dependency of another turns the route
map into a call graph nobody can read.

**A service must not import a controller or a view.** A service that renders is not a service.

### 2c. No Layer Skipping

**Handlers delegate to services; services own every external call.**

```ts
// BAD — the handler owns the integration
const res = await fetch("https://api.example.com/send", { body: JSON.stringify(payload) });

// GOOD — the handler calls the service; the service owns the call
await emailService.send(c, config, formData);
```

Two things the boundary buys, and both are lost the moment a handler calls out directly: the
handler becomes testable against a fake service rather than a network, and the integration
becomes reusable from a second route without being copied.

### 2d. Views Are Pure

**A view receives typed props and returns markup. It does not call a service, read config, or
decide a business rule.** Every value a view needs was resolved before it was called.

A page view composes its own layout — that is presentation, and it belongs to the view. What it
must not do is _fetch_ what the layout needs; the controller resolves it and passes it in.

---

## 3. Dependency Injection Through Config

### 3a. Typed Config Access

**A single config accessor validates the environment against a schema on first access and caches
the result.** Every handler and service reads configuration through it.

```ts
const config = configStore.get(c.env); // typed, validated
const baseUrl = config.site.url.origin;
const apiKey = config.services.email.apiKey;
```

**Never read a raw binding for a configured value in a handler or a service.** A direct read is
untyped, unvalidated, and invisible to the schema — so a missing variable surfaces as
`undefined` deep inside a request rather than as a startup error naming the field.

Raw binding access remains correct for **binding objects themselves** — a KV namespace, a
database, a rate limiter — which are resolved rather than validated
([`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §5e).

### 3b. Environment and Context Type Parameters

The bindings type is threaded through the app type, the context type, and the middleware type as
a single parameter, so a handler's `c.env` is typed everywhere it is touched.

**Context values set by middleware — nonce, request id, CSRF token, logger — are read through
typed accessors, not through an untyped variables bag.** A string-keyed bag defers every error to
runtime and makes "who sets this" unanswerable by the type system.

### 3c. Per-Request Presentation State

**Materialise the per-request values a view needs once, in the controller, as one typed object**
— base URL, nonce, CSRF token, public site keys — and pass it as a prop.

This is what keeps §2d honest: the view has no reason to reach for context because everything
contextual arrived as data. It also makes the cost visible — minting a CSRF token, for instance,
happens only for pages that declare a form target, because the controller decides rather than the
view discovering.

---

## 4. Concern-First Placement

### 4a. The Resolution Order

Resolve every new unit by **concern first, then latency, then thread cost**:

1. **Concern decides the layer before any performance question is asked.** Something needing
   trust, a secret, or a capability the browser lacks goes server-side. Something that is pure
   domain data — a schema, a table, a type — goes to the model. DOM, rendering, and input
   handling go to the browser tier. **Most units are decided here and never reach step 2.**
2. **Latency budget.** Work whose answer is needed within a single frame of user input must be
   synchronous and in-thread; anything else may be deferred or moved.
3. **Thread cost.** Work heavy enough to drop frames belongs off the render thread, where the
   platform allows it.

### 4b. When Two Layers Fit

**Pick the one further from the request path.** A unit that does not need to run per-request and
does not run per-request can never slow one down, and can never leak per-request state.

The same tiebreak, stated for the browser: pick the layer further from the render thread.

### 4c. What a Layer Must Never Accumulate

Each layer has a characteristic drift, and naming it is cheaper than re-deriving it in review:

- **Controllers** accumulate business rules. A rule that would be identical for a second entry
  point belongs in the model or a service.
- **Views** accumulate data fetching (§2d).
- **Services** accumulate presentation — a service that formats a message for a user has taken
  on a view's job and will be wrong for the next caller.
- **The browser tier** accumulates domain logic. It should stay presentation and adapters, never
  deriving a fact the server or a domain module already owns.

---

## 5. Feature Development Sequence

### 5a. The Ordered Steps

**Follow this sequence for every new feature. Do not reorder it** — the early steps exist to
prevent work that must be undone.

1. **Model** — define the domain types and the schema.
2. **Service** — implement any external integration against those types.
3. **Controller** — a render handler as a loader/view pair; a mutation handler as
   parse → validate → act → respond.
4. **View** — the JSX component, accepting typed props from the model.
5. **Route** — add the route entry, then bind handler and middleware in the controller map.
6. **Middleware** — add or reuse the guards the route needs: CSRF, rate limiting, origin,
   method enforcement ([`BOUNDARIES.md`](./BOUNDARIES.md) §2).
7. **Tests** — drive the full composition root through its request entry point
   ([`TESTING.md`](./TESTING.md) §1).

### 5b. Handler Structure

A well-formed mutation handler is **parse → validate → act → respond**, with one early return
per failure and no nesting:

```ts
export async function handleContact(c: AppContext): Promise<Response> {
  const config = configStore.get(c.env);
  const formData = await parseFormData(c);
  const parsed = validateContact(formData);
  if (!parsed.ok) return fragmentResponse(renderValidationErrors(parsed.error), 422);
  const sent = await emailService.send(parsed.data, config.services.email);
  if (!sent.ok) return fragmentResponse(renderError("Something went wrong."), 503);
  return fragmentResponse(renderSuccess("Message sent."));
}
```

A render handler splits the same shape across a **loader** that resolves data and a **view** that
renders it, so the data path is testable without rendering and the markup is testable without a
request.

**Keep handlers thin.** When validation grows branches, it belongs in the model; when the action
grows steps, it belongs in the service. A handler long enough to need section comments has
absorbed a layer below it ([`CODE_RULES.md`](./CODE_RULES.md) §5b).
