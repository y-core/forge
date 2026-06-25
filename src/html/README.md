# `@y-core/forge/html`

Server-side HTMX utilities for Forge apps on Cloudflare Workers: request-header detection, response-header builders, JSX attribute helpers, and pre-built interaction patterns.

> **There is no top-level `@y-core/forge/html` export.** The only public entry point in this namespace is **`@y-core/forge/html/htmx`** (`src/html/htmx/mod.ts`). Import every symbol below from that path:
>
> ```ts
> import { isHxRequest, hxHeaders, hxAttrs, liveSearch } from "@y-core/forge/html/htmx";
> ```

This namespace runs **server-side only** (SSR / Workers). It reads inbound `HX-*` request headers, writes outbound `HX-*` response headers, and emits `hx-*` attributes into SSR JSX. It never runs in the browser — the HTMX client library handles the wire on the other side.

---

## Features

| Feature | Entry point |
|---|---|
| HTMX request detection | `isHxRequest` |
| Typed inbound-header reader | `readHxRequest`, `HxRequest` |
| Individual request-header accessors | `hxTrigger`, `hxTarget`, `hxTriggerName`, `hxCurrentUrl`, `isPartial`, `isBoosted` |
| Response-header builder | `hxHeaders`, `HxResponseProps`, `HxResponseHeaders` |
| JSX attribute builder | `hxAttrs`, `HxAttrsProps`, `HxAttrs` |
| Swap-strategy constants | `SWAP` |
| Interaction patterns | `formSubmit`, `liveSearch`, `inlineValidation`, `infiniteScroll`, `paginatedTableLink`, `asyncDialogTrigger`, `dependentSelect`, `oobSwap`, `oobAppend` |

The request readers accept a `RequestContext` from `@remix-run/fetch-router` (the `c` you already have inside a route handler or middleware). The builders and patterns take plain typed props and return plain maps (`Record<string, string>`), so they are pure and trivially testable.

---

## Usage

A typical HTMX route reads the inbound headers to decide between a full page and a fragment, mutates state, then returns a fragment plus outbound `HX-*` headers:

```ts
import { isHxRequest, hxHeaders } from "@y-core/forge/html/htmx";
import { fragmentResponse, htmlResponse } from "@y-core/forge/http";

export async function searchHandler(c) {
  const results = await runSearch(c);

  // Browser navigation (or a direct hit) → full page.
  if (!isHxRequest(c)) {
    return htmlResponse(renderPage(results));
  }

  // HTMX partial → fragment + push the query into history.
  return fragmentResponse(renderResults(results), 200, hxHeaders({ pushUrl: c.request.url }));
}
```

In SSR JSX, build the `hx-*` attributes with `hxAttrs` or a pattern helper and spread them onto the element:

```tsx
import { hxAttrs, liveSearch } from "@y-core/forge/html/htmx";

function SearchBox() {
  return (
    <form {...hxAttrs({ post: "/api/contact", target: "#result", swap: "outerHTML" })}>
      <input name="q" {...liveSearch({ get: "/search", target: "#results" })} />
      <div id="results" />
    </form>
  );
}
```

---

## Core Components & APIs

### Request detection — `isHxRequest`

```ts
function isHxRequest(c: RequestContext): boolean;
```

Returns `true` when the request carries an `HX-Request: true` header — i.e. it originated from the HTMX client rather than a normal browser navigation.

> **Security note.** `HX-Request` is a client-supplied header; any caller can set it. `isHxRequest` is a **UX routing hint, not a security boundary.** It tells you *how to render*, never *whether the caller is allowed*. For any mutation route, combine it with origin verification (`verifyOrigin` / `originGuard` from `@y-core/forge/security`) and CSRF verification (`csrfProtection` from `@y-core/forge/form`). See [Integration Guide](#integration-guide).

### Inbound header reader — `readHxRequest`

```ts
function readHxRequest(c: RequestContext): HxRequest;
```

Parses every inbound `HX-*` request header into one typed struct.

```ts
interface HxRequest {
  enabled: boolean;    // HX-Request === "true"
  boosted: boolean;    // HX-Boosted === "true"
  trigger: string;     // HX-Trigger        (id of the triggering element, or "")
  target: string;      // HX-Target         (id of the hx-target element, or "")
  triggerName: string; // HX-Trigger-Name   (name attr of the triggering element, or "")
  currentUrl: string;  // HX-Current-URL    (browser URL at request time, or "")
}
```

String fields default to `""` when the header is absent.

### Individual request accessors

Use these when you only need one header; each reads a single inbound `HX-*` header off `c.request`.

| Function | Reads header | Returns |
|---|---|---|
| `hxTrigger(c)` | `HX-Trigger` | `string` (id of the triggering element, or `""`) |
| `hxTarget(c)` | `HX-Target` | `string` (id of the swap target, or `""`) |
| `hxTriggerName(c)` | `HX-Trigger-Name` | `string` (name of the triggering element, or `""`) |
| `hxCurrentUrl(c)` | `HX-Current-URL` | `string` (browser URL, or `""`) |
| `isBoosted(c)` | `HX-Boosted` | `boolean` (request came from `hx-boost`) |
| `isPartial(c)` | `HX-Request` + `HX-Boosted` | `boolean` (HTMX request **and not** boosted) |

`isPartial` is the right predicate when boosted navigations should still receive a full page: it returns `true` only for genuine partial swaps, excluding `hx-boost` navigations.

```ts
import { isPartial } from "@y-core/forge/html/htmx";

if (isPartial(c)) {
  return fragmentResponse(renderFragment(data)); // non-boosted HTMX swaps only
}
return htmlResponse(renderPage(data));           // direct hits and boosted navigation
```

### Response-header builder — `hxHeaders`

```ts
function hxHeaders(props: HxResponseProps): HxResponseHeaders; // = Record<string, string>
```

Builds a map of outbound `HX-*` response headers to spread into `fragmentResponse` / `htmlResponse`. Every prop is optional; `undefined` and empty-string values are omitted. `refresh` only emits a header when `true`.

| Prop | Type | Header | Effect |
|---|---|---|---|
| `redirect` | `string` | `HX-Redirect` | Client-side redirect to the URL |
| `refresh` | `boolean` | `HX-Refresh` | Force a full page refresh (emitted only when `true`) |
| `pushUrl` | `string` | `HX-Push-Url` | Push the URL onto browser history |
| `replaceUrl` | `string` | `HX-Replace-Url` | Replace the current history entry |
| `trigger` | `string` | `HX-Trigger` | Fire client-side event(s) immediately |
| `triggerAfterSettle` | `string` | `HX-Trigger-After-Settle` | Fire event(s) after the settle step |
| `triggerAfterSwap` | `string` | `HX-Trigger-After-Swap` | Fire event(s) after the swap step |
| `retarget` | `string` | `HX-Retarget` | Override the swap target (CSS selector) |
| `reswap` | `string` | `HX-Reswap` | Override the swap strategy |

```ts
import { hxHeaders } from "@y-core/forge/html/htmx";
import { fragmentResponse } from "@y-core/forge/http";

// Redirect the browser after a successful action.
return fragmentResponse("", 200, hxHeaders({ redirect: "/dashboard" }));

// Push a URL and fire a client event in one response.
return fragmentResponse(body, 200, hxHeaders({ pushUrl: "/results?q=hello", trigger: "resultsLoaded" }));
```

### Attribute builder — `hxAttrs`

```ts
function hxAttrs(props: HxAttrsProps): HxAttrs; // = Record<string, string>
```

Converts a typed, camelCased props object into a flat `hx-*` attribute map for spreading onto a JSX element. `undefined` and empty-string values are omitted.

```tsx
<form {...hxAttrs({ post: "/api/contact", target: "#result", swap: "outerHTML" })} />
// → hx-post="/api/contact" hx-target="#result" hx-swap="outerHTML"
```

| Prop | Attribute | Prop | Attribute |
|---|---|---|---|
| `get` | `hx-get` | `sync` | `hx-sync` |
| `post` | `hx-post` | `confirm` | `hx-confirm` |
| `put` | `hx-put` | `encoding` | `hx-encoding` |
| `patch` | `hx-patch` | `pushUrl` | `hx-push-url` |
| `delete` | `hx-delete` | `replaceUrl` | `hx-replace-url` |
| `target` | `hx-target` | `params` | `hx-params` |
| `swap` | `hx-swap` | `include` | `hx-include` |
| `select` | `hx-select` | `indicator` | `hx-indicator` |
| `selectOob` | `hx-select-oob` | `disabledElt` | `hx-disabled-elt` |
| `trigger` | `hx-trigger` | | |

Three props are encoded specially:

| Prop | Type | Output | Notes |
|---|---|---|---|
| `values` | `Record<string, string>` | `hx-vals` (JSON) | Omitted when the map is empty |
| `headers` | `Record<string, string>` | `hx-headers` (JSON) | Omitted when the map is empty |
| `boost` | `boolean` | `hx-boost` (`"true"` / `"false"`) | Emitted whenever defined |

### Swap-strategy constants — `SWAP`

`SWAP` provides the canonical HTMX swap-strategy strings so call sites avoid stringly-typed literals:

| Constant | Value |
|---|---|
| `SWAP.innerHtml` | `"innerHTML"` |
| `SWAP.outerHtml` | `"outerHTML"` |
| `SWAP.beforeEnd` | `"beforeend"` |
| `SWAP.afterEnd` | `"afterend"` |
| `SWAP.beforeBegin` | `"beforebegin"` |
| `SWAP.delete` | `"delete"` |
| `SWAP.none` | `"none"` |

```ts
import { hxAttrs, SWAP } from "@y-core/forge/html/htmx";

hxAttrs({ get: "/rows", target: "#list", swap: SWAP.beforeEnd });
```

### Interaction patterns

Each pattern returns an `HxAttrs` map (spread directly onto the triggering element) with sensible defaults baked in. Every default is overridable via the matching prop.

| Pattern | Required props | Defaults | Notes |
|---|---|---|---|
| `formSubmit` | `post`, `target` | `swap=outerHTML`, `disabledElt=this` | Optional `encoding`, `pushUrl` |
| `liveSearch` | `get`, `target` | `swap=innerHTML`, `trigger="input changed delay:300ms, search"` | Optional `pushUrl` |
| `inlineValidation` | `get`, `target` | `swap=outerHTML`, `trigger="change delay:200ms, blur"`, `sync="closest form:abort"` | |
| `infiniteScroll` | `get`, `target` | `swap=beforeend`, `trigger="revealed"` | `trigger` always `revealed`; optional `select` |
| `paginatedTableLink` | `get`, `target`, `page` | `swap=outerHTML` | Builds `?page=N`; optional `pageParam`, `query` |
| `dependentSelect` | `get`, `target` | `swap=outerHTML`, `trigger="change"` | |
| `asyncDialogTrigger` | `get`, `target`, `dialogId` | `swap=innerHTML` | Also emits `data-dialog-open`, `aria-haspopup="dialog"`, `aria-controls` |

```tsx
import { formSubmit, liveSearch, infiniteScroll, paginatedTableLink } from "@y-core/forge/html/htmx";

<form {...formSubmit({ post: "/api/contact", target: "#contact-result" })} />

<input {...liveSearch({ get: "/search", target: "#results" })} />

<div {...infiniteScroll({ get: "/items?page=2", target: "#item-list" })} />

<a {...paginatedTableLink({ get: "/items", target: "#table", page: 3 })} />
// → hx-get="/items?page=3" ...  (existing query params preserved)
```

#### Out-of-band helpers — `oobSwap`, `oobAppend`

```ts
function oobSwap(props: { strategy?: string; selector?: string }): HxAttrs;
function oobAppend(selector: string): HxAttrs;
```

These emit an `hx-swap-oob` attribute so a fragment in the response is swapped out-of-band into a *different* element than the request's primary target.

```tsx
// Replace the element with id="cart-count" wherever it lives in the document.
<span id="cart-count" {...oobSwap({ selector: "#cart-count" })}>{count}</span>

// Append a new row out-of-band to #notifications.
<li {...oobAppend("#notifications")}>New message</li>
```

`oobSwap` defaults `strategy` to `"true"`; supplying a `selector` produces `strategy:selector` (and promotes the bare `"true"` default to `"outerHTML"`). `oobAppend(selector)` is shorthand for `oobSwap({ strategy: "beforeend", selector })`.

---

## Integration Guide

### Pair detection with real security guards

`isHxRequest` decides *rendering*, never *authorization*. A mutation route (`POST`/`PUT`/`PATCH`/`DELETE`) must verify origin and CSRF **before** trusting the request, then use `isHxRequest` only to shape the response:

```ts
import { isHxRequest } from "@y-core/forge/html/htmx";
import { verifyOrigin } from "@y-core/forge/security";

const contactGuard = async (context, next) => {
  // 1. Real boundary: same-origin check.
  if (!verifyOrigin(context.request, allowedOrigins).ok) {
    return new Response("Forbidden", { status: 403 });
  }
  // 2. UX hint: this endpoint only serves the HTMX flow.
  if (!isHxRequest(context)) {
    return new Response("Forbidden", { status: 403 });
  }
  return next();
};
// 3. Apply CSRF verification (csrfProtection from @y-core/forge/form) as a
//    separate middleware in the chain — token checks live in the form namespace.
```

### Returning fragments from `@y-core/forge/http`

The response builders pair with `fragmentResponse` (HTMX partial, no `<!DOCTYPE>`) and `htmlResponse` (full page). Spread `hxHeaders(...)` as the third argument:

```ts
import { fragmentResponse } from "@y-core/forge/http";
import { hxHeaders } from "@y-core/forge/html/htmx";

return fragmentResponse(renderRow(item), 200, hxHeaders({ trigger: "rowAdded" }));
```

### Cloudflare Turnstile CSP

If an HTMX form posts to a route protected by Cloudflare Turnstile, the Turnstile widget and its challenge endpoint must be allowed by your Content-Security-Policy. Add `TURNSTILE_CSP` (from `@y-core/forge/security`) to the relevant CSP directives when building headers:

```ts
import { makeSecurityHeaders, NONCE, TURNSTILE_CSP } from "@y-core/forge/security";

makeSecurityHeaders({
  scriptSrc:  ["'self'", NONCE, TURNSTILE_CSP],
  connectSrc: ["'self'", TURNSTILE_CSP],
  frameSrc:   ["'self'", TURNSTILE_CSP],
});
```

Without these CSP sources the Turnstile iframe and its verification calls are blocked, and the form submission silently fails the challenge.

---

## See also

- [`@y-core/forge/http`](../http/) — `fragmentResponse`, `htmlResponse`, redirect helpers
- [`@y-core/forge/security`](../security/) — origin verification, CSP headers, `TURNSTILE_CSP`
- [`@y-core/forge/form`](../form/) — CSRF token minting and verification
