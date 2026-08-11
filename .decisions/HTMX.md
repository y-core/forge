---
title: HTMX Integration
description: "Server-side HTMX concerns: request detection, response header helpers, attribute builders, UI patterns, and the selector trust posture."
---

# HTMX Integration

> Owns every server-side HTMX concern — request detection, response header helpers, attribute
> builders, and the pattern helpers. Import from `@y-core/forge/html/htmx`. Also owns the ruling
> that `isHxRequest` is **not** a security boundary (§2).
>
> Defers to: [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §3e and §2d for the guards that
> must accompany it and for automatic URL sanitization;
> [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the components these attributes land on.

---

## 0. Quick Reference

- §1 html/htmx Namespace Exports: the full export list by group
- §2 isHxRequest — Detection and UX-Guard Caveat: the not-a-boundary ruling
- §3 Request Readers: `readHxRequest`, `isPartial`, `isBoosted`, header accessors
- §4 hxHeaders — Response Header Builder: props to `HX-*` response headers
- §5 hxAttrs — Attribute Builder: typed props to `hx-*` attributes
- §6 Patterns: prebuilt `HxAttrs` bundles for common interactions
- §6a formSubmit: form post with disable-on-submit
- §6b liveSearch: debounced search-as-you-type
- §6c inlineValidation: per-field validation on change and blur
- §6d infiniteScroll: reveal-triggered append
- §6e paginatedTableLink: page-parameter URL building
- §6f OOB Helpers: out-of-band swap attributes
- §7 Trust Posture: selector and JSON values must be developer-supplied
- §7a URL-Valued hx Attributes Are Deliberately Unsanitized: why `"#"` is the wrong refusal here
- §7b hx-on:* Is the One Family htmx Evaluates: the construction rule, and why it stays untyped

---

## 1. html/htmx Namespace Exports

From `@y-core/forge/html/htmx` (`src/html/htmx/mod.ts`):

**Detection**
- `isHxRequest(c)` — `true` if `HX-Request: true` header is present

**Request readers** (all `HX-*` inbound headers)
- `readHxRequest(c)` → `HxRequest` — struct with `enabled`, `boosted`, `trigger`, `target`, `triggerName`, `currentUrl`
- `isPartial(c)` — `true` when HTMX request and not boosted
- `isBoosted(c)` — `true` when `HX-Boosted: true`
- `hxTrigger(c)`, `hxTarget(c)`, `hxTriggerName(c)`, `hxCurrentUrl(c)` — individual header readers

**Response header builder** (returns `Record<string,string>` for spreading into `fragmentResponse`)
- `hxHeaders(props)` → `HxResponseHeaders` — typed builder for all `HX-*` response headers
- Types: `HxResponseHeaders`, `HxResponseProps`

**Attribute builder**
- `hxAttrs(props)` → `HxAttrs` — converts a typed props object to an `hx-*` attribute map
- Types: `HxAttrs`, `HxAttrsProps`

**SWAP constants**
- `SWAP` — object with string constants: `innerHtml`, `outerHtml`, `beforeEnd`, `afterEnd`, `beforeBegin`, `delete`, `none`

**Patterns** (return `HxAttrs` for spreading onto JSX elements)
- `formSubmit(p)`, `liveSearch(p)`, `inlineValidation(p)`, `infiniteScroll(p)`
- `paginatedTableLink(p)`, `asyncDialogTrigger(p)`, `dependentSelect(p)`
- `oobSwap(p)`, `oobAppend(selector)` — OOB swap helpers
- `toastOob` lives in `@y-core/forge/ui/server` — it renders a `ui/core` Toast component and is not a leaf export

---

## 2. isHxRequest — Detection and UX-Guard Caveat

`isHxRequest(c)` checks for the `HX-Request: true` request header:

    import { isHxRequest } from "@y-core/forge/html/htmx"

    // Inside a view handler — branch between full-page and partial response:
    if (isHxRequest(c)) {
      return renderLogFragment(data)
    }
    return renderPage(<Layout ctx={ctx}><LogViewer data={data} /></Layout>)

**Security caveat:** `HX-Request` is a client-supplied header — any caller can set it.
It is a *UX routing hint*, not a security boundary. For mutation routes always pair with:

1. `verifyOrigin` / `originGuard` from `@y-core/forge/security`
2. `csrfProtection` / CSRF token verification from `@y-core/forge/form`

Using `isHxRequest` alone does NOT protect a route. The three-guard pattern for POST routes:

    const contactGuard: Middleware = async (context, next) => {
      const c = getAppContext(context)
      if (!verifyOrigin(c.request, allowedOrigins).ok) return new Response("Forbidden", { status: 403 })
      if (!isHxRequest(c)) return new Response("Forbidden", { status: 403 })
      return next()
    }
    // Then apply csrfVerifyGuard as a separate middleware in the chain

---

## 3. Request Readers

`readHxRequest(c)` returns all inbound HTMX headers as a typed struct:

    const hx = readHxRequest(c)
    // hx.enabled    → boolean (HX-Request header present)
    // hx.boosted    → boolean (HX-Boosted header)
    // hx.trigger    → string  (HX-Trigger)
    // hx.target     → string  (HX-Target)
    // hx.triggerName → string (HX-Trigger-Name)
    // hx.currentUrl → string  (HX-Current-URL)

Use `isPartial(c)` instead of `isHxRequest(c)` when you want to exclude boosted navigation
requests (full-page responses are appropriate for boosted requests):

    if (isPartial(c)) {
      return renderFragment(data)  // non-boosted HTMX only
    }

---

## 4. hxHeaders — Response Header Builder

`hxHeaders(props)` builds a `Record<string,string>` of `HX-*` response headers.
Pass the result directly to `fragmentResponse` or `htmlResponse` as the `headers` argument:

    import { hxHeaders } from "@y-core/forge/html/htmx"
    import { fragmentResponse } from "@y-core/forge/http"

    // Redirect the browser to a new URL (HTMX client-side redirect)
    return fragmentResponse(body, 200, hxHeaders({ redirect: "/dashboard" }))

    // Push a URL onto the browser history stack and fire a client event
    return fragmentResponse(body, 200, hxHeaders({
      pushUrl: "/results?q=hello",
      trigger: "formSubmitted",
    }))

All props are optional; `undefined` and empty-string values are omitted (mirrors `hxAttrs`).
`refresh: true` emits `HX-Refresh: "true"`; `refresh: false` (or omitted) is omitted.

Supported props → header name:
`redirect` → `HX-Redirect`, `refresh` → `HX-Refresh`, `pushUrl` → `HX-Push-Url`,
`replaceUrl` → `HX-Replace-Url`, `trigger` → `HX-Trigger`,
`triggerAfterSettle` → `HX-Trigger-After-Settle`, `triggerAfterSwap` → `HX-Trigger-After-Swap`,
`retarget` → `HX-Retarget`, `reswap` → `HX-Reswap`.

---

## 5. hxAttrs — Attribute Builder

`hxAttrs` converts a typed `HxAttrsProps` object into a flat `Record<string, string>` for
spreading onto JSX elements. Undefined and empty-string values are omitted:

    import { hxAttrs } from "@y-core/forge/html/htmx"

    <form {...hxAttrs({ post: "/api/contact", target: "#result", swap: "outerHTML" })} />
    // renders: hx-post="/api/contact" hx-target="#result" hx-swap="outerHTML"

All `hx-*` attributes are supported via camelCase property names:
`get`, `post`, `put`, `patch`, `delete`, `target`, `swap`, `trigger`, `include`,
`indicator`, `disabledElt`, `sync`, `confirm`, `encoding`, `pushUrl`, `replaceUrl`,
`params`, `values` (→ `hx-vals` JSON), `headers` (→ `hx-headers` JSON), `boost`.

Selector- and JSON-valued props are emitted verbatim and must be **trusted** — see §7. The
URL-valued props are emitted verbatim too, for a different reason — see §7a.

---

## 6. Patterns

The pattern helpers build `HxAttrs` objects for common HTMX UI patterns. Spread them onto
the element that triggers the request:

### 6a. formSubmit

    <form {...formSubmit({ post: routes.contact.href(), target: "#contact-result" })}>

Defaults: `swap=outerHTML`, `disabledElt=this`.

### 6b. liveSearch

    <input {...liveSearch({ get: routes.search.href(), target: "#results" })} />

Defaults: `swap=innerHTML`, `trigger="input changed delay:300ms, search"`.

### 6c. inlineValidation

    <input {...inlineValidation({ get: "/validate/email", target: "#email-field" })} />

Defaults: `swap=outerHTML`, `trigger="change delay:200ms, blur"`, `sync="this:abort"`.

The `sync` default is deliberately form-independent: htmx resolves the selector at request time and
does not null-check the result, so a `closest form` default silently throws inside htmx's own
trigger handler for any field with no enclosing `<form>` — no request, no `htmx:*` error event.
A caller inside a form that wants cross-field aborting passes `sync: "closest form:abort"`.

### 6d. infiniteScroll

    <div {...infiniteScroll({ get: "/items?page=2", target: "#item-list" })} />

Always sets `trigger=revealed`. Append-based: default `swap=beforeend`.

### 6e. paginatedTableLink

    <a {...paginatedTableLink({ get: "/items", target: "#table", page: nextPage })} />

Builds the `?page=N` URL automatically. Preserves existing query params.

### 6f. OOB Helpers

`oobSwap` and `oobAppend` produce `hx-swap-oob` attributes for out-of-band updates.
For toast OOB fragments, use `toastOob` from `@y-core/forge/ui/server` (it renders a
`ui/core` Toast component, so it belongs in the integration namespace):

    import { toastOob } from "@y-core/forge/ui/server"

    return fragmentResponse(
      renderSuccess(message),
      toastOob({ toast: { title: "Saved", variant: "success" } })
    )

---

## 7. Trust Posture — Selectors and JSON Values Must Be Developer-Supplied

The **selector- and JSON-valued** htmx attributes are **client-side behavioral directives**, not
display text. The renderer does not (and cannot) neutralize them by escaping — a CSS selector or a
JSON blob is meaningful to the htmx client exactly as written, and an escaped one is merely a broken
one. Every selector- and JSON-valued attribute produced by `hxAttrs` and the pattern helpers must
therefore be **trusted, developer-supplied** — never interpolated from raw user input:

- `hx-target`, `hx-select`, `hx-select-oob`, `hx-include` — CSS selectors. A user-controlled
  value can retarget a swap to overwrite arbitrary DOM, or exfiltrate other form fields via
  `hx-include`.
- `hx-trigger`, `hx-sync` — trigger/sync expressions with their own mini-syntax.
- `hx-vals` (`values`), `hx-headers` (`headers`) — JSON injected into every request; a
  user-controlled value can forge request parameters or headers.
- `hx-swap-oob` selectors from `oobSwap`/`oobAppend` — pick the swap target client-side.

This applies to the pattern helpers too (`liveSearch`, `inlineValidation`, `formSubmit`,
`infiniteScroll`, `paginatedTableLink`, `asyncDialogTrigger`, `dependentSelect`), which forward
their `target`/`select`/`trigger` arguments verbatim into `hxAttrs`. Build these values from route
definitions and static configuration, not from request data.

The URL-valued props those same helpers forward — `get`, `post` and the rest — are a **disjoint
set** governed by §7a, which reaches the same obligation for a different reason.

The `isHxRequest` detection hint carries the complementary caveat: it is a client-supplied header,
a UX routing hint and not a security boundary (§2). Neither the attribute values nor the request
hint substitute for `originProtection`/`crossOriginProtection` and `csrfProtection` on mutation
routes.

### 7a. URL-Valued hx Attributes Are Deliberately Unsanitized

The URL-valued htmx props — `get`, `post`, `put`, `patch`, `delete`, `pushUrl` and `replaceUrl` —
carry addresses rather than selectors, so §7's argument does not reach them: escaping a URL does not
break it, and a sanitizer would not corrupt a legitimate value. They are nonetheless emitted
verbatim. The attribute names the JSX renderer routes through `safeUrl` are owned by
`src/jsx/render-to-string.ts`, and no `hx-*` name is among them. **That is a decision, not an
oversight, and the reason is what `safeUrl` does on rejection.**

**`safeUrl` maps a rejected URL to `"#"`, and `"#"` is not inert on an `hx-*` attribute.** On an
`href` it is a visibly dead link — the refusal is loud, and the user sees nothing happen. On an
`hx-get` it is a valid same-origin URL naming the **current page**: htmx would issue a real request
for it and swap the response into the target. Sanitizing here converts a loud refusal into a
*successful wrong request* — a fetch-and-swap indistinguishable at the point of failure from the
behaviour the author intended. A guard whose failure mode is silent success is worse than no guard,
because it also removes the pressure to supply a trustworthy value in the first place.

Two runtime layers sit **underneath** that reason. Neither is the control, and neither would justify
the attributes being unsanitized on its own:

- **htmx dispatches an XHR; it never navigates the value.** A `javascript:` pseudo-URL in an
  `hx-get` is a string handed to a request builder, not an address the script engine evaluates — so
  the pseudo-URL that makes an `href` dangerous fails to execute here.
- **The runtime and the CSP each refuse a cross-origin fetch.** `htmx.config.selfRequestsOnly`
  defaults to `true` in htmx 2, and a consumer's `connect-src` directive
  ([`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2a) bounds where a request may go at all.

The caller's obligation is therefore identical to §7's even though the argument differs: build these
values from route definitions and static configuration, never from request data. What changes is the
remedy available when that obligation is broken — for a selector there is none, and for a URL the
available one is rejected above rather than missing.

**Adding `hx-*` names to the renderer's URL-attribute set is the specific change this section
refuses.** `src/jsx/render-to-string.test.ts` pins it: an element carrying one value on both `href`
and `hx-push-url` must render `href="#"` beside an unchanged `hx-push-url`, an assertion that fails
the moment the two are treated alike.

### 7b. hx-on:* Is the One Family htmx Evaluates

`hx-on:*` is the exception to both sections above. htmx does not match it as a selector (§7) or hand
it to a request builder (§7a) — it **evaluates it as JavaScript**. So unlike an `hx-target` the value
is not merely uncheckable, and unlike an `hx-get` it is not merely a string: it is script, and the
only thing that decides whether it is safe is who wrote it.

**Constructing an `hx-on:*` value from anything other than literal, developer-authored source is the
defect this section names.** That is the control. It is not a stronger version of §7's trust
obligation but the same one at the point where it carries the most weight, because here a broken
obligation is direct evaluation rather than a misrouted swap.

**The renderer emits `hx-on:*` verbatim, and its type surface does not stop it either.** There is no
`on*` filter anywhere in the JSX renderer; the only name-based gate is the attribute-name validity
regex owned by `src/jsx/render-to-string.ts`, which `hx-on:click` satisfies, so the value is escaped
and written like any other attribute. Escaping does not help: htmx reads the attribute from the DOM
*after* the parser has decoded entities, so an escaped payload is decoded again before evaluation.

A CSP without `'unsafe-eval'` is the **second** layer. htmx compiles an `hx-on:*` body with
`new Function`, which forge's default `script-src` does not permit (`src/security/headers.ts`, and
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2e for the emitted defaults) — so under the
shipped default the attribute does not execute at all. Treat that as a backstop
and not as permission: `scriptSrc` is a caller-supplied option, and a consumer that widens it for an
unrelated reason removes this layer without touching a line of htmx.

**`hx-on:*` is deliberately absent from the JSX attribute types and stays absent.** Typing it means a
template-pattern index signature — the suffix is an arbitrary event name, so no fixed set of keys
covers it — added to the htmx attribute interface in `src/jsx/types.ts`. That interface is mixed into
both the HTML and SVG attribute bases, which every per-tag element type extends and every `ui/core`
prop type reaches through `JSX.IntrinsicElements`. A template index signature admits every key
matching its pattern without further checking, so a misspelled event name stops being an error on
every element in the library at once. That is a repo-wide weakening of excess-property checking,
bought for autocomplete on a capability the shipped CSP disables. Declined.

**The absence is therefore not a guard, and must not be read as one.** A case in
`src/jsx/render-to-string.test.ts` asserts that `hx-on:click` renders verbatim, so the rule above
never comes to rest on a type error that only exists at a JSX call site.

---
