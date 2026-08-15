---
title: HTMX Integration
description: "The trust posture governing server-side HTMX attribute emission: which values must be developer-supplied, and why none of them are sanitized."
---

# HTMX Integration

> Owns the rulings behind forge's server-side HTMX surface — the trust posture on emitted
> attribute values, and the ruling that `isHxRequest` is **not** a security boundary (§7).
> The exports, their signatures, and every usage example are owned by `src/html/README.md`.
>
> Defers to: [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md) §3e and §2d for the guards that
> must accompany it and for automatic URL sanitization;
> [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the components these attributes land on.

---

## 0. Quick Reference

- §7 Trust Posture: selector and JSON values must be developer-supplied
- §7a URL-Valued hx Attributes Are Deliberately Unsanitized: why `"#"` is the wrong refusal here
- §7b hx-on:* Is the One Family htmx Evaluates: the construction rule, and why it stays untyped
- §8 The Form-Independent sync Default: why `closest form` is not a safe default

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

**`isHxRequest` carries the complementary ruling, and this section owns it: `HX-Request` is a
client-supplied header any caller can set, so the predicate is a UX routing hint and never a
security boundary.** It decides *how to render*, never *whether the caller is allowed*. Neither the
attribute values nor the request hint substitute for `originProtection`/`crossOriginProtection` and
`csrfProtection` on mutation routes.

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

## 8. The Form-Independent sync Default

**A pattern helper's default may not name a selector whose absence is a silent failure.** The
concrete case is `inlineValidation`, whose `sync` default is `this:abort` rather than the
form-scoped `closest form:abort` a field-validation helper would otherwise want.

htmx resolves a `hx-sync` selector at request time and does not null-check the result, so a
`closest form` default throws inside htmx's own trigger handler for any field with no enclosing
`<form>` — no request, no `htmx:*` error event, nothing in the console tied to the attribute. The
failure is invisible at exactly the call site that got it wrong. A caller that *is* inside a form
and wants cross-field aborting passes `sync: "closest form:abort"` explicitly, which is the
position in which the selector is known to resolve.

---
