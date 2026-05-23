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
| `@y-core/forge/app` | App bootstrapping & lifecycle | `createApp`, `definePage`, `defineAction`, `defineRoutes`, `createLogger`, `healthCheck`, `validateEnv`, `serveAssets` |
| `@y-core/forge/cookie` | HTTP cookie creation & signing | `createCookie`, `createSignedCookie` |
| `@y-core/forge/form` | Form field reading & bot detection | `readFields`, `readTextField`, `isHoneypotFilled`, `verifyTurnstile` |
| `@y-core/forge/headers` | Typed HTTP header value classes | `CacheControl`, `ContentType`, `SetCookie`, `Vary`, `Accept`, `Range`, etc. |
| `@y-core/forge/html` | HTML output primitives | `escapeHtml`, `html`, `renderSuccess`, `renderError`, `renderValidationErrors`, `htmlResponse` |
| `@y-core/forge/router` | Declarative route configuration | `route`, `index`, `layout`, `prefix`, `applyRoutes` |
| `@y-core/forge/security` | Security middleware & headers | `defineSecurity`, `makeSecurityHeaders`, `NONCE`, `csrfProtection`, `originGuard`, `rateLimit`, `importCsrfKey`, `createCsrfToken`, `verifyCsrfToken`, `verifyOrigin` |
| `@y-core/forge/session` | Session management & middleware | `sessionMiddleware`, `createCookieSessionStorage` |
| `@y-core/forge/ui` | Server-side JSX components | `Form`, `Field`, `Input`, `Textarea`, `Select`, `Button`, `Alert`, `Card`, `Separator` |
| `@y-core/forge/ui/client` | Browser-side UI scripts | `initNav`, `initThemeSwitch`, `loadScriptOnEvent`, `initTurnstile` |
| `@y-core/forge/validation` | Schema validation & result types | `v` (valibot re-export), `ValidationResult` |

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

// Verify Turnstile token (returns { ok: true } or { ok: false, error: string })
const result = await verifyTurnstile(formData, env.TURNSTILE_SECRET_KEY);
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

File-based, declarative routing inspired by React Router's route config API. Routes are plain data structures — `route()`, `index()`, `layout()`, and `prefix()` build the tree; `applyRoutes()` registers the handlers on a Hono app. Each route module exports up to three handlers: `loader` (GET data), `view` (GET render), and `action` (POST/mutation), plus optional per-route `middleware`.

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

**Route module shape:**

```typescript
// A module can export any combination of these
export const loader  = (c) => c.json({ ... });         // GET — data
export const view    = (c) => c.html(renderPage(...));  // GET — render
export const action  = (c) => { /* POST handler */ };   // POST
export const middleware = [authMiddleware];              // applied before handlers
```

---

## `@y-core/forge/ui` — Server-Side JSX Components

Hono JSX components for forms and common UI patterns. Components are designed to wire directly to HTMX and to produce accessible, well-structured markup. The `Field` component owns the label/description/error region and auto-generates stable IDs so `aria-describedby` and `aria-errormessage` attributes are always consistent.

```tsx
import { Form, Field, Input, Textarea, Select, Button, Alert } from "@y-core/forge/ui";

// A complete accessible contact form
const ContactForm = () => (
  <Form hx-post="/api/contact" hx-target="#contact-result" hx-swap="innerHTML"
        csrfToken={token} class="flex flex-col gap-6">

    <Field name="name" label="Your name" required error={errors.name}>
      <Input name="name" value={values.name} />
    </Field>

    <Field name="message" label="Message" required description="Minimum 15 characters" error={errors.message}>
      <Textarea name="message" rows={5}>{values.message}</Textarea>
    </Field>

    <Button type="submit">Send message</Button>
  </Form>
);

// Field IDs are deterministic — useful when wiring aria attributes manually
import { fieldId, fieldErrorId } from "@y-core/forge/ui";
fieldId("name")       // → "field-name"
fieldErrorId("name")  // → "field-name-error"
```

**Available components:** `Form` · `Field` · `Input` · `Textarea` · `Select` · `Button` · `Alert` · `Card` · `Separator`

**Utilities:** `cn` (class merging) · `cva` (class variance authority for variant-based styling)

---

## `@y-core/forge/ui/client` — Browser-Side UI Scripts

Lightweight browser scripts with no framework dependency. Designed to initialise once on `DOMContentLoaded` and to compose cleanly with HTMX's event model.

```typescript
import { initNav, initThemeSwitch, loadScriptOnEvent, initTurnstile } from "@y-core/forge/ui/client";

initNav();          // mobile nav toggle — wires [data-ref="nav-toggle"] to [data-ref="nav-menu"]
initThemeSwitch();  // light/dark/system theme toggle, persisted to localStorage

// Lazy-load a third-party script only when the user interacts with a trigger
loadScriptOnEvent({
  triggerSelector: "[data-ref='turnstile-trigger']",
  event: "focus",
  scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
});

// Initialise a Cloudflare Turnstile widget
initTurnstile({ container: "#turnstile-widget", sitekey: TURNSTILE_SITE_KEY });
```

---

## `@y-core/forge/app` — App Bootstrapping & Lifecycle

Entry point for creating a Hono app with security middleware and sensible defaults pre-wired. `createApp` accepts a typed `Bindings` parameter and an options object for configuring CSP, rate limiting, and other security concerns. Structural helpers (`definePage`, `defineAction`, `defineRoutes`) organise handler modules without imposing a file-system convention.

```typescript
import { createApp, definePage, defineAction, validateEnv, healthCheck } from "@y-core/forge/app";
import { NONCE } from "@y-core/forge/security";

const app = createApp<Bindings>({
  security: { scriptSrc: ["'self'", NONCE] },
});

// Validate required env bindings at startup
const env = validateEnv(rawEnv, ["TURNSTILE_SECRET_KEY", "RESEND_API_KEY"]);

// Standard health check handler
export const health = healthCheck(() => ({ status: "ok" }));
```

---

## `@y-core/forge/security` — Security Middleware & Headers

Produces CSP + security headers and provides middleware for CSRF protection, origin validation, and rate limiting. `makeSecurityHeaders` generates the full header set; `NONCE` is the Hono per-request placeholder that gets substituted into `script-src`. `defineSecurity` composes multiple security concerns into a single middleware stack.

```typescript
import { makeSecurityHeaders, NONCE, csrfProtection, originGuard, rateLimit } from "@y-core/forge/security";

// Used inside createApp — security headers applied on every response
const { headers, nonce } = makeSecurityHeaders({ isDev: env.ENVIRONMENT !== "production" });

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

Stateless cookie-backed sessions. `sessionMiddleware` reads the session on request and writes it back (via `set-cookie`) if the session was modified during the handler. `createCookieSessionStorage` builds the storage instance that the middleware operates on.

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

Re-exports the full valibot API plus a default `v` namespace import, so call sites can use either import style. `ValidationResult` is the standard return type for action handlers — a discriminated union of `{ ok: true, data }` and `{ ok: false, errors }`.

```typescript
import { v, type ValidationResult } from "@y-core/forge/validation";

const ContactSchema = v.object({
  name: v.pipe(v.string(), v.minLength(2)),
  email: v.pipe(v.string(), v.email()),
  message: v.pipe(v.string(), v.minLength(15)),
});

function validateContact(fields: unknown): ValidationResult<typeof ContactSchema> {
  const result = v.safeParse(ContactSchema, fields);
  if (!result.success) return { ok: false, errors: v.flatten(result.issues).nested ?? {} };
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
