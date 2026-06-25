# `@y-core/forge/http`

HTTP response construction and HTML output helpers for server-rendered apps on
`@remix-run/fetch-router` + Cloudflare Workers: `Response` builders for full pages, HTMX fragments,
and redirects; pre-built HTMX status banners; typed header-value builders; and a safe-HTML toolkit
(`html` tagged template, escaping, URL sanitization) that defends against injection by default. Each
concern is a separate, independently useful function — compose only what a route needs.

```ts
import {
  htmlResponse,
  fragmentResponse,
  redirect,
  createRedirectResponse,
  renderSuccess,
  renderError,
  renderValidationErrors,
  html,
  rawHtml,
  isSafeHtml,
  escapeHtml,
  safeUrl,
  joinPath,
  ContentType,
  CacheControl,
  SetCookie,
} from "@y-core/forge/http";
```

---

## Features

- **Response builders** — `htmlResponse` constructs a full-page `Response` (guaranteed
  `<!DOCTYPE html>` + `content-type: text/html`); `fragmentResponse` constructs a DOCTYPE-less HTMX
  partial; `redirect` / `createRedirectResponse` build redirect responses.
- **HTMX status fragments** — `renderSuccess`, `renderError`, and `renderValidationErrors` produce
  ready-styled banner markup as `SafeHtml`, with every dynamic message HTML-escaped.
- **Safe HTML by construction** — the `html` tagged template auto-escapes every interpolated value;
  `rawHtml` opts a trusted string out of escaping; `SafeHtml` is a branded type so unescaped strings
  can never silently slip into output.
- **Standalone escaping** — `escapeHtml` escapes text/attribute contexts; `safeUrl` sanitizes URL
  values, collapsing `javascript:`, `data:`, and other dangerous schemes to `"#"`.
- **Typed header builders** — `ContentType`, `CacheControl`, `SetCookie`, `Accept`, `Vary`,
  `ContentDisposition`, `ContentRange`, and `Range` are typed header-value classes that build a
  correct header **value** string from structured input.
- **Path joining** — `joinPath` composes URL path segments, collapsing duplicate slashes and trimming
  a trailing slash.

---

## Usage

A route handler that renders a full page, then an action handler that returns an HTMX fragment on
success and a validation-error fragment on failure:

```ts
import {
  htmlResponse,
  fragmentResponse,
  redirect,
  renderSuccess,
  renderValidationErrors,
  html,
  CacheControl,
} from "@y-core/forge/http";

// GET /profile — full-page response with a cache header.
function profilePage(context) {
  const body = html`
    <!DOCTYPE html>
    <html lang="en">
      <body>
        <h1>Welcome, ${context.user.name}</h1>
      </body>
    </html>
  `;
  return htmlResponse(body, 200, {
    "cache-control": new CacheControl({ noStore: true }).toString(),
  });
}

// POST /profile (HTMX) — return a fragment swapped into the page, not a full document.
async function updateProfile(context) {
  const errors = validate(context.body);
  if (errors.length > 0) {
    return fragmentResponse(renderValidationErrors(errors), 422);
  }
  await saveProfile(context.body);
  return fragmentResponse(renderSuccess("Profile updated."));
}

// POST /logout — redirect after a side effect.
function logout(context) {
  destroySession(context);
  return redirect("/", 303);
}
```

Because the `html` tag escapes interpolations automatically, `${context.user.name}` is safe even if
the name contains `<` or `&`. To embed already-trusted markup (e.g. output from another renderer),
wrap it with `rawHtml`:

```ts
import { html, rawHtml } from "@y-core/forge/http";

const trusted = rawHtml("<strong>Hello</strong>"); // marked SafeHtml — not re-escaped
const body = html`<div>${trusted} and ${userInput}</div>`; // userInput IS escaped
```

---

## Core Components & APIs

### Full-page responses — `htmlResponse`

```ts
function htmlResponse(
  body: string | SafeHtml,
  status?: number,
  headers?: Record<string, string>,
): Response;
```

Constructs a full-page HTML `Response`, guaranteeing a leading `<!DOCTYPE html>` and a
`content-type: text/html; charset=utf-8` header. Accepts a `SafeHtml` value (e.g. from a renderer) or
a plain string. For HTMX partials that must **not** carry a DOCTYPE, use `fragmentResponse` instead.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `body` | `string \| SafeHtml` | — | The page markup. A leading DOCTYPE is ensured. |
| `status` | `number` | `200` | HTTP status code. |
| `headers` | `Record<string, string>` | — | Extra headers, merged into the response. `content-type` always wins over any caller-supplied value. |

### Fragment responses — `fragmentResponse`

```ts
function fragmentResponse(
  body: string | SafeHtml,
  status?: number,
  headers?: Record<string, string>,
): Response;
```

Constructs an HTML **fragment** `Response` (an HTMX partial) with `content-type: text/html;
charset=utf-8`. No DOCTYPE is added — fragments are swapped into an existing document by HTMX. Accepts
a `SafeHtml` value or a string. Use `htmlResponse` for full documents.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `body` | `string \| SafeHtml` | — | The fragment markup (no DOCTYPE). |
| `status` | `number` | `200` | HTTP status code. |
| `headers` | `Record<string, string>` | — | Extra headers, merged into the response. |

### Redirects — `redirect`, `createRedirectResponse`

```ts
function redirect(url: string, status?: number, headers?: Record<string, string>): Response;
function createRedirectResponse(url: string, status?: number, headers?: Record<string, string>): Response;
```

`redirect` is an alias of `createRedirectResponse`. Both build a redirect `Response` with the
`Location` header set to `url`. The default status is `302`; pass `303` (See Other) after a successful
form POST or `301`/`307`/`308` as appropriate.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | The redirect target (the `Location` header value). |
| `status` | `number` | `302` | Redirect status code. |
| `headers` | `Record<string, string>` | — | Extra headers (e.g. `Set-Cookie`) merged into the response. |

```ts
import { redirect, SetCookie } from "@y-core/forge/http";

return redirect("/dashboard", 303, {
  "set-cookie": new SetCookie({ name: "flash", value: "saved" }).toString(),
});
```

### HTMX status fragments — `renderSuccess`, `renderError`, `renderValidationErrors`

```ts
function renderSuccess(message: string, options?: FragmentOptions): SafeHtml;
function renderError(message: string, options?: FragmentOptions): SafeHtml;
function renderValidationErrors(errors: string[], options?: FragmentOptions): SafeHtml;
```

Each renders a pre-styled banner as `SafeHtml`, with every dynamic value HTML-escaped. They return
markup, not a `Response` — wrap the result in `fragmentResponse` to send it:

```ts
import { fragmentResponse, renderError, renderValidationErrors } from "@y-core/forge/http";

return fragmentResponse(renderError("Could not save your changes."), 500);

return fragmentResponse(
  renderValidationErrors(["Email is required.", "Password is too short."]),
  422,
);
```

- `renderSuccess` renders an emerald success banner. It stamps a marker attribute (default
  `data-success`) on the wrapper so client code / tests can target it.
- `renderError` renders a red error banner with the escaped message.
- `renderValidationErrors` renders a red banner containing a `<ul>` of per-error `<li>` items, each
  message escaped, under a fixed `"Please correct the following fields."` heading.

**`FragmentOptions`:**

| Field | Type | Default | Applies to | Description |
|---|---|---|---|---|
| `class` | `string` | banner-specific Tailwind classes | all three | Overrides the wrapper `<div>` class. |
| `successAttr` | `string` | `"data-success"` | `renderSuccess` | Marker attribute name on the success wrapper. Must match `^[A-Za-z_][A-Za-z0-9_-]*$`, else `renderSuccess` throws. |
| `ulClass` | `string` | `"mt-2 list-disc pl-5"` | `renderValidationErrors` | Class of the inner `<ul>`. |

### Safe HTML — `html`, `rawHtml`, `isSafeHtml`, `SafeHtml`

```ts
const html: HtmlTemplateTag;
function rawHtml(s: string): SafeHtml;
function isSafeHtml(value: unknown): value is SafeHtml;
```

`SafeHtml` is a **branded string type** representing HTML that is safe to emit without further
escaping. It can only be produced through this toolkit — never by an ordinary string assignment.

- **`html`** is a tagged template literal. Every `${…}` interpolation is HTML-escaped **unless** the
  value is already `SafeHtml` (e.g. a nested `html` result or a `rawHtml` value), which is inlined
  verbatim. The result is `SafeHtml`.
- **`rawHtml(s)`** marks a trusted string as `SafeHtml` so the `html` tag will inline it without
  escaping. Use it **only** for content you fully control — never for user input. (It replaces the
  older `html.raw(str)` form.)
- **`isSafeHtml(value)`** is a type guard that returns `true` for values produced by `html` / `rawHtml`.

```ts
import { html, rawHtml, isSafeHtml } from "@y-core/forge/http";

const safe = html`<p>${userComment}</p>`;          // userComment escaped → SafeHtml
const heading = rawHtml("<h2>Trusted heading</h2>"); // opt-out for trusted markup
isSafeHtml(safe);   // true
isSafeHtml("<b>");  // false — a bare string is never SafeHtml
```

### Standalone escaping — `escapeHtml`, `safeUrl`

```ts
function escapeHtml(str: string): string;
function safeUrl(value: string): string;
```

`escapeHtml` escapes `&`, `<`, `>`, `"`, and `'` for safe embedding in HTML **text nodes** and
**double-quoted attribute values**. Use it in non-template contexts (error pages, emails, hand-built
fragments) where the `html` tag is not in play.

> `escapeHtml` is **not** sufficient for URL attributes (`href`, `src`, `action`) or inline
> JavaScript. URL values require scheme sanitization via `safeUrl`; the result of `safeUrl` should
> then be passed through `escapeHtml` before embedding.

`safeUrl` sanitizes a URL for use in `href`/`src`-style attributes:

| Input shape | Result |
|---|---|
| Relative / scheme-less URL (`/path`, `page.html`) | passes through unchanged |
| `http:`, `https:`, `mailto:`, `tel:` absolute URL | passes through unchanged |
| `javascript:`, `vbscript:`, `data:`, or any other scheme | collapses to `"#"` |
| Protocol-relative (`//host`, `\\host`) | collapses to `"#"` |

It defeats obfuscation via leading/embedded whitespace, control characters, and mixed case. The caller
remains responsible for HTML-escaping the returned value.

```ts
import { escapeHtml, safeUrl } from "@y-core/forge/http";

const href = escapeHtml(safeUrl(userSuppliedUrl)); // sanitize scheme, then escape for the attribute
const link = `<a href="${href}">link</a>`;
```

### Typed header builders — `ContentType`, `CacheControl`, `SetCookie`, and more

Each builder is a **class** that constructs a typed header **value** from structured input (or from a
raw string). Instantiate with `new`, passing the corresponding `*Init` object, then stringify with
`.toString()` (or `String(...)`) to obtain the header value. They do **not** return a `Headers` object
— pass the stringified value as a header value in a `Response` init or into `htmlResponse` /
`fragmentResponse` / `redirect`.

| Builder | Init type | Builds the value for | Example init fields |
|---|---|---|---|
| `ContentType` | `ContentTypeInit` | `Content-Type` | `mediaType`, `charset`, `boundary` |
| `CacheControl` | `CacheControlInit` | `Cache-Control` | `maxAge`, `sMaxage`, `noStore`, `noCache`, `public` |
| `SetCookie` | `SetCookieInit` | `Set-Cookie` | `name`, `value`, `path`, `httpOnly`, `secure`, `sameSite`, `maxAge` |
| `Accept` | `AcceptInit` | `Accept` | media-type preferences |
| `Vary` | `VaryInit` | `Vary` | header names |
| `ContentDisposition` | `ContentDispositionInit` | `Content-Disposition` | `type`, `filename` |
| `ContentRange` | `ContentRangeInit` | `Content-Range` | `start`, `end`, `size` |
| `Range` | `RangeInit` | `Range` | byte ranges |

```ts
import { fragmentResponse, ContentType, CacheControl } from "@y-core/forge/http";

return fragmentResponse(body, 200, {
  "content-type": new ContentType({ mediaType: "text/html", charset: "utf-8" }).toString(),
  "cache-control": new CacheControl({ maxAge: 3600, public: true }).toString(),
});
```

Each builder also exposes a static `from(value)` that parses an existing header value (string or init)
into an instance.

> For application cookies prefer `createCookie` from `@y-core/forge/session`, which handles
> parsing/serialization and signing. Reach for the low-level `SetCookie` builder only when
> constructing raw header values by hand.

### Path joining — `joinPath`

```ts
function joinPath(base: string, ...segments: string[]): string;
```

Joins a base path with zero or more segments into a clean URL path: it collapses duplicate slashes
between parts, trims a trailing slash, and preserves a leading slash when `base` has one.

| Parameter | Type | Description |
|---|---|---|
| `base` | `string` | The base path; a leading `/` is preserved in the result. |
| `segments` | `string[]` | Additional segments to append. |

```ts
import { joinPath } from "@y-core/forge/http";

joinPath("/showcase/");                       // "/showcase"
joinPath("/showcase/ui/api", "preview");      // "/showcase/ui/api/preview"
joinPath("showcase", "ui", "preview");        // "showcase/ui/preview" (no leading slash)
```

### Types

| Type | Description |
|---|---|
| `SafeHtml` | Branded string for HTML safe to emit without further escaping; produced only via `html` / `rawHtml`. |
| `HtmlTemplateTag` | The signature of the `html` tagged-template function. |
| `FragmentOptions` | `{ class?, successAttr?, ulClass? }` for the `render*` fragment helpers. |
| `ContentTypeInit` | Structured input for `ContentType`. |
| `CacheControlInit` | Structured input for `CacheControl`. |
| `SetCookieInit` | Structured input for `SetCookie`. |
| `AcceptInit` | Structured input for `Accept`. |
| `VaryInit` | Structured input for `Vary`. |
| `ContentDispositionInit` | Structured input for `ContentDisposition`. |
| `ContentRangeInit` | Structured input for `ContentRange`. |
| `RangeInit` | Structured input for `Range`. |

---

## Security

- **Prefer the `html` tag and `render*` helpers over hand-built strings.** They escape interpolated
  values by default; raw template literals do not. When you must build markup by hand, run every
  dynamic value through `escapeHtml`.
- **`rawHtml` is an escaping opt-out — use it only for trusted content.** Passing user input through
  `rawHtml` (or any unescaped interpolation) reintroduces XSS. `SafeHtml` is branded precisely so
  unescaped strings cannot reach output by accident.
- **Sanitize URL attribute values with `safeUrl` before escaping.** `escapeHtml` alone does not block
  `javascript:` / `data:` URLs in `href`/`src`/`action`; `safeUrl` collapses dangerous schemes to
  `"#"`. Apply `safeUrl` first, then `escapeHtml` the result.
- **`successAttr` is validated, not escaped.** `renderSuccess` rejects an attribute name that is not a
  valid HTML identifier (`^[A-Za-z_][A-Za-z0-9_-]*$`) by throwing. Keep `successAttr` developer-supplied
  configuration — never derive it from request input.
