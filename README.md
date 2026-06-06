# `@y-core/forge` — Reusable Component Library

A collection of namespaced TypeScript modules for building server-rendered web applications on **`@remix-run/fetch-router` + Cloudflare Workers**, with HTMX for progressive enhancement and Tailwind CSS for styling. Each namespace is independently useful and carries no dependency on any other namespace in this library.

---

## Design Principles

**Build on Web APIs.**  
All modules are written against the standard Web Platform (`Request`, `Response`, `FormData`, `Headers`). The only framework layer is `@remix-run/fetch-router`, whose `RequestContext` is itself a thin wrapper over `Request`.

**Religiously Runtime.**  
No module assumes static analysis or a build step beyond TypeScript/JSX erasure. All tests run directly under `bun test` without a bundler.

**Avoid Dependencies.**  
External dependencies are minimised and wrapped completely so they can be replaced without touching call sites. Each dependency is a deliberate, contained choice.

**Demand Composition.**  
Every namespace is single-purpose and independently useful. Tightly coupled modules that always change together live in the same namespace rather than forcing cross-namespace imports.

---

## Supported Environments

forge ships its TypeScript/TSX **source** directly — there is no build step and no emitted `.d.ts`. Consuming it therefore requires a **TypeScript-aware bundler** that resolves `.ts`/`.tsx` and is configured with `jsxImportSource: "@y-core/forge"` (e.g. esbuild, Bun, Vite, or Wrangler). A plain-JavaScript consumer, or one relying on `tsc`-style resolution of compiled `.js`, cannot import forge.

---

## Namespace Overview

See [NAMESPACE_DESIGN.md](.decisions/NAMESPACE_DESIGN.md) for the authoritative namespace catalog.
The table below is a quick reference; the decision doc is the source of truth.

| Import path | Concern |
|---|---|
| `@y-core/forge/app` | App bootstrap & lifecycle |
| `@y-core/forge/assets` | Asset config & metadata |
| `@y-core/forge/assets/build` | Asset build pipeline |
| `@y-core/forge/assets/manifest` | Manifest & sprite registry |
| `@y-core/forge/cli` | CLI command framework |
| `@y-core/forge/config` | Environment config |
| `@y-core/forge/context` | `RequestContext`, `AppContext`|
| `@y-core/forge/form` | Form parsing, CSRF & bot detection |
| `@y-core/forge/http` | HTTP output — responses, headers, fragments |
| `@y-core/forge/jsx` | JSX runtime |
| `@y-core/forge/logging` | Structured logging |
| `@y-core/forge/logging/http` | Log viewer UI & reader |
| `@y-core/forge/pkg` | Release & versioning |
| `@y-core/forge/result` | Result monad |
| `@y-core/forge/router` | Declarative route config |
| `@y-core/forge/security` | Transport-layer hardening |
| `@y-core/forge/session` | Session + cookie management |
| `@y-core/forge/storage/db` | D1 database client |
| `@y-core/forge/storage/kv` | Workers KV typed store |
| `@y-core/forge/storage/r2` | R2 object storage |
| `@y-core/forge/ui` | Server-side JSX components |
| `@y-core/forge/ui/client` | Browser-side UI scripts |
| `@y-core/forge/ui/client/htmx` | HTMX bundle (sideEffect) |
| `@y-core/forge/validation` | Schema validation (valibot) |

---

## The Request Context

Handlers and middleware receive a `RequestContext` from `@remix-run/fetch-router`. forge extends it at runtime with the Workers `env` and `executionCtx`, exposed as the `AppContext<Bindings>` type:

```typescript
import { getAppContext, type AppContext } from "@y-core/forge/context";

// Inside any handler/middleware: narrow the RequestContext to an AppContext.
// `getAppContext` asserts the Forge router has injected per-request state and throws a clear
// error if not (e.g. the handler ran outside the Forge chain), instead of yielding `undefined env`.
const c = getAppContext<Bindings>(context);
c.env.CSRF_SECRET;     // typed Workers bindings
c.executionCtx.waitUntil(promise);
c.request;             // the standard Request
c.url.pathname;        // parsed URL
```

Custom per-request variables use typed accessors instead of stringly-keyed `get`/`set`:

```typescript
import { contextVar } from "@y-core/forge/context";

const userCtx = contextVar<User>("user");
userCtx.set(context, user);
const user = userCtx.get(context);          // throws if unset
const maybe = userCtx.getOptional(context); // undefined if unset
```

---

## `@y-core/forge/app` — App Bootstrapping & Lifecycle

`createApp` returns a `Forge` instance — a Workers-native request router with a fail-closed error boundary. Its `fetch(request, env, executionCtx)` method is a valid Workers module default export.

```typescript
import { createApp, applyAssets, definePage, defineAction, healthCheck, validateBindings, validateEnv, renderWith } from "@y-core/forge/app";
import { route, createController } from "@y-core/forge/router";
import { makeSecurityHeaders, NONCE } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const app = createApp<Bindings>({
  config: configStore,                                  // optional Config store (see /config)
  isDebug: (c) => configStore.get(c.env).site.debug,    // show error detail when true
});

// Path-scoped middleware. "*" matches all paths; "/api/*" matches the prefix.
app.use("*", makeSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));

// Declarative routes (single source of truth) — see /router below.
const routes = route({
  home: { method: "GET", pattern: "/" },
  contact: { method: "POST", pattern: "/api/contact" },
  health: { method: "GET", pattern: "/api/health" },
});

const controller = createController(routes, {
  actions: {
    home: homePage,                                                 // a definePage handler
    contact: { middleware: [csrfGuard], handler: contactAction },   // a defineAction handler
    health: healthCheck({ kv: (c) => Boolean(c.env.MY_KV) }),       // checks → { ok, checks }
  },
});

app.map(routes, controller);
applyAssets(app, { notFoundView });   // static-asset catch-all backed by the ASSETS binding

export default app;
```

**Startup validation:**

```typescript
const EnvSchema = v.object({ CSRF_SECRET: v.string(), TURNSTILE_SECRET_KEY: v.string() });

// One-shot: throws a descriptive error if env is invalid.
const env = validateEnv(rawEnv, EnvSchema);

// Middleware form: validates Worker bindings on first request (and whenever env identity changes).
app.use("*", validateBindings(EnvSchema));
```

### Route lifecycle — `definePage` and `defineAction`

`definePage` wraps a `loader` (data) + `view` (JSX → `Response`) into a `RequestHandler`, with optional caching, custom headers, and error recovery. The handler receives `(c, config, state)`.

Full pages are rendered via a `renderWith()`-installed renderer — the app calls
`app.use("*", renderWith(pageRenderer))` once, and handlers call `c.render(content, init)`;
`logViewer` and other forge handlers read the same renderer via `context.get(Renderer)`.
When no renderer is installed, `c.render` is not available and those handlers fall back
to `Response.json(data)`.

```typescript
import { definePage } from "@y-core/forge/app";

export const homePage = definePage<Bindings, AppConfig>({
  cache: "no-store",
  loader: async (c, config) => ({ greeting: `Hello from ${config.site.name}` }),
  view: (c, config, state) => c.render(<Home data={state.data} />),
  onError: (err, c) => renderError(c, err),     // called if loader/view throws
});
```

`defineAction` wires a `parse → validate → handle` pipeline into a POST handler, returning structured error fragments (413/400/422/500) automatically. The handler receives `(data, c, config)`.

```typescript
import { defineAction } from "@y-core/forge/app";
import { renderSuccess } from "@y-core/forge/http";

export const contactAction = defineAction<ContactInput, Bindings, AppConfig>({
  parse: (formData) => readFields(formData, ["name", "email", "message"]),
  validate: (data) => validateContact(data),                       // ValidationResult<T>
  handle: async (data, c, config) => {
    await sendEmail(config.email, data);
    return renderSuccess("Thanks — we'll be in touch.");
  },
});
```

Both run **after** the controller's per-route middleware array.

---

## `@y-core/forge/router` — Declarative Route Configuration

Routes are plain data built with `route()` (or `createRoutes`), then bound to handlers with `createController`. forge re-exports the `@remix-run/fetch-router` route authoring surface (`route`, `get`, `post`, `resource`, `resources`, `Route`, `createRouter`, `createController`, `RequestContext`) plus type-safe URL generation (`createHref`, `joinPatterns`).

```typescript
import { route, createController } from "@y-core/forge/router";

// 1. Describe the routes as data (the single source of truth).
const routes = route({
  home: { method: "GET", pattern: "/" },
  contact: { method: "POST", pattern: "/api/contact" },
  adminLogs: { method: "GET", pattern: "/admin/logs" },
});

// 2. Bind each route name to a handler — bare, or `{ middleware, handler }`.
const controller = createController(routes, {
  actions: {
    home: homePage,
    contact: { middleware: [csrfGuard, originGuard], handler: contactAction },
    adminLogs: { middleware: [adminAuth], handler: logViewer({ kv: (c) => c.env.LOGS_KV }) },
  },
});

// 3. Register on the app.
app.map(routes, controller);

// Typed URL generation from a pattern:
routes.contact.href();   // "/api/contact"
```

Every route name in `routes` must have a matching entry in `actions` (and vice-versa) — the mapping is checked structurally, so a missing or misspelled handler is a compile error.

---

## `@y-core/forge/form` — Form Parsing, CSRF Protection & Bot Detection

Reads and normalises form submissions, provides CSRF middleware + token primitives, and filters spam before it reaches business logic. Each concern is a separate function so you compose only what you need.

```typescript
import {
  csrfProtection,
  importCsrfKey,
  createCsrfToken,
  mintCsrf,
  csrfTokenCtx,
  parseFormData,
  readFields,
  isHoneypotFilled,
  verifyTurnstile,
  CSRF_FIELD_DEFAULT,
} from "@y-core/forge/form";
import { getAppContext } from "@y-core/forge/context";

// CSRF middleware — the secret is resolved lazily from the request context at request time.
// On GET/HEAD it pre-mints a token bound to the current path; on mutations it verifies and, on
// any failure, returns a generic 403.
const csrfGuard = csrfProtection({
  secret: (context) => importCsrfKey(getAppContext(context).env.CSRF_SECRET),
});

// Read the pre-minted token for the current path inside a loader/view:
const token = csrfTokenCtx.get(context);
// …or mint one bound to a different action path:
const actionToken = await mintCsrf(context, "/api/contact");

// In an action handler (RequestContext):
const formData = await parseFormData(context);
if (isHoneypotFilled(formData)) return new Response("Bad request", { status: 400 });
const { name, email, message } = readFields(formData, ["name", "email", "message"]);

// Verify a Turnstile token. ALWAYS pass expectedHostname in production to prevent cross-site
// token replay (a warning is logged when it is omitted).
const result = await verifyTurnstile(
  formData,
  env.TURNSTILE_SECRET_KEY,
  "cf-turnstile-response",
  context.request.headers.get("CF-Connecting-IP") ?? undefined,
  { expectedAction: "contact", expectedHostname: "example.com" },
);
if (!result.ok) return new Response("Verification failed", { status: 403 });
```

**CSRF tokens** are stateless: HMAC-SHA256 (constant-time verify), bound to a path and an optional subject, with key-ring rotation and a 30s clock-skew tolerance. The lower-level primitives:

```typescript
const key = await importCsrfKey(env.CSRF_SECRET);          // hex secret → HMAC key
const token = await createCsrfToken(key, "/api/contact");  // path-bound token
const verdict = await verifyCsrfToken(key, token, "/api/contact");
```

> **`CsrfResult.reason` is server-log-only.** On failure, `verifyCsrfToken` returns a discriminated
> `reason` (`expired`, `path-mismatch`, `invalid-signature`, …) for diagnostics. `csrfProtection`
> deliberately collapses **every** failure to a bare `403` — never surface `reason` to clients, as
> it would leak a token-introspection oracle on unauthenticated input.

---

## `@y-core/forge/config` — Environment Config Resolution

Typed, lazy configuration bound to Cloudflare Workers environment variables. A `Config` resolves once on first access and caches the result for the Worker's lifetime.

```typescript
import { Config, env, optionalGroup, resolveConfig, registerConfig, retrieveConfig } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

const emailConfig = new Config(
  { apiKey: env("RESEND_API_KEY"), fromAddress: env("EMAIL_FROM") },
  v.object({ apiKey: v.string(), fromAddress: v.pipe(v.string(), v.email()) }),
);

// Resolve on first use — cached for the Worker instance lifetime.
const { apiKey, fromAddress } = emailConfig.get(c.env);

// optionalGroup — the whole block collapses to null if a required key is absent.
const schema = v.object({
  analytics: optionalGroup(
    { siteId: v.string(), host: v.string() },
    { required: ["siteId"], defaults: { host: "analytics.example.com" } },
  ),
});

// Test control — seed bypasses env resolution; reset restores lazy resolution.
emailConfig.seed({ apiKey: "test-key", fromAddress: "noreply@example.com" });
emailConfig.reset();
```

The `registerConfig` / `retrieveConfig` registry associates a `Config` store with any host object via a `WeakMap`, letting modules expose their config without a shared import (this is how `createApp({ config })` and `applyAssets` reach the app's config):

```typescript
import { registerConfig, retrieveConfig, resolveConfig } from "@y-core/forge/config";

registerConfig(hostObject, emailConfig);

// Elsewhere, by reference only — no direct import of emailConfig needed.
const store = retrieveConfig<EmailCfg>(hostObject);
const cfg = resolveConfig(store, c.env);
```

---

## `@y-core/forge/security` — Security Middleware & Headers

Produces CSP + security headers and middleware for transport-layer hardening: origin validation, cross-origin protection, rate limiting, and request filtering. `makeSecurityHeaders()` returns a Forge `Middleware`; `NONCE` is the per-request nonce **placeholder** substituted into `script-src`/`style-src` when the response is built.

> **Note:** CSRF protection lives in `@y-core/forge/form` — use `csrfProtection`, `importCsrfKey`, and `createCsrfToken` from there.

```typescript
import {
  makeSecurityHeaders,
  mergeSecurityHeaders,
  NONCE,
  cors,
  originGuard,
  verifyOrigin,
  rateLimit,
  isHxRequest,
  requestId,
  type CspSourceValue,
} from "@y-core/forge/security";

app.use("*", makeSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));

// Restrict an endpoint to same-origin HTMX requests only.
app.use("/api/*", (context, next) =>
  isHxRequest(context) ? next() : new Response("Forbidden", { status: 403 }));

// Layer additional sources onto a base policy (e.g. dev live-reload).
const devHeaders = mergeSecurityHeaders(baseHeaders, { scriptSrc: [WRANGLER_LIVE_RELOAD_HASH] });
```

`cors` validates the `Origin` against an allowlist (exact strings or `*.example.com` wildcards); `verifyOrigin` is the bare predicate used by per-route guards.

---

## `@y-core/forge/session` — Session Management, Cookies & Middleware

Cookie-backed sessions plus cookie constructors with strong defaults. `sessionMiddleware()` reads the session on the way in and appends a `Set-Cookie` only if the session was modified or destroyed (so unchanged requests stay cacheable). `createSignedCookie` enforces `httpOnly`, `secure`, and HMAC signing.

```typescript
import {
  sessionMiddleware,
  sessionCtx,
  createCookieSessionStorage,
  createCookie,
  createSignedCookie,
} from "@y-core/forge/session";

const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 60 * 24 * 7,
  sameSite: "Lax",
});
const storage = createCookieSessionStorage({ cookie: sessionCookie });

// Register as middleware.
app.use("*", sessionMiddleware(storage, sessionCookie));

// In a handler — read the session via its typed accessor.
const session = sessionCtx.get(context);
session.set("userId", user.id);   // marks the session dirty → Set-Cookie written after the handler

// A plain (unsigned) cookie for non-sensitive values:
const themeCookie = createCookie("theme", { maxAge: 60 * 60 * 24 * 365 });
```

---

## `@y-core/forge/ui` — Server-Side JSX Components

JSX components are source-distributed primitives: thin wrappers over native elements with default styling, predictable prop pass-through, and explicit composition. Field state is owned through composition.

```tsx
import {
  Alert, AlertDescription, AlertTitle,
  Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel,
  Form, Input, Select, SelectOption, Textarea,
} from "@y-core/forge/ui";

const ContactForm = ({ token, values, errors }) => (
  <Card>
    <CardHeader>
      <CardTitle>Contact us</CardTitle>
      <CardDescription>We reply within one business day.</CardDescription>
    </CardHeader>
    <CardContent>
      <Form hx-post="/api/contact" hx-target="#contact-result" hx-swap="innerHTML" csrfToken={token}>
        <FieldGroup>
          <Field name="name" invalid={Boolean(errors.name)}>
            <FieldLabel>Your name</FieldLabel>
            <FieldContent>
              <Input required value={values.name} />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </FieldContent>
          </Field>

          <Field name="message" invalid={Boolean(errors.message)}>
            <FieldLabel>Message</FieldLabel>
            <FieldContent>
              <Textarea rows={5} required>{values.message}</Textarea>
              <FieldDescription>Minimum 15 characters</FieldDescription>
              {errors.message && <FieldError>{errors.message}</FieldError>}
            </FieldContent>
          </Field>
        </FieldGroup>
        <Button type="submit">Send message</Button>
      </Form>
    </CardContent>
  </Card>
);
```

Controls rendered inside `Field` inherit `id`, `name`, `aria-invalid`, and `aria-describedby` from the field context. **Utilities:** `cn` (class merging) · `cva` (class-variance authority).

---

## `@y-core/forge/ui/client` — Browser-Side UI Scripts

Framework-free browser helpers. Each mounts a controller, is safe to call repeatedly, and returns a cleanup function. Includes a tiny signals runtime (`createSignal`, `computed`, `effect`) and an island bootstrapper (`registerIsland`, `bootIslands`).

```typescript
import { mountNav, mountTheme, mountTurnstile, isDark, lazy, loadScriptOnEvent } from "@y-core/forge/ui/client";

const unmountNav = mountNav();
const unmountTheme = mountTheme();

loadScriptOnEvent({
  triggerSelector: "[data-ref='turnstile-trigger']",
  event: "focus",
  scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
  integrity: false,
});

const unmountTurnstile = mountTurnstile(isDark);

lazy({ ref: "map-section", load: () => import("./map"), init: (mod) => mod.initMap() });
```

---

## `@y-core/forge/validation` — Schema Validation & Result Types

Exports the `v` valibot namespace plus `ValidationResult<T>` — a discriminated union of `{ ok: true, data }` and `{ ok: false, errors: string[] }`.

```typescript
import { v, type ValidationResult } from "@y-core/forge/validation";

const ContactSchema = v.object({
  name: v.pipe(v.string(), v.minLength(2)),
  email: v.pipe(v.string(), v.email()),
  message: v.pipe(v.string(), v.minLength(15)),
});

function validateContact(fields: unknown): ValidationResult<ContactInput> {
  const result = v.safeParse(ContactSchema, fields);
  if (!result.success) return { ok: false, errors: result.issues.map((i) => i.message) };
  return { ok: true, data: result.output };
}
```

---

## Testing

All tests live alongside the source they test (`*.test.ts` / `*.test.tsx`) and run directly under Bun with no bundler. `Forge` provides a `request()` helper that builds a `Request` and dispatches it through the full middleware chain:

```typescript
import { Forge } from "@y-core/forge/app";

const res = await app.request("/api/contact", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ __csrf: token, name: "Jane" }),
}, MINIMUM_ENV);

expect(res.status).toBe(200);
```

```bash
bun test                    # all tests
bun test src/form           # one namespace
bun run check               # typecheck (tsgo) + lint (biome) + tests + validate-exports
```

Type checking uses `tsgo` (`@typescript/native-preview`). `validate-exports` verifies, in both directions, that every barrel export resolves at runtime **and** that every `@public`-tagged source symbol is re-exported from its namespace barrel.
