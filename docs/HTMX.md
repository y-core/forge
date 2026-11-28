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
- §7a URL-Valued hx Attributes Are Deliberately Unsanitized: why `"#"` is the wrong refusal here, why `bindAttr` removes a request attribute
  bound to a script URL instead, and the runtime layers beneath that reason
- §7b What htmx Evaluates: `hx-on:*`, `js:`-prefixed values and trigger filters — the construction rule, the CSP and Trusted Types beneath it, and
  why `hx-on:*` stays untyped
- §8 The Form-Independent sync Default: why `closest form` is not a safe default
- §9 Inheritance Is Explicit — hxAttrs Emits hx-boost:inherited: the one attribute forge marks as reaching descendants
- §10 A Page or a Fragment — isPartial Reads HX-Request-Type: why a history restore must get a page, and what an absent value means

---

## 7. Trust Posture — Selectors and JSON Values Must Be Developer-Supplied

The **selector- and JSON-valued** htmx attributes are client-side behavioural directives that escaping cannot neutralise — an escaped selector is
merely a broken one — so every one `hxAttrs` and the pattern helpers produce must be **trusted, developer-supplied**, never interpolated from raw
user input:

- `hx-target`, `hx-select`, `hx-select-oob`, `hx-include` — CSS selectors. A user-controlled value can retarget a swap to overwrite arbitrary DOM,
  or exfiltrate other form fields via `hx-include`.
- `hx-trigger`, `hx-sync` — trigger/sync expressions with their own mini-syntax.
- `hx-vals` (`values`), `hx-headers` (`headers`) — JSON injected into every request; a user-controlled value can forge request parameters or
  headers.
- `hx-swap-oob` selectors from `oobSwap`/`oobAppend` — pick the swap target client-side.

This applies to the pattern helpers too, which forward their `target`/`select`/`trigger` arguments verbatim into `hxAttrs`. Build these values from
route definitions and static configuration, not from request data.

The URL-valued props those same helpers forward — `get`, `post` and the rest — are a **disjoint set** governed by §7a, which reaches the same
obligation for a different reason.

**`isHxRequest` is a UX routing hint and never a security boundary**, because `HX-Request` is a header any caller can set: it decides _how to
render_, never _whether the caller is allowed_. Neither it nor the attribute values substitute for `originProtection`/`crossOriginProtection` and
the app's CSRF policy on mutation routes.

### 7a. URL-Valued hx Attributes Are Deliberately Unsanitized

The URL-valued htmx props — the request verbs, `pushUrl` and `replaceUrl` — carry addresses rather than selectors, so §7's
argument does not reach them: escaping a URL does not break it, and a sanitizer would not corrupt a legitimate value. They are nonetheless emitted
verbatim. The attribute names the JSX renderer routes through `safeUrl` are owned by `src/render/jsx/render-to-string.ts`, and no `hx-*` name is
among them. **That is a decision, not an oversight, and the reason is what `safeUrl` does on rejection.**

**`safeUrl` maps a rejected URL to `"#"`, and `"#"` is not inert on an `hx-*` attribute**: on an `hx-get` it names the current page, so htmx would
issue a real request and swap the response, turning a loud refusal into a silent wrong success.

**A request attribute driven by a signal is removed while its value is a script URL, and never collapsed to `"#"`**, because a signal seeded from
`data-island-state` is as reachable as a request parameter. `bindAttr` owns which attributes and spellings it tests; removal fails closed where
`"#"` would fail open, and the next safe value writes the attribute back.

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

**`hxAttrs` cannot emit a `js:` value** — its `values` and `headers` are JSON-encoded (`src/render/htmx/htmx-attrs.ts`) — so the exposure is a
hand-written attribute. `<Form>` likewise refuses to merge a CSRF token into an `hx-headers` value it cannot parse as JSON (`src/ui/core/form.tsx`).

**The renderer emits `hx-on:*` verbatim.** The JSX renderer's `on*` filter drops attributes whose lowercased name begins `on`, which `hx-on:click`
deliberately falls outside, and escaping does not help, because htmx reads the attribute after the parser decodes entities. The exemption is listed
in [`FORGE_REVIEW.md`][fr-6] §6, the other half [`BOUNDARIES.md`][boundaries-5c] §5c requires.

A CSP without `'unsafe-eval'` is the **second** layer — a backstop, not a permission model. htmx compiles an `hx-on:*` body with `new Function`,
which only `'unsafe-eval'` would permit, and forge's emitted policy carries that source in no directive by default. The **string** `'unsafe-eval'`
is refused in every directive ([`SECURITY_HARDENING.md`][sh-2e] §2e), so no directive list assembled from config, an env var or a pasted snippet can
widen the policy into permitting it.

**A consumer that imports `UNSAFE_EVAL` removes this layer, by design**: naming that `@y-core/forge/security` symbol in `scriptSrc` is an import a
reviewer reads in the diff, and forge owns only that the trade be visible. The layer also exists only on a route that reaches
`createSecurityHeaders` or `applySecurityHeaders`; the construction rule above depends on neither.

**htmx 4 has no switch of its own for either path, so the CSP and Trusted Types are the only layers beneath the construction rule.** Every evaluated
form compiles through the native `Function` constructor, refused without `'unsafe-eval'` and, under enforced Trusted Types, even with `UNSAFE_EVAL`,
because `forge-htmx` gives htmx no policy for it ([`SECURITY_HARDENING.md`][sh-2g] §2g). A `<script>` in swapped content passes through the policy's
`createScript`, and the default CSP refuses it unless nonced.

**`hx-on:*` is deliberately absent from the JSX attribute types and stays absent.** Typing it needs a template-pattern index signature on the htmx
attribute interface in `src/render/jsx/types.ts`, which every element type reaches, so a misspelled event name would stop being an error on every
element in the library — a repo-wide loss of excess-property checking for autocomplete on a capability no CSP option can enable.

**The absence is therefore not a guard**; `src/render/jsx/render-to-string.test.ts` asserts that `hx-on:click` renders verbatim.

---

## 8. The Form-Independent sync Default

**A pattern helper's default may not name a selector whose absence is a silent failure.** `inlineValidation`'s `sync` defaults to `this:abort`,
because htmx resolves `closest form` at request time without a null check and throws silently for a field with no enclosing `<form>`; a caller
inside a form passes `sync: "closest form:abort"` explicitly.

---

## 9. Inheritance Is Explicit — hxAttrs Emits hx-boost:inherited

**htmx 4 applies an attribute only to the element that carries it, unless the name ends `:inherited`.** Its `implicitInheritance` setting defaults
to off, and forge leaves it off. So an `hx-boost="true"` on `<body>` or `<nav>` boosts that element alone, and no link inside it — a silent loss
of boosted navigation rather than an error.

**`hxAttrs({ boost })` therefore emits `hx-boost:inherited`**, because boost is the one htmx attribute whose ordinary home is a container reaching
its descendants; which attributes take the suffix is `hxAttrs`' TSDoc. An app that wants another attribute to reach descendants writes the suffix by
hand.

**`src/render/jsx/types.ts` types `hx-boost:inherited` and not a bare `hx-boost`**, so the container spelling htmx 4 does not honour is a type error
at the JSX call site. `src/render/htmx/htmx-attrs.test.ts` pins the emitted name.

---

## 10. A Page or a Fragment — isPartial Reads HX-Request-Type

**A handler that answers a page or a fragment from one route decides by `isPartial`, which reads `HX-Request-Type` rather than `HX-Request`.** htmx
4 sends `HX-Request: true` on every request it issues, a boosted navigation and a history restore included, and both must get a whole page: a
history restore answered with a fragment puts that fragment where the body was. `HX-Request-Type` is htmx's own statement of what it will do with
the response, so only `partial` reads as a fragment, and an absent or unrecognised value reads as the page every client can use.
`src/render/htmx/htmx-headers.test.ts` pins each case.

**`isPartial` is a rendering hint on the same terms as `isHxRequest`** (§7). `HX-Request-Type` is a header the client sets, so it decides how to
render and never whether the caller is allowed.

---

[boundaries-5c]: ../warden/canon/libs/BOUNDARIES.md#5c-recording-a-fail-open-exception
[fr-6]: ./FORGE_REVIEW.md#6-valid-patterns--do-not-flag
[sh-2a]: ./SECURITY_HARDENING.md#2a-createsecurityheaders-factory-pattern
[sh-2e]: ./SECURITY_HARDENING.md#2e-default-header-set
[sh-2g]: ./SECURITY_HARDENING.md#2g-trusted-types-and-htmx--the-forge-htmx-policy
[sh-3e]: ./SECURITY_HARDENING.md#3e-origin-guard-tiering--which-guard-when
[usc]: ./UI_SSR_COMPONENTS.md
