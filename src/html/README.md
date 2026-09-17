---
title: Server-Side HTMX Utilities
description: "Read the inbound HX-* headers to decide what to render, emit hx-* attributes into SSR JSX, and answer with HX-* response directives."
audience: consumer
---

# `@y-core/forge/html`

htmx has two halves. The client library owns the browser half; this namespace owns the server half — reading the `HX-*` headers htmx sends,
emitting the `hx-*` attributes it reads back, and returning the `HX-*` response directives that drive the browser after a swap.

Everything here runs inside the Worker during SSR. Nothing in it is meant for, or usable from, the browser.

```ts
import { hxAttrs, hxHeaders, isHxRequest, liveSearch, SWAP } from "@y-core/forge/html/htmx";
```

`@y-core/forge/html/htmx` is the namespace's only entry point; there is no top-level `@y-core/forge/html` export to import from.

---

## Getting started

A typical htmx route answers the same URL two ways: a whole page for a browser navigation, a fragment for a swap. Read the request to pick, render,
then attach any response directives:

```ts
import { hxHeaders, isHxRequest } from "@y-core/forge/html/htmx";
import { fragmentResponse, htmlResponse } from "@y-core/forge/http";

export async function search(c) {
  const results = await runSearch(c);

  if (!isHxRequest(c)) return htmlResponse(await renderPage(results));

  return fragmentResponse(await renderResults(results), 200, hxHeaders({ pushUrl: c.request.url }));
}
```

On the markup side, build the attributes with `hxAttrs` — or with one of the interaction patterns — and spread them onto the element:

```tsx
import { hxAttrs, liveSearch } from "@y-core/forge/html/htmx";

function SearchBox() {
  return (
    <form {...hxAttrs({ post: "/api/contact", target: "#result", swap: "outerHTML" })}>
      <input name='q' {...liveSearch({ get: "/search", target: "#results" })} />
      <div id='results' />
    </form>
  );
}
```

---

## Deciding what to render

The choice between these predicates is about `hx-boost`:

- `isHxRequest(c)` — the request came from htmx at all, boosted navigations included.
- `isPartial(c)` — an htmx request that is **not** boosted. This is the one to use when boosted navigations should still receive a whole page,
  which is what `hx-boost` is for.
- `isBoosted(c)` — the boosted case on its own, when it needs handling of its own.

```ts
if (isPartial(c)) return fragmentResponse(await renderFragment(data));
return htmlResponse(await renderPage(data));
```

When the response depends on more than a yes or no, `readHxRequest(c)` returns every inbound header in one `HxRequest` object — which element fired,
which element is the swap target, that element's `name`, and the browser URL at request time. The individual accessors `hxTrigger`, `hxTarget`,
`hxTriggerName` and `hxCurrentUrl` read one header each when one is all you need.

**None of these is an authorization check** — `HX-Request` is a client-supplied header. The ruling, and what must guard a mutation route instead,
is [`HTMX.md`][htmx-7] §7's, and the guard order is under **Security** below.

---

## Driving the browser from the response

`hxHeaders` turns typed directives into the `HX-*` response headers htmx acts on after the swap. Pass it straight to a response builder:

```ts
import { hxHeaders } from "@y-core/forge/html/htmx";
import { fragmentResponse } from "@y-core/forge/http";

return fragmentResponse(body, 200, hxHeaders({ pushUrl: "/results?q=hello", trigger: "resultsLoaded" }));
```

The directives fall into four decisions:

- **Leave the page, or stay on it.** `redirect` navigates the browser; `refresh: true` reloads the whole page, discarding the swap you would
  otherwise have sent.
- **What the back button does.** `pushUrl` adds a history entry, `replaceUrl` rewrites the current one. A live-search route wants `replaceUrl`; a
  route the user should be able to navigate back out of wants `pushUrl`.
- **When client-side events fire.** `trigger` fires immediately, `triggerAfterSettle` after htmx settles the swapped content, `triggerAfterSwap`
  after the swap itself — reach past `trigger` only when the listener needs the new DOM in place.
- **Overriding what the element asked for.** `retarget` redirects the swap to another selector and `reswap` changes the strategy, which is how an
  error response lands somewhere other than the element that submitted.

---

## Attaching htmx behaviour to an element

`hxAttrs` takes a typed, camelCased props object and returns a flat attribute map to spread. Each prop names the htmx attribute it becomes:
`get`/`post`/`put`/`patch`/`delete` for the verb and URL, `target`, `swap`, `trigger`, `select`, `selectOob`, `include`, `indicator`, `disabledElt`,
`sync`, `confirm`, `encoding`, `pushUrl`, `replaceUrl` and `params` for the rest.

```tsx
<form {...hxAttrs({ post: "/api/contact", target: "#result", swap: "outerHTML" })} />
// → hx-post="/api/contact" hx-target="#result" hx-swap="outerHTML"
```

A few props are not plain strings, because the attributes they produce are not: `values` and `headers` take a `Record<string, string>` and are
JSON-encoded into `hx-vals` and `hx-headers`, and `boost` takes a boolean.

Use `SWAP` for the swap strategy rather than a bare string, so a typo is a compile error:

```ts
import { hxAttrs, SWAP } from "@y-core/forge/html/htmx";

hxAttrs({ get: "/rows", target: "#list", swap: SWAP.beforeEnd });
```

---

## Starting from a ready-made interaction

Each pattern returns the same attribute map `hxAttrs` does, with the defaults for that interaction already chosen. Every default is overridable by
passing the matching prop:

- `formSubmit({ post, target })` — a submitting form; disables the trigger while the request is inflight.
- `liveSearch({ get, target })` — an input that searches as it is typed, debounced by 300ms and swapping inner HTML.
- `inlineValidation({ get, target })` — a field validated on change and blur, aborting its own inflight request.
- `infiniteScroll({ get, target })` — appends the next page when the element is revealed.
- `paginatedTableLink({ get, target, page })` — a pagination link; builds `?page=N` onto the URL, keeping any query string it already has.
- `dependentSelect({ get, target })` — a `<select>` that reloads another region when its value changes.
- `asyncDialogTrigger({ get, target, dialogId })` — a control that loads dialog content, emitting the ARIA wiring the dialog needs alongside the
  htmx attributes.

```tsx
<form {...formSubmit({ post: "/api/contact", target: "#contact-result" })} />
<a {...paginatedTableLink({ get: "/items", target: "#table", page: 3 })} />
```

`inlineValidation` aborts only the field's own request by default, not the form's. Passing `sync: "closest form:abort"` is the right call inside a
form and only there — why that is not the default is [`HTMX.md`][htmx-8] §8's.

---

## Updating a region the request did not target

An out-of-band swap lets one response update somewhere else in the document as well — a cart count, a notification list, a flash message. `oobSwap`
produces the attribute for the fragment doing the updating, and `oobAppend(selector)` is the shorthand for appending rather than replacing:

```tsx
<span id='cart-count' {...oobSwap({ selector: "#cart-count" })}>{count}</span>
<li {...oobAppend("#notifications")}>New message</li>
```

Given a `selector`, the default strategy becomes `outerHTML` — replacing the matched element. Pass `strategy` for any other htmx swap value.

---

## Security

### Guard the route, then shape the response

`isHxRequest` and its siblings decide _how to render_, never _whether the caller is allowed_ — any client can set `HX-Request: true`
([`HTMX.md`][htmx-7] §7). A mutation route gets a real guard first, and the htmx predicate only afterwards:

```ts
import { isHxRequest } from "@y-core/forge/html/htmx";
import { originProtection } from "@y-core/forge/security";

app.use("/form/*", originProtection({ allowedOrigins: config.allowedOrigins }));
// plus csrfProtection from `@y-core/forge/form` on routes that accept a form body

export const handler = (c) => (isHxRequest(c) ? fragmentResponse(fragment) : htmlResponse(page));
```

Which origin guard to reach for is [`SECURITY_HARDENING.md`][sh-3e] §3e's; the token half is the `form` namespace's.

### Selector, expression and JSON values must be developer-supplied

Every value passed to `hxAttrs` and to the pattern helpers is emitted exactly as written. Selectors (`target`, `select`, `selectOob`, `include`,
`indicator`, `disabledElt`), trigger and `sync` expressions, the JSON in `values` and `headers`, and the URLs of the verbs are all unsanitized by
design — build them from route definitions and static configuration, never from request data. The trust posture is [`HTMX.md`][htmx-7] §7's, and why
the URL-valued props are deliberately left out of `safeUrl` is §7a's.

What htmx evaluates is stricter still. An `hx-on:*` attribute, and an `hx-vals` or `hx-headers` whose value begins `js:`, are run as JavaScript
rather than read — so each may only ever be literal source you wrote ([`HTMX.md`][htmx-7b] §7b). `hxAttrs` cannot emit a `js:` value — its `values`
and `headers` are JSON-encoded — so one is always hand-written.

### Allowing Turnstile through the CSP

When an htmx form posts to a route protected by Cloudflare Turnstile, the widget and its challenge endpoint have to be permitted by your
Content-Security-Policy, or the iframe and its verification calls are blocked and the submission fails the challenge with nothing in the response to
say so. Add `TURNSTILE_CSP` to every directive it needs — `scriptSrc`, `connectSrc` and `frameSrc`:

```ts
import { createSecurityHeaders, NONCE, TURNSTILE_CSP } from "@y-core/forge/security";

createSecurityHeaders({ scriptSrc: ["'self'", NONCE, TURNSTILE_CSP], connectSrc: ["'self'", TURNSTILE_CSP], frameSrc: ["'self'", TURNSTILE_CSP] });
```

---

## Gotchas

**An empty string is the same as omitting a prop.** Both `hxAttrs` and `hxHeaders` drop `undefined` and `""`, so a value computed as empty produces
no attribute and no header rather than an empty one.

**`refresh` emits a header only when it is `true`.** `refresh: false` is not a directive to suppress a refresh — it is simply nothing.

**Absent request headers read as `""`, not `undefined`.** The string fields of `HxRequest` and the individual accessors default to the empty string,
so test them with a truthiness or an equality check rather than a `??`.

**`paginatedTableLink` keeps an absolute URL absolute.** A `get` with its own scheme and host stays that way; only a relative one is reduced to a
path and query.

---

## See also

- [`src/form/README.md`][form-readme] — CSRF token minting and verification, the other half of guarding a mutation route
- [`src/http/README.md`][http-readme] — `fragmentResponse`, `htmlResponse` and the redirect builders these headers ride on
- [`src/jsx/README.md`][jsx-readme] — the SSR renderer these attributes are spread into
- [`src/security/README.md`][security-readme] — origin protection, CSP headers and `TURNSTILE_CSP`
- [`docs/HTMX.md`][htmx] — the trust posture on emitted values (§7, §7a, §7b), the `isHxRequest` not-a-boundary ruling (§7), and the
  form-independent `sync` default (§8)

[form-readme]: ../form/README.md
[htmx]: ../../docs/HTMX.md
[htmx-7]: ../../docs/HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[htmx-7b]: ../../docs/HTMX.md#7b-what-htmx-evaluates-hx-on-and-a-js-prefixed-hx-vals-or-hx-headers
[htmx-8]: ../../docs/HTMX.md#8-the-form-independent-sync-default
[http-readme]: ../http/README.md
[jsx-readme]: ../jsx/README.md
[security-readme]: ../security/README.md
[sh-3e]: ../../docs/SECURITY_HARDENING.md#3e-origin-guard-tiering--which-guard-when
