---
title: Server-Side HTMX Utilities
description: "Read the inbound HX-* headers to decide what to render, emit hx-* attributes into SSR JSX, and answer with HX-* directives and status banners."
audience: consumer
---

# `@y-core/forge/render/htmx`

htmx has two halves. The client library owns the browser half; this namespace owns the server half — reading the `HX-*` headers htmx sends,
emitting the `hx-*` attributes it reads back, and returning the `HX-*` response directives and status banners that answer a swap.

Everything here runs inside the Worker during SSR. Nothing in it is meant for, or usable from, the browser.

```ts
import { hxAttrs, hxHeaders, isPartial, liveSearch, SWAP } from "@y-core/forge/render/htmx";
```

---

## Getting started

A typical htmx route answers the same URL two ways: a whole page for a navigation, a fragment for a swap. Ask `isPartial` which one the request
wants, render, then attach any response directives:

```ts
import { hxHeaders, isPartial } from "@y-core/forge/render/htmx";
import { fragmentResponse, htmlResponse } from "@y-core/forge/http";

export async function search(c) {
  const results = await runSearch(c);

  if (!isPartial(c)) return htmlResponse(await renderPage(results));

  return fragmentResponse(await renderResults(results), 200, hxHeaders({ pushUrl: c.request.url }));
}
```

On the markup side, build the attributes with `hxAttrs` — or with one of the interaction patterns — and spread them onto the element:

```tsx
import { hxAttrs, liveSearch } from "@y-core/forge/render/htmx";

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

**Choose between a page and a fragment with `isPartial(c)`.** It is true only for an htmx request that asked for a fragment. htmx also sends
`HX-Request: true` when it needs a whole page back — a boosted navigation, and the request it makes to restore a page when the reader goes back —
so `isHxRequest` alone would answer those with a fragment and htmx would put it where the body was. Why `isPartial` reads `HX-Request-Type` is
[`HTMX.md`][htmx-10] §10's.

```ts
if (isPartial(c)) return fragmentResponse(await renderFragment(data));
return htmlResponse(await renderPage(data));
```

The other two predicates answer narrower questions:

- `isHxRequest(c)` — the request came from htmx at all, whatever it will do with the response.
- `isBoosted(c)` — the request came from a boosted link or form, when that case needs handling of its own.

When the response depends on more than a yes or no, `readHxRequest(c)` returns every inbound header in one `HxRequest` object, whose type is the
reference for its fields. htmx names the `source` and `target` elements as `tag#id` — `button#save`, or a bare `form` when it has no id — so
match on that shape rather than on a bare id. The accessors `hxSource`, `hxTarget` and `hxCurrentUrl` read one header each when one is all you
need.

**None of these is an authorization check** — `HX-Request` is a client-supplied header. The ruling, and what must guard a mutation route instead,
is [`HTMX.md`][htmx-7] §7's, and the guard order is under **Security** below.

---

## Driving the browser from the response

`hxHeaders` turns typed directives into the `HX-*` response headers htmx acts on after the swap. Pass it straight to a response builder:

```ts
import { hxHeaders } from "@y-core/forge/render/htmx";
import { fragmentResponse } from "@y-core/forge/http";

return fragmentResponse(body, 200, hxHeaders({ pushUrl: "/results?q=hello", trigger: "resultsLoaded" }));
```

The directives fall into these decisions:

- **Leave the page, or stay on it.** `redirect` navigates the browser; `refresh: true` reloads the whole page, discarding the swap you would
  otherwise have sent.
- **What the back button does.** `pushUrl` adds a history entry, `replaceUrl` rewrites the current one. A live-search route wants `replaceUrl`; a
  route the user should be able to navigate back out of wants `pushUrl`.
- **Tell client code the response has landed.** `trigger` names events htmx fires once the swap is done, so a listener already sees the new DOM.
- **Overriding what the element asked for.** `retarget` redirects the swap to another selector and `reswap` changes the strategy, which is how an
  error response lands somewhere other than the element that submitted.

---

## Attaching htmx behaviour to an element

`hxAttrs` takes a typed, camelCased props object and returns a flat attribute map to spread. Each prop names the htmx attribute it becomes — `post`
becomes `hx-post`, `selectOob` becomes `hx-select-oob`.

```tsx
<form {...hxAttrs({ post: "/api/contact", target: "#result", swap: "outerHTML" })} />
// → hx-post="/api/contact" hx-target="#result" hx-swap="outerHTML"
```

A few props are not plain strings, because the attributes they produce are not: `values` and `headers` take a `Record<string, string>` and are
JSON-encoded into `hx-vals` and `hx-headers`, and `boost` takes a boolean.

**`disable` names the elements htmx disables while the request runs** — a selector, with `this` for the element itself. It becomes `hx-disable`.

**`boost` works on a container as well as on a link or form.** It emits `hx-boost:inherited`, so `hxAttrs({ boost: true })` spread on `<body>` or
`<nav>` boosts every link and form inside it. htmx 4 applies a bare attribute only to the element that carries it, which is why forge's JSX types
refuse a hand-written `hx-boost` ([`HTMX.md`][htmx-9] §9).

Use `SWAP` for the swap strategy rather than a bare string, so a typo is a compile error:

```ts
import { hxAttrs, SWAP } from "@y-core/forge/render/htmx";

hxAttrs({ get: "/rows", target: "#list", swap: SWAP.beforeEnd });
```

---

## Starting from a ready-made interaction

Each pattern returns the same attribute map `hxAttrs` does, with the defaults for that interaction already chosen. Every default is overridable by
passing the matching prop:

- `formSubmit({ post, target })` — a submitting form; disables the form itself while the request is in flight.
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

## Answering an htmx submission with a status banner

`renderSuccess`, `renderError` and `renderValidationErrors` return pre-styled banner markup as `SafeHtml` — not a `Response`. **The status goes on
`fragmentResponse`, not on the renderer** ([`FORGE_ERRORS.md`][eh-2] §2).

```ts
import { fragmentResponse } from "@y-core/forge/http";
import { renderSuccess, renderValidationErrors } from "@y-core/forge/render/htmx";

async function updateProfile(context) {
  const errors = validate(context.body);
  if (errors.length > 0) {
    return fragmentResponse(renderValidationErrors(errors), 422);
  }
  await saveProfile(context.body);
  return fragmentResponse(renderSuccess("Profile updated."));
}
```

Every dynamic message is escaped on the way in, so the error strings can come straight from a validator.

### Choosing how the banners are styled

`FragmentOptions` asks you one question: whose classes win. Leave `class` and `ulClass` alone and you get forge's status-token styling, which needs
Tailwind to have seen this directory — `forge.css` deliberately does not scan `src/render/htmx`, so add the source path to your own stylesheet:

```css
@source "../node_modules/@y-core/forge/src/render/htmx";
```

The path is relative to the stylesheet you write it in; [`forge.css`][forge-css] documents the same pattern for the other opt-in surfaces. Pass your
own `class` and `ulClass` instead and you need none of that — the defaults are never emitted.

`successAttr` is the marker attribute stamped on the success wrapper, `data-success` by default, so client code and tests can find it. It is the one
option interpolated verbatim rather than escaped; keep it a literal you wrote, never anything derived from a request.
[`FORGE_ERRORS.md`][eh-2d] §2d owns why the two option kinds differ, and `renderSuccess` throws on a name that is not a valid HTML identifier.

---

## Security

### Guard the route, then shape the response

`isPartial` and its siblings decide _how to render_, never _whether the caller is allowed_ — any client can set `HX-Request: true`
([`HTMX.md`][htmx-7] §7). A mutation route gets a real guard first, and the htmx predicate only afterwards:

```ts
import { isPartial } from "@y-core/forge/render/htmx";
import { originProtection } from "@y-core/forge/security";

app.use("/form/*", originProtection({ allowedOrigins: config.allowedOrigins }));
// plus csrfProtection from `@y-core/forge/form` on routes that accept a form body

export const handler = (c) => (isPartial(c) ? fragmentResponse(fragment) : htmlResponse(page));
```

Which origin guard to reach for is [`SECURITY_HARDENING.md`][sh-3e] §3e's; the token half is the `form` namespace's.

### Selector, expression and JSON values must be developer-supplied

Every value passed to `hxAttrs` and to the pattern helpers is emitted exactly as written. Selectors (`target`, `select`, `selectOob`, `include`,
`indicator`, `disable`), trigger and `sync` expressions, the JSON in `values` and `headers`, and the URLs of the verbs are all unsanitized by
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
- [`src/http/README.md`][http-readme] — `fragmentResponse`, `htmlResponse` and the redirect builders these headers and banners ride on
- [`src/render/jsx/README.md`][jsx-readme] — the SSR renderer these attributes are spread into
- [`src/security/README.md`][security-readme] — origin protection, CSP headers and `TURNSTILE_CSP`
- [`docs/FORGE_ERRORS.md`][eh] — the banner renderers' contract and where the status goes (§2), and the option-escaping split (§2d)
- [`docs/HTMX.md`][htmx] — the trust posture on emitted values (§7, §7a, §7b), the `isHxRequest` not-a-boundary ruling (§7), the
  form-independent `sync` default (§8), explicit inheritance (§9), and why `isPartial` reads `HX-Request-Type` (§10)

[eh]: ../../../docs/FORGE_ERRORS.md
[eh-2]: ../../../docs/FORGE_ERRORS.md#2-fragment-renderers-renderhtmx-namespace
[eh-2d]: ../../../docs/FORGE_ERRORS.md#2d-fragment-options-and-escaping
[forge-css]: ../../ui/assets/css/forge.css
[form-readme]: ../../form/README.md
[htmx]: ../../../docs/HTMX.md
[htmx-10]: ../../../docs/HTMX.md#10-a-page-or-a-fragment--ispartial-reads-hx-request-type
[htmx-7]: ../../../docs/HTMX.md#7-trust-posture--selectors-and-json-values-must-be-developer-supplied
[htmx-7b]: ../../../docs/HTMX.md#7b-what-htmx-evaluates-hx-on-and-a-js-prefixed-hx-vals-or-hx-headers
[htmx-8]: ../../../docs/HTMX.md#8-the-form-independent-sync-default
[htmx-9]: ../../../docs/HTMX.md#9-inheritance-is-explicit--hxattrs-emits-hx-boostinherited
[http-readme]: ../../http/README.md
[jsx-readme]: ../jsx/README.md
[security-readme]: ../../security/README.md
[sh-3e]: ../../../docs/SECURITY_HARDENING.md#3e-origin-guard-tiering--which-guard-when
