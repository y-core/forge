# `@y-core/forge` — Reusable Component Library

A collection of namespaced TypeScript modules for building server-rendered web applications on **Hono + Cloudflare Workers**, with HTMX for progressive enhancement and Tailwind CSS for styling. Each namespace is independently useful and carries no dependency on any other namespace in this library.

---

## Design Principles

**Build on Web APIs.**  
All modules are written against the standard Web Platform (`Request`, `Response`, `FormData`, `Headers`). There is no framework abstraction between your code and the runtime.

**Religiously Runtime.**  
No module assumes static analysis, bundling, or a build step. TypeScript and JSX are compile-away transformations only. All tests run directly under `bun test` without a bundler.

**Avoid Dependencies.**  
External dependencies are minimised and wrapped completely so they can be replaced without touching call sites. The goal is zero external runtime dependencies. Each dependency is a deliberate, contained choice.

**Demand Composition.**  
Every namespace is single-purpose and independently useful. A module that cannot stand alone is either in the wrong namespace or needs to be broken up further. Tightly coupled modules that always change together live in the same namespace rather than forcing cross-namespace imports.

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
| `@y-core/forge/form` | Form parsing, CSRF & bot detection |
| `@y-core/forge/http` | HTTP output — responses, headers |
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

## `@y-core/forge/form` — Form Parsing, CSRF Protection & Bot Detection

Reads and normalises form submissions, provides CSRF middleware and token primitives, and filters spam submissions before they reach business logic. Each concern is a separate function so you compose only what you need.

```typescript
import {
  csrfProtection,
  importCsrfKey,
  createCsrfToken,
  readFields,
  readTextField,
  isHoneypotFilled,
  verifyTurnstile,
  CSRF_FIELD_DEFAULT,
} from "@y-core/forge/form";

// CSRF middleware — secret is resolved lazily from context at request time
app.use("/contact", csrfProtection({ secret: async (c) => importCsrfKey(c.env.CSRF_SECRET) }));

// Generate a token for embedding in a form
const token = await createCsrfToken(await importCsrfKey(env.CSRF_SECRET), "/contact");

const formData = await c.req.formData();

// Reject honeypot-filled bots
if (isHoneypotFilled(formData)) return c.text("Bad request", 400);

// Read and normalise fields (trims whitespace, normalises CRLF)
const { name, email, message } = readFields(formData, ["name", "email", "message"]);

// Verify Turnstile token with hostname / action expectations
const result = await verifyTurnstile(
  formData,
  env.TURNSTILE_SECRET_KEY,
  "cf-turnstile-response",
  c.req.header("CF-Connecting-IP"),
  { expectedAction: "contact", expectedHostname: "example.com" },
);
if (!result.ok) return c.text("Verification failed", 403);
```

---

## `@y-core/forge/config` — Environment Config Resolution

Typed, lazy configuration bound to Cloudflare Workers environment variables. `Config` resolves once on first access and caches the result for the Worker's lifetime. `env()` creates typed references to binding names; `applyMapping()` walks a nested mapping and substitutes values from `env`. `optionalGroup()` wraps a group of fields so the entire group collapses to `null` when required keys are absent.

```typescript
import { Config, env, optionalGroup, resolveConfig } from "@y-core/forge/config";
import { v } from "@y-core/forge/validation";

// Declare a typed config bound to env var names
const emailConfig = new Config(
  { apiKey: env("RESEND_API_KEY"), fromAddress: env("EMAIL_FROM") },
  v.object({ apiKey: v.string(), fromAddress: v.pipe(v.string(), v.email()) }),
);

// Resolve on first use — cached for the Worker instance lifetime
const { apiKey, fromAddress } = emailConfig.get(c.env);

// optionalGroup — whole block is null if required key is absent
const analyticsSchema = v.object({
  analytics: optionalGroup(
    { siteId: v.string(), host: v.string() },
    { required: ["siteId"], defaults: { host: "analytics.example.com" } },
  ),
});

// Environment overrides — e.g. patch URLs in CI
const apiConfig = new Config(
  { apiUrl: env("API_URL") },
  v.object({ apiUrl: v.string() }),
  {
    detect: (env) => env["CI"] === "true",
    patch: (cfg) => ({ ...cfg, apiUrl: "http://localhost:3000" }),
  },
);

// Test control — seed bypasses env resolution entirely
emailConfig.seed({ apiKey: "test-key", fromAddress: "noreply@example.com" });
emailConfig.reset(); // restore lazy resolution
```

The `registerConfig` / `retrieveConfig` registry associates a `Config` store with any host object via a `WeakMap`, letting modules expose their config without a shared import:

```typescript
import { registerConfig, retrieveConfig } from "@y-core/forge/config";

registerConfig(emailModule, emailConfig);

// Elsewhere, by reference only — no direct import of emailConfig needed
const store = retrieveConfig<EmailCfg>(emailModule);
const cfg = resolveConfig(store, c.env);
```

---

## `@y-core/forge/router` — Declarative Route Configuration

File-based, declarative routing inspired by React Router's route config API. Routes are plain data structures — `route()`, `index()`, `layout()`, and `prefix()` build the tree; `applyRoutes()` registers orchestrated route modules on a Hono app.

```typescript
import { route, index, layout, prefix, applyRoutes } from "@y-core/forge/router";

const routes = [
  layout(rootModule, [
    index(homeModule),
    route("/contact", contactModule),
    ...prefix("/api", [
      route("/health", healthModule),
    ]),
  ]),
];

applyRoutes(app, routes);
```

**Route lifecycle:**

```typescript
// GET: middleware -> loader -> view
export const loader = async (c) => ({ csrfToken: await makeCsrfToken(c.env.CSRF_SECRET, "/contact") });
export const view = (c, state) => c.html(renderPage(state.data));

// POST: middleware -> action -> view
export const action = async (c) => ({ success: true });
export const view = (c, state) => c.html(renderResult(state.actionData));

// Resource actions can still return a Response directly with no view.
```

`definePage()` wraps this pattern for page routes. `defineAction()` remains the parse/validate/handle pipeline for resource-style POST handlers that return a `Response` directly.

---

## `@y-core/forge/ui` — Server-Side JSX Components

Hono JSX components are source-distributed primitives: thin wrappers over native elements with default styling, predictable prop pass-through, and explicit composition. Field state is owned through composition instead of bespoke one-off props.

```tsx
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Form,
  Input,
  Select,
  SelectOption,
  Textarea,
} from "@y-core/forge/ui";

const ContactForm = () => (
  <Card>
    <CardHeader>
      <CardTitle>Contact us</CardTitle>
      <CardDescription>We reply within one business day.</CardDescription>
    </CardHeader>

    <CardContent>
      <Form
        hx-post="/api/contact"
        hx-target="#contact-result"
        hx-swap="innerHTML"
        csrfToken={token}
      >
        <FieldGroup>
          <Field name="name" invalid={Boolean(errors.name)}>
            <FieldLabel>Your name</FieldLabel>
            <FieldContent>
              <Input required value={values.name} />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </FieldContent>
          </Field>

          <Field name="topic">
            <FieldLabel>Topic</FieldLabel>
            <FieldContent>
              <Select value={values.topic}>
                <SelectOption value="support">Support</SelectOption>
                <SelectOption value="partnership">Partnership</SelectOption>
              </Select>
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

Controls rendered inside `Field` automatically inherit `id`, `name`, `aria-invalid`, and `aria-describedby` defaults from the field context.

`Alert`, `Card`, and form primitives follow the same pattern: explicit subcomponents, `data-slot` hooks, and native elements as the base contract.

```tsx
<Alert variant="success">
  <AlertTitle>Delivered</AlertTitle>
  <AlertDescription>Your message has been sent.</AlertDescription>
</Alert>
```

**Utilities:** `cn` (class merging) · `cva` (class variance authority for variant-based styling)

---

## `@y-core/forge/ui/client` — Browser-Side UI Scripts

Lightweight browser helpers with no framework dependency. Each helper mounts a controller, is safe to call repeatedly, and returns a cleanup function so it can be mounted and unmounted predictably.

```typescript
import {
  isDark,
  lazy,
  loadScriptOnEvent,
  mountNav,
  mountTheme,
  mountTurnstile,
} from "@y-core/forge/ui/client";

const unmountNav = mountNav();
const unmountTheme = mountTheme();

loadScriptOnEvent({
  triggerSelector: "[data-ref='turnstile-trigger']",
  event: "focus",
  scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
  integrity: false,
});

const unmountTurnstile = mountTurnstile(isDark);

lazy({
  ref: "map-section",
  load: () => import("./map"),
  init: (mod) => mod.initMap(),
});
```

---

## `@y-core/forge/app` — App Bootstrapping & Lifecycle

Entry point for creating a Hono app with security middleware and sensible defaults pre-wired. `createApp` accepts a typed `Bindings` parameter and an options object for configuring CSP and error handling. `definePage()` builds orchestrated page routes; `defineAction()` builds resource-style POST handlers.

```typescript
import { createApp, definePage, defineAction, healthCheck, validateEnv, validateBindings } from "@y-core/forge/app";
import { NONCE } from "@y-core/forge/security";
import { v } from "@y-core/forge/validation";

const app = createApp<Bindings>({
  security: { scriptSrc: ["'self'", NONCE] },
});

const EnvSchema = v.object({
  RESEND_API_KEY: v.string(),
  TURNSTILE_SECRET_KEY: v.string(),
});

const env = validateEnv(rawEnv, EnvSchema);

// Validate required Worker bindings at startup
const bindings = validateBindings(c.env, ["KV_STORE", "ASSETS"]);

// Standard health check handler
export const health = healthCheck(() => ({ status: "ok" }));
```

---

## `@y-core/forge/security` — Security Middleware & Headers

Produces CSP + security headers and provides middleware for transport-layer hardening: origin validation, cross-origin protection, rate limiting, and request filtering. `makeSecurityHeaders()` returns Hono middleware; `NONCE` is the Hono per-request placeholder substituted into `script-src`.

> **Note:** CSRF protection has moved to `@y-core/forge/form` — use `csrfProtection`, `importCsrfKey`, and `createCsrfToken` from there.

```typescript
import {
  makeSecurityHeaders,
  NONCE,
  cors,
  originGuard,
  rateLimit,
  isHxRequest,
  verifyOrigin,
} from "@y-core/forge/security";

app.use("*", makeSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));

// Guard POST endpoints to same-origin HTMX requests only
app.use("/api/*", (c, next) => isHxRequest(c) ? next() : c.text("Forbidden", 403));

// Origin validation
import { originGuard, verifyOrigin } from "@y-core/forge/security";
```

---

## `@y-core/forge/session` — Session Management, Cookies & Middleware

Cookie-backed sessions, plus cookie constructors with strong defaults. `sessionMiddleware()` reads the session on request and appends a session `Set-Cookie` header after `next()` if the session was modified during the handler. `createSignedCookie` enforces `httpOnly: true`, `secure: true`, and HMAC signing.

```typescript
import { sessionMiddleware, createCookieSessionStorage, createCookie, createSignedCookie } from "@y-core/forge/session";

// Plain cookie (use for non-sensitive values)
const themeCookie = createCookie("theme", { maxAge: 60 * 60 * 24 * 365 });

// Signed + httpOnly + secure (use for session tokens)
const sessionCookie = createSignedCookie("__session", {
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 60 * 24 * 7,
  sameSite: "Lax",
});

const storage = createCookieSessionStorage({ cookie: sessionCookie });

// Register as Hono middleware
app.use("*", sessionMiddleware(storage, sessionCookie));

// In a handler — session is set on the context by the middleware
const session = c.get("session");
session.set("userId", user.id);
// set-cookie header written automatically after next()
```

---

## `@y-core/forge/validation` — Schema Validation & Result Types

Exports the `v` valibot namespace plus `ValidationResult`. `ValidationResult<T>` is a discriminated union of `{ ok: true, data }` and `{ ok: false, errors: string[] }`.

```typescript
import { v, type ValidationResult } from "@y-core/forge/validation";

const ContactSchema = v.object({
  name: v.pipe(v.string(), v.minLength(2)),
  email: v.pipe(v.string(), v.email()),
  message: v.pipe(v.string(), v.minLength(15)),
});

function validateContact(fields: unknown): ValidationResult<{ name: string; email: string; message: string }> {
  const result = v.safeParse(ContactSchema, fields);
  if (!result.success) return { ok: false, errors: result.issues.map((issue) => issue.message) };
  return { ok: true, data: result.output };
}
```

---

## Testing

All tests live alongside the source they test (`*.test.ts` / `*.test.tsx`) and run directly under Bun with no bundler:

```bash
bun test                    # all tests
bun test src/form           # one namespace
bun test src/ui/core        # components only
bun run check               # typecheck + lint + tests (full pipeline)
```

Tests import from relative paths (`"./field"`, `"./read"`) and use `bun:test` primitives (`describe`, `it`, `expect`). Type checking uses `tsgo` (`@typescript/native-preview`).
