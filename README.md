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

| Import path | Concern | Key exports |
|---|---|---|
| `@y-core/forge/app` | App bootstrapping & lifecycle | `createApp`, `definePage`, `defineAction`, `healthCheck`, `validateEnv`, `serveAssets` |
| `@y-core/forge/cookie` | HTTP cookie creation & signing | `createCookie`, `createSignedCookie` |
| `@y-core/forge/form` | Form field reading & bot detection | `readFields`, `readTextField`, `isHoneypotFilled`, `verifyTurnstile` |
| `@y-core/forge/headers` | Typed HTTP header value classes | `CacheControl`, `ContentType`, `SetCookie`, `Vary`, `Accept`, `Range`, etc. |
| `@y-core/forge/html` | HTML output primitives | `escapeHtml`, `html`, `renderSuccess`, `renderError`, `renderValidationErrors`, `htmlResponse` |
| `@y-core/forge/router` | Declarative route configuration | `route`, `index`, `layout`, `prefix`, `applyRoutes` |
| `@y-core/forge/security` | Security middleware & headers | `defineSecurity`, `makeSecurityHeaders`, `NONCE`, `csrfProtection`, `originGuard`, `rateLimit`, `importCsrfKey`, `createCsrfToken`, `verifyCsrfToken`, `verifyOrigin` |
| `@y-core/forge/session` | Session management & middleware | `sessionMiddleware`, `createCookieSessionStorage` |
| `@y-core/forge/ui` | Server-side JSX primitives | `Form`, `Field`, `FieldContent`, `FieldLabel`, `FieldDescription`, `FieldError`, `Input`, `Textarea`, `Select`, `SelectOption`, `Button`, `Alert`, `AlertTitle`, `AlertDescription`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Separator` |
| `@y-core/forge/ui/client` | Browser-side controller mounts | `mountNav`, `mountTheme`, `mountTurnstile`, `loadScriptOnEvent`, `lazy` |
| `@y-core/forge/validation` | Validation namespace and result types | `v`, `ValidationResult` |

---

## `@y-core/forge/html` — HTML Output Primitives

Low-level utilities for producing safe HTML strings from a Worker handler. All user-facing content must pass through `escapeHtml` before inclusion in a response.

```typescript
import { escapeHtml, html, renderSuccess, renderError, renderValidationErrors, htmlResponse } from "@y-core/forge/html";

// Safe interpolation
const safe = escapeHtml(userInput); // & < > " ' → entities

// HTMX response fragments
return htmlResponse(renderSuccess("Message sent — we'll be in touch."));
return htmlResponse(renderError("Something went wrong. Please try again."));
return htmlResponse(renderValidationErrors(["Name is required", "Message too short"]));
```

---

## `@y-core/forge/form` — Form Field Reading and Bot Detection

Reads and normalises form submissions, and filters spam submissions before they reach business logic. Each concern is a separate function so you compose only what you need. CSRF protection lives in `@y-core/forge/security`.

```typescript
import { readFields, readTextField, isHoneypotFilled, verifyTurnstile } from "@y-core/forge/form";

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

## `@y-core/forge/headers` — Typed HTTP Header Value Classes

Typed constructors for common HTTP header values, re-exported from `@remix-run/headers`. Each class serialises to a spec-compliant string and provides named accessors so directive values are never stringly-typed.

```typescript
import { CacheControl, ContentType, Vary } from "@y-core/forge/headers";

new CacheControl({ maxAge: 3600, public: true }).toString();
// → "max-age=3600, public"

new ContentType({ mediaType: "text/html", charset: "utf-8" }).toString();
// → "text/html; charset=utf-8"

new Vary({ headers: ["Accept-Encoding", "Accept-Language"] }).toString();
// → "Accept-Encoding, Accept-Language"
```

**Available classes:** `CacheControl` · `ContentType` · `SetCookie` · `Vary` · `Accept` · `ContentDisposition` · `ContentRange` · `Range`

Security headers (`makeSecurityHeaders`, `NONCE`) live in `@y-core/forge/security`.

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
import { createApp, definePage, defineAction, healthCheck, validateEnv } from "@y-core/forge/app";
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

// Standard health check handler
export const health = healthCheck(() => ({ status: "ok" }));
```

---

## `@y-core/forge/security` — Security Middleware & Headers

Produces CSP + security headers and provides middleware for CSRF protection, origin validation, and rate limiting. `makeSecurityHeaders()` returns Hono middleware; `NONCE` is the Hono per-request placeholder that gets substituted into `script-src`. `defineSecurity()` composes multiple security concerns into a single middleware stack.

```typescript
import { makeSecurityHeaders, NONCE, csrfProtection, originGuard, rateLimit } from "@y-core/forge/security";

app.use("*", makeSecurityHeaders({ scriptSrc: ["'self'", NONCE] }));

// CSRF token primitives (low-level — usually used via csrfProtection middleware)
import { importCsrfKey, createCsrfToken, verifyCsrfToken } from "@y-core/forge/security";

// Origin validation
import { originGuard, verifyOrigin } from "@y-core/forge/security";
```

---

## `@y-core/forge/cookie` — HTTP Cookie Creation & Signing

Cookie constructors with strong defaults. `createSignedCookie` enforces `httpOnly: true`, `secure: true`, and HMAC signing — you cannot accidentally create an unsigned or client-readable signed cookie.

```typescript
import { createCookie, createSignedCookie } from "@y-core/forge/cookie";

// Plain cookie (use for non-sensitive values)
const themeCookie = createCookie("theme", { maxAge: 60 * 60 * 24 * 365 });

// Signed + httpOnly + secure (use for session tokens, CSRF state)
const sessionCookie = createSignedCookie("session", {
  secrets: [env.COOKIE_SECRET],
  maxAge: 60 * 60 * 24 * 7,
  sameSite: "Lax",
});
```

---

## `@y-core/forge/session` — Session Management & Middleware

Cookie-backed sessions. `sessionMiddleware()` reads the session on request and appends a session `Set-Cookie` header after `next()` if the session was modified during the handler.

```typescript
import { sessionMiddleware, createCookieSessionStorage } from "@y-core/forge/session";
import { createSignedCookie } from "@y-core/forge/cookie";

const cookie = createSignedCookie("__session", { secrets: [env.SESSION_SECRET] });
const storage = createCookieSessionStorage({ cookie });

// Register as Hono middleware
app.use("*", sessionMiddleware(storage, cookie));

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
