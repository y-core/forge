---
title: HTMX Integration
description: "The trust posture governing server-side HTMX attribute emission: which values must be developer-supplied, and why none of them are sanitized."
audience: consumer
---

# HTMX Integration

> Owns the rulings behind forge's server-side HTMX surface — the trust posture on emitted attribute values, the ruling that `isHxRequest` is
> **not** a security boundary (§7), which attribute forge marks as inherited (§9), and how a handler tells a page request from a fragment request
> (§10). The exports, their signatures, and every usage example are owned by `src/render/htmx/README.md`.
>
> Defers to: [`SECURITY_HARDENING.md`][sh-3e] §3e and §2d for the guards that must accompany it and for automatic URL sanitization;
> [`SECURITY_HARDENING.md`][sh-2g] §2g for the `forge-htmx` Trusted Types policy; [`UI_SSR_COMPONENTS.md`][usc] for the components these attributes
> land on.

---

## 0. Quick Reference

- §7 Trust Posture: selector and JSON values must be developer-supplied
- §7a URL-Valued hx Attributes Are Deliberately Unsanitized: why `"#"` is the wrong refusal here, and the runtime layers beneath that reason
- §7b What htmx Evaluates: `hx-on:*`, `js:`-prefixed values and trigger filters — the construction rule, the CSP and Trusted Types beneath it, and
  why `hx-on:*` stays untyped
- §8 The Form-Independent sync Default: why `closest form` is not a safe default
- §9 Inheritance Is Explicit — hxAttrs Emits hx-boost:inherited: the one attribute forge marks as reaching descendants
- §10 A Page or a Fragment — isPartial Reads HX-Request-Type: why a history restore must get a page, and what an absent value means

---

## 7. Trust Posture — Selectors and JSON Values Must Be Developer-Supplied

The **selector- and JSON-valued** htmx attributes are **client-side behavioral directives**, not display text. The renderer does not (and cannot)
neutralize them by escaping — a CSS selector or a JSON blob is meaningful to the htmx client exactly as written, and an escaped one is merely a
broken one. Every selector- and JSON-valued attribute produced by `hxAttrs` and the pattern helpers must therefore be **trusted,
developer-supplied** — never interpolated from raw user input:

- `hx-target`, `hx-select`, `hx-select-oob`, `hx-include` — CSS selectors. A user-controlled value can retarget a swap to overwrite arbitrary DOM,
  or exfiltrate other form fields via `hx-include`.
- `hx-trigger`, `hx-sync` — trigger/sync expressions with their own mini-syntax.
- `hx-vals` (`values`), `hx-headers` (`headers`) — JSON injected into every request; a user-controlled value can forge request parameters or
  headers.
- `hx-swap-oob` selectors from `oobSwap`/`oobAppend` — pick the swap target client-side.

This applies to the pattern helpers too (`liveSearch`, `inlineValidation`, `formSubmit`, `infiniteScroll`, `paginatedTableLink`,
`asyncDialogTrigger`, `dependentSelect`), which forward their `target`/`select`/`trigger` arguments verbatim into `hxAttrs`. Build these values from
route definitions and static configuration, not from request data.

The URL-valued props those same helpers forward — `get`, `post` and the rest — are a **disjoint set** governed by §7a, which reaches the same
obligation for a different reason.

**`isHxRequest` carries the complementary ruling, and this section owns it: `HX-Request` is a client-supplied header any caller can set, so the
predicate is a UX routing hint and never a security boundary.** It decides _how to render_, never _whether the caller is allowed_. Neither the
attribute values nor the request hint substitute for `originProtection`/`crossOriginProtection` and `csrfProtection` on mutation routes.

### 7a. URL-Valued hx Attributes Are Deliberately Unsanitized

The URL-valued htmx props — `get`, `post`, `put`, `patch`, `delete`, `pushUrl` and `replaceUrl` — carry addresses rather than selectors, so §7's
argument does not reach them: escaping a URL does not break it, and a sanitizer would not corrupt a legitimate value. They are nonetheless emitted
verbatim. The attribute names the JSX renderer routes through `safeUrl` are owned by `src/render/jsx/render-to-string.ts`, and no `hx-*` name is
among them. **That is a decision, not an oversight, and the reason is what `safeUrl` does on rejection.**

**`safeUrl` maps a rejected URL to `"#"`, and `"#"` is not inert on an `hx-*` attribute.** On an `href` it is a visibly dead link — the refusal is
loud, and the user sees nothing happen. On an `hx-get` it is a valid same-origin URL naming the **current page**: htmx would issue a real request
for it and swap the response into the target. Sanitizing here converts a loud refusal into a _successful wrong request_ — a fetch-and-swap
indistinguishable at the point of failure from the behaviour the author intended. A guard whose failure mode is silent success is worse than no
guard, because it also removes the pressure to supply a trustworthy value in the first place.

Further runtime layers sit **underneath** that reason. Neither is the control, and neither would justify the attributes being unsanitized on its
own:

- **`forge-htmx` refuses a request URL that begins `js:` or `javascript:`.** htmx 4 evaluates such a URL as script instead of fetching it, so the
  pseudo-URL that makes an `href` dangerous would execute from an `hx-get` too. The `forge-htmx` extension that `ui/client/htmx` registers
  cancels the request before htmx reaches that step, and logs the element it refused. It applies the same prefix test htmx does, on every page,
  whether or not Trusted Types is enforced ([`SECURITY_HARDENING.md`][sh-2g] §2g).
- **The runtime and the CSP each refuse a cross-origin fetch.** htmx 4 passes `config.mode`, `"same-origin"` by default, to every `fetch`, and no
  element's `hx-config` can override it. A consumer's `connect-src` directive ([`SECURITY_HARDENING.md`][sh-2a] §2a) bounds where a request may go
  at all.

The caller's obligation is therefore identical to §7's even though the argument differs. What changes is the remedy available when that obligation
is broken — for a selector there is none, and for a URL the available one is rejected above rather than missing.

**Adding `hx-*` names to the renderer's URL-attribute set is the specific change this section refuses.** `src/render/jsx/render-to-string.test.ts`
pins it: an element carrying one value on both `href` and `hx-push-url` must render `href="#"` beside an unchanged `hx-push-url`, an assertion that
fails the moment the two are treated alike.

### 7b. What htmx Evaluates: hx-on:* and a js:-Prefixed hx-vals or hx-headers

What htmx evaluates is the exception to both sections above. htmx does not match these as a selector (§7) or hand them to a request builder
(§7a) — it **evaluates** them as JavaScript. So unlike an `hx-target` the value is not merely uncheckable, and unlike an `hx-get` it is not merely a
string: it is script, and the only thing that decides whether it is safe is who wrote it.

- **`hx-on:*`**, whose whole value is an event-handler body.
- **`hx-vals` and `hx-headers` whose value begins `js:`** (`javascript:` is the accepted alias). The rest of the attribute is then an expression
  htmx evaluates per request rather than the JSON it otherwise parses. `src/render/jsx/types.ts` types both as a raw `string`, so nothing in the
  type surface tells the two forms apart.
- **An `hx-trigger` filter in square brackets, and an `hx-confirm` whose value begins `js:`.** Each is an expression htmx evaluates when the
  trigger fires.
- **A verb attribute whose URL begins `js:` or `javascript:`.** `forge-htmx` refuses it before htmx evaluates it (§7a), so the rule below is not
  the only thing standing in front of it.

**Constructing any of these values from anything other than literal, developer-authored source is the defect this section names.** That is the one
control, and it is the same for each. It is not a stronger version of §7's trust obligation but the same one at the point where it carries the most
weight, because here a broken obligation is direct evaluation rather than a misrouted swap.

**`hxAttrs` cannot emit a `js:` value**, so the exposure is a hand-written attribute: its `values` and `headers` are `Record<string, string>` and
are JSON-encoded (`src/render/htmx/htmx-attrs.ts`). Forge's own code already treats the prefix as the evaluated form — `<Form>` refuses to merge a
CSRF token into an `hx-headers` value it cannot parse as a JSON object, rather than shipping a form whose token silently went missing
(`src/ui/core/form.tsx`).

**The renderer emits `hx-on:*` verbatim, and its type surface does not stop it either.** There _is_ an `on*` filter in the JSX renderer — it drops
any attribute whose lowercased name begins `on`, so an untrusted spread key cannot inject `onclick` — and `hx-on:click` lowercases to a name
beginning `hx-`, which places it deliberately outside that filter. Past the filter the only name-based gate is the attribute-name validity regex
owned by `src/render/jsx/render-to-string.ts`, which `hx-on:click` satisfies, so the value is escaped and written like any other attribute. Escaping
does not help: htmx reads the attribute from the DOM _after_ the parser has decoded entities, so an escaped payload is decoded again before
evaluation. The exemption is listed as a known pattern in [`FORGE_REVIEW.md`][fr-6] §6, which is the other half [`BOUNDARIES.md`][boundaries-5c] §5c
requires.

A CSP without `'unsafe-eval'` is the **second** layer — a backstop, not a permission model. htmx compiles an `hx-on:*` body with `new Function`,
which only `'unsafe-eval'` would permit, and forge's emitted policy carries that source in no directive by default. The **string** `'unsafe-eval'`
is refused, case-insensitively, in every directive, so no directive list assembled from config, from an env var or from a pasted snippet can widen
the policy into permitting it (`src/security/headers.ts`, and [`SECURITY_HARDENING.md`][sh-2e] §2e for the rule and the emitted defaults).

**A consumer that imports `UNSAFE_EVAL` removes this layer, deliberately, and that is by design.** The override is a `unique symbol` from
`@y-core/forge/security`; naming it in `scriptSrc` is an import a reviewer reads in the diff, and an `hx-on:*` attribute in that app executes. Forge
does not own the trade — it owns that the trade be visible. So the layer is bounded twice over: by whether the app opted out, and by the policy
being emitted at all, since a route that never reaches `createSecurityHeaders` or `applySecurityHeaders` has no CSP from forge. The control above
both — who wrote the attribute value — is the one that depends on neither.

**htmx 4 has no switch of its own for either path, so the CSP and Trusted Types are the only layers beneath the construction rule.** htmx 2's
`allowEval` and `allowScriptTags` are gone. Every evaluated form above compiles through the native `Function` constructor, which a policy without
`'unsafe-eval'` refuses. Under enforced Trusted Types it is refused even when `UNSAFE_EVAL` admits eval, because `forge-htmx` gives htmx no policy
for it ([`SECURITY_HARDENING.md`][sh-2g] §2g). A `<script>` inside swapped content is always rebuilt and run, with its text passed through the
policy's `createScript`. The default CSP still refuses an injected one, because it permits only nonced inline script.

**`hx-on:*` is deliberately absent from the JSX attribute types and stays absent.** Typing it means a template-pattern index signature — the suffix
is an arbitrary event name, so no fixed set of keys covers it — added to the htmx attribute interface in `src/render/jsx/types.ts`. That interface
is mixed into both the HTML and SVG attribute bases, which every per-tag element type extends and every `ui/core` prop type reaches through
`JSX.IntrinsicElements`. A template index signature admits every key matching its pattern without further checking, so a misspelled event name stops
being an error on every element in the library at once. That is a repo-wide weakening of excess-property checking, bought for autocomplete on a
capability no CSP option can enable. Declined.

**The absence is therefore not a guard, and must not be read as one.** A case in `src/render/jsx/render-to-string.test.ts` asserts that
`hx-on:click` renders verbatim, so the rule above never comes to rest on a type error that only exists at a JSX call site.

---

## 8. The Form-Independent sync Default

**A pattern helper's default may not name a selector whose absence is a silent failure.** The concrete case is `inlineValidation`, whose `sync`
default is `this:abort` rather than the form-scoped `closest form:abort` a field-validation helper would otherwise want.

htmx resolves a `hx-sync` selector at request time and does not null-check the result, so a `closest form` default throws inside htmx's own trigger
handler for any field with no enclosing `<form>` — no request, no `htmx:*` error event, nothing in the console tied to the attribute. The failure is
invisible at exactly the call site that got it wrong. A caller that _is_ inside a form and wants cross-field aborting passes
`sync: "closest form:abort"` explicitly, which is the position in which the selector is known to resolve.

---

## 9. Inheritance Is Explicit — hxAttrs Emits hx-boost:inherited

**htmx 4 applies an attribute only to the element that carries it, unless the name ends `:inherited`.** Its `implicitInheritance` setting defaults
to off, and forge leaves it off. So an `hx-boost="true"` on `<body>` or `<nav>` boosts that element alone, and no link inside it — a silent loss
of boosted navigation rather than an error.

**`hxAttrs({ boost })` therefore emits `hx-boost:inherited`, and it is the only attribute forge marks this way.** Boost is the one htmx attribute
whose ordinary home is a container reaching its descendants. On a link or a form the suffix costs nothing, because htmx reads the `:inherited`
spelling on the element itself as well. Every other `hx-*` attribute forge renders sits on the element that issues the request — `<Form>` puts the
verb and its `hx-headers` on the `<form>` — so none of them needs the suffix, and `hxAttrs` never adds it. An app that wants another attribute to
reach descendants writes the suffix by hand.

**`src/render/jsx/types.ts` types `hx-boost:inherited` and not a bare `hx-boost`**, so the container spelling htmx 4 does not honour is a type error
at the JSX call site. `src/render/htmx/htmx-attrs.test.ts` pins the emitted name.

---

## 10. A Page or a Fragment — isPartial Reads HX-Request-Type

**A handler that answers a page or a fragment from one route decides by `isPartial`, and `isPartial` is true only when `HX-Request-Type` is exactly
`partial`.** htmx 4 sends `HX-Request: true` on every request it issues, including the two that must get a whole page:

- **A boosted navigation**, which carries `HX-Boosted: true` and swaps the response into `<body>`.
- **A history restore.** When the reader goes back or forward, htmx 4 fetches the page with an htmx GET carrying `HX-History-Restore-Request: true`
  and no `HX-Boosted`, then replaces the whole body with the response.

The htmx 2 test — `HX-Request` without `HX-Boosted` — answers a history restore with a fragment, and htmx then puts that fragment where the body
was. `HX-Request-Type` is htmx's own statement of what it will do with the response: `full` when the target is `<body>` or an `hx-select` will pick
from the response, and `partial` otherwise. An `hx-select` request is therefore answered with a page, which is what it selects from.

**An absent or unrecognised `HX-Request-Type` reads as a page.** A request that did not say it wants a fragment — a hand-built `fetch` that sets
`HX-Request`, a proxy that strips the header — gets the full document, which is the answer every client can use. `readHxRequest` exposes the value
as `requestType`, which is `""` in that case.

**`isPartial` is a rendering hint on the same terms as `isHxRequest`** (§7). `HX-Request-Type` is a header the client sets, so it decides how to
render and never whether the caller is allowed. `src/render/htmx/htmx-headers.test.ts` pins each case above.

---

[boundaries-5c]: ../warden/canon/libs/BOUNDARIES.md#5c-recording-a-fail-open-exception
[fr-6]: ./FORGE_REVIEW.md#6-valid-patterns--do-not-flag
[sh-2a]: ./SECURITY_HARDENING.md#2a-createsecurityheaders-factory-pattern
[sh-2e]: ./SECURITY_HARDENING.md#2e-default-header-set
[sh-2g]: ./SECURITY_HARDENING.md#2g-trusted-types-and-htmx--the-forge-htmx-policy
[sh-3e]: ./SECURITY_HARDENING.md#3e-origin-guard-tiering--which-guard-when
[usc]: ./UI_SSR_COMPONENTS.md
