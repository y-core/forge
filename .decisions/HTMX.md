---
title: HTMX Integration
description: "isHxRequest detection, HX-Request UX guard not security boundary, readHxRequest, isPartial, isBoosted, hxTrigger, hxTarget, hxHeaders HxResponseProps HxResponseHeaders, hxAttrs HxAttrsProps, SWAP constants, formSubmit, liveSearch, inlineValidation, infiniteScroll, asyncDialogTrigger, paginatedTableLink, dependentSelect, oobSwap, oobAppend, html/htmx namespace"
weight: 31
---

# HTMX Integration

> Single namespace for all server-side HTMX concerns: request detection, response header
> helpers, attribute builders, and UI patterns. Import from `@y-core/forge/html/htmx`.
>
> Complements [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) (pair origin/CSRF guards
> with `isHxRequest`) and [UI_COMPONENTS.md](./UI_COMPONENTS.md) (SSR components).

---

## 0. Quick Reference

- §1 `html/htmx` namespace exports: full export list
- §2 `isHxRequest` — detection predicate and UX-guard caveat
- §3 Request readers: `readHxRequest`, `isPartial`, `isBoosted`, header accessors
- §4 `hxHeaders` — response header builder
- §5 `hxAttrs` — attribute builder
- §6 Patterns: `formSubmit`, `liveSearch`, `inlineValidation`, `infiniteScroll`, OOB helpers

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

---

## 6. Patterns

The pattern helpers build `HxAttrs` objects for common HTMX UI patterns. Spread them onto
the element that triggers the request:

### formSubmit

    <form {...formSubmit({ post: routes.contact.href(), target: "#contact-result" })}>

Defaults: `swap=outerHTML`, `disabledElt=this`.

### liveSearch

    <input {...liveSearch({ get: routes.search.href(), target: "#results" })} />

Defaults: `swap=innerHTML`, `trigger="input changed delay:300ms, search"`.

### inlineValidation

    <input {...inlineValidation({ get: "/validate/email", target: "#email-field" })} />

Defaults: `swap=outerHTML`, `trigger="change delay:200ms, blur"`, `sync="closest form:abort"`.

### infiniteScroll

    <div {...infiniteScroll({ get: "/items?page=2", target: "#item-list" })} />

Always sets `trigger=revealed`. Append-based: default `swap=beforeend`.

### paginatedTableLink

    <a {...paginatedTableLink({ get: "/items", target: "#table", page: nextPage })} />

Builds the `?page=N` URL automatically. Preserves existing query params.

### OOB helpers

`oobSwap` and `oobAppend` produce `hx-swap-oob` attributes for out-of-band updates.
For toast OOB fragments, use `toastOob` from `@y-core/forge/ui/server` (it renders a
`ui/core` Toast component, so it belongs in the integration namespace):

    import { toastOob } from "@y-core/forge/ui/server"

    return fragmentResponse(
      renderSuccess(message),
      toastOob({ toast: { title: "Saved", variant: "success" } })
    )

---
