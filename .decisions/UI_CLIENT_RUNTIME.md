---
title: UI Client Runtime
description: "The browser-only UI tier: mount controllers, signals, lazy loading, the htmx side-effect import, and the hard SSR boundary."
---

# UI Client Runtime

> Owns the browser-only UI tier — `ui/client` controllers and signals, the `ui/chrome/client`
> theme registration, and the htmx side-effect import. **§4 is the load-bearing rule: these
> exports must never reach an SSR context.**
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the markup these controllers
> attach to and for the server half of the binding seam; `package.json` `sideEffects` for which
> modules are side-effectful; `src/ui/README.md` for controller options and worked usage.

---

## 0. Quick Reference

- §1 Runtime Boundary: what `ui/client` is and where it may be imported
- §2 Mount Controllers: the browser controllers and their contracts
- §2a mountNav — Navigation Controller: menu toggle and active-link marking
- §2b Theme Controller and FOUC Prevention: where the theme surface actually lives
- §2c mountTurnstile — CAPTCHA Controller: engagement-gated, self-healing, fails visible
- §3 Signals and Lazy Loading: client state without a framework
- §3a Signals — Reactive State: `createSignal`, `computed`, `effect`
- §3b Lazy Loading Utilities: deferred imports and event-triggered resources
- §3c Resumable Scopes: `registerScope` and `resume`
- §4 htmx Bundle Import: the side-effect entry point
- §5 Never Use ui/client in an SSR Context: the hard boundary and how it is kept

---

## 1. Runtime Boundary

**`ui/client` exports run only in the browser, after the page is delivered.** They reference
`document`, `window`, and `localStorage`, none of which exist in a Worker.

Import them only from the esbuild client entry (`src/client/`) or code it bundles. §5 states the
rule and its failure mode.

---

## 2. Mount Controllers

Every mount controller is **idempotent per element and returns a cleanup function**, so calling
one twice is safe and a controller can be torn down.

### 2a. `mountNav` — Navigation Controller

Wires the mobile hamburger toggle and applies active-link highlighting from
`window.location.pathname`. **Call once per page** from the bundled client entry.

### 2b. Theme Controller and FOUC Prevention

The theme surface is split across two subpaths, and the split matters:

- **`@y-core/forge/ui/chrome`** (SSR) exports `FOUC_SCRIPT`, `THEME_ATTR`, `DARK_CLASS`,
  `THEME_STORAGE_KEY`, and the `ThemeToggle` component.
- **`@y-core/forge/ui/chrome/client`** is a **side-effect module** that registers the theme and
  nav chrome controllers and exports the `isDark` signal.

**`FOUC_SCRIPT` is an inline script for `<head>` that reads storage and sets the dark class
before first paint**, preventing a flash of unstyled content.

**Its hash must be listed in the CSP `script-src`.** Any *other* server-rendered inline
`<script>` must instead carry the per-request nonce from `getNonce(c)` — see
[`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §2a.

### 2c. `mountTurnstile` — CAPTCHA Controller

**`mountTurnstile()` is arg-less.** It finds the `[data-ref='turnstile']` widget rendered by the
`Turnstile` component ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §1f) and its enclosing
`<form>` via `closest("form")` — there is no form, widget, submit, or result selector to
configure, and it reads `siteKey` from the widget's `data-sitekey`. It no-ops when the widget or
its form is absent.

Three behaviours are deliberate:

- **Engagement-gated.** It loads Cloudflare's script on the first `focusin` within the form —
  real intent to submit, not page load or scrolling — then renders the widget explicitly with
  function-ref callbacks, so there are no global callback names and no implicit auto-render. It
  renders on the async script's `load` event and **never calls `turnstile.ready()`**, which
  throws when the script loads async.
- **Self-healing token.** It resets the single-use token after **every** completed submission,
  success or error, and on expiry or timeout, so a retry always carries a fresh token. It clears
  the form only when the submission actually succeeded.
- **Fails visible, never blocking.** On load or render failure it reveals the widget's hidden
  fallback message. **The submit button is intentionally not gated on Turnstile** — the server's
  `verifyTurnstile` ([`INPUT_VALIDATION.md`](./INPUT_VALIDATION.md) §4b) is the single
  fail-closed enforcement point, so a slow or blocked challenge can never brick the form.

---

## 3. Signals and Lazy Loading

### 3a. Signals — Reactive State

`createSignal` returns a signal with a `.value` getter/setter; `computed` derives a read-only
signal; `effect` subscribes to every signal read during its execution and re-runs on change.

**Use signals for lightweight client state that does not justify an HTMX round trip.** State
that must survive navigation or be authoritative belongs on the server.

### 3b. Lazy Loading Utilities

- **`lazy(() => import(…))`** defers a dynamic import until the browser is idle.
- **`loadScriptOnEvent(event, src)`** injects a `<script>` the first time a DOM event fires —
  for analytics or chat widgets that must not block page load.
- **`loadStylesheet(href)`** injects a `<link rel="stylesheet">`.

### 3c. Resumable Scopes

`registerScope(name, definition)` binds a scope's actions; `resume()` installs the single
delegated island listener that drives every registered scope.

**Register every scope before calling `resume()`** — including the side-effect import that
registers forge's own scopes ([`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) §2d).

---

## 4. htmx Bundle Import

**Import the htmx bundle for its side effect only, from the client entry:**

```typescript
import "@y-core/forge/ui/client/htmx"   // no exports used
```

It attaches `htmx` to `window` and registers the built-in extensions.

**The module is listed in `package.json` `sideEffects`, which is what stops a bundler
tree-shaking it away.** That file owns the list — never restate which modules are side-effectful.

**Never import htmx from a CDN URL** — this entry point is what pins the version to the forge
package.

---

## 5. Never Use `ui/client` in an SSR Context

**Importing a `ui/client` export in Worker-executed code throws at runtime.** Cloudflare Workers
have no DOM, so `document`, `window`, and `localStorage` are undefined.

The boundary is kept by import path, not by a runtime check:

| Subpath | Where it may be imported |
|---|---|
| `@y-core/forge/ui/core`, `ui/chrome`, `ui/server` | Worker-safe — SSR views, handlers, routers |
| `@y-core/forge/ui/client` | **Browser only** — the client entry and code it bundles |
| `@y-core/forge/ui/client/htmx` | **Browser only** — the esbuild entry point, side-effect import |
| `@y-core/forge/ui/*/client` | **Browser only** — side-effect scope/controller registration |

**When a component needs both SSR markup and client behaviour, render the markup with `ui/core`
and wire the behaviour from the bundled client entry.** Never inline a `ui/client` import in a
`.tsx` file outside the client directory — that is the mistake the path convention exists to
make visible.
