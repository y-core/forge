---
title: Safe-Markup Primitives
description: "Escape a value into markup, admit only safe URL schemes, and build HTML strings that escape every interpolation by default."
audience: consumer
---

# `@y-core/forge/html`

Markup that carries a request's values must not let a user's name become a `<script>` tag. This namespace is the set of primitives every forge
renderer escapes through — a tagged template that escapes by default, so you opt out of safety rather than into it, and the functions beneath it.

```ts
import { escapeHtml, html, rawHtml, safeUrl } from "@y-core/forge/html";
```

**If you are rendering JSX you rarely call any of these** — [`@y-core/forge/render/jsx`][jsx-readme] escapes every child and routes URL attributes
through `safeUrl` for you. Reach for this namespace when you are building a markup string by hand. Sending one is
[`@y-core/forge/http`][http-readme]'s: `htmlResponse` and `fragmentResponse` take the `SafeHtml` these primitives produce.

---

## Interpolating a value into markup safely

The `html` tagged template escapes every `${…}` it interpolates, so a value that arrives from a request cannot close a tag or open a script.

```ts
import { html } from "@y-core/forge/html";

const body = html`<h1>Welcome, ${user.name}</h1>`; // user.name is escaped, whatever it contains
```

The result is a `SafeHtml`, and interpolating one into another `html` template inlines it verbatim rather than double-escaping it. That is what lets
templates compose:

```ts
const rows = items.map((item) => html`<li>${item.label}</li>`); // an array is flattened and joined with no separator
const list = html`<ul>${rows}</ul>`;
```

`rawHtml(s)` marks a string you already trust as `SafeHtml`, and it is the **only** way out of escaping. Anything you hand it is emitted byte for
byte, so hand it markup you control and nothing else.

```ts
import { html, rawHtml } from "@y-core/forge/html";

html`<div>${rawHtml(trustedMarkupFromAnotherRenderer)} ${userInput}</div>`; // only userInput is escaped
```

**Inside a `<script>` or `<style>` element, reach for `scriptJson` or `styleText` rather than `rawHtml`.** Those two elements hold _raw text_, so
escaping a child corrupts it and `JSON.parse(el.textContent)` throws; `rawHtml` has the opposite problem, emitting a `</script>` in your data byte
for byte and ending the element early.

```ts
import { scriptJson, styleText } from "@y-core/forge/html";

<script type='application/json'>{scriptJson(payload)}</script>; // every `<` becomes `\u003c`
<style>{styleText(generatedCss)}</style>; // every `<` becomes the CSS hex escape `\3c `
```

`scriptJson` also escapes U+2028 and U+2029, which are legal inside a JSON string but are line terminators to a script parser, and **throws** on a
value `JSON.stringify` cannot represent — a function or `undefined`.

Outside a template — an error page assembled by hand, a mail body, a string you are concatenating — `escapeHtml` does the same escaping as a plain
function, and `isSafeHtml` tells you whether a value came from this toolkit. `escapeHtml` covers HTML text nodes and double-quoted attribute values;
[`FORGE_ERRORS.md`][eh-3c] §3c owns the character map it applies.

**Prefer JSX components over `html` where you have the choice** — [`FORGE_ERRORS.md`][eh-3b] §3b is the ruling, and the tag is for building raw
string fragments to splice into existing HTML strings.

---

## Putting a user-supplied URL in an attribute

Escaping is not enough for `href`, `src` or `action`: `javascript:alert(1)` contains no character `escapeHtml` touches. Run the value through
`safeUrl` first, then escape the result for the attribute.

```ts
import { escapeHtml, safeUrl } from "@y-core/forge/html";

const href = escapeHtml(safeUrl(userSuppliedUrl));
```

`safeUrl` admits `http:`, `https:`, `mailto:`, `tel:` and anything scheme-less — a relative path, a fragment, a query — and collapses the rest to
`"#"`, including protocol-relative forms like `//host` and `/\host`. It strips control characters and whitespace before reading the scheme, so
`java\tscript:` and a leading-newline variant are caught too.

Inside JSX you do not call either one: the renderer already routes URL-bearing attributes through `safeUrl` and escapes the result. The full
account, including why no `hx-*` attribute is covered, is [`SECURITY_HARDENING.md`][sh-2d] §2d.

---

---

## Gotchas

**`html` renders `false` as the text `false`.** Only `null` and `undefined` become the empty string. The JSX habit of writing `${cond && markup}` to
render nothing therefore prints `false` into the page — write `${cond ? markup : null}` instead.

**`SafeHtml` is a class, not a string.** Read the markup out with `String(value)` or by interpolating it; `String.prototype` methods are not on it.
The barrel exports it as a **type only**, and `html` and `rawHtml` are the only ways to make one.

**Calling `html(value)` as a plain function throws a `TypeError`** rather than emitting its argument unescaped.

**`isSafeHtml` is an `instanceof` check**, so it answers `false` across two copies of this module. Forge ships raw TypeScript and a bundler produces
one copy per build, so this only bites when two forge versions are bundled together.

**`escapeHtml` is text-node and quoted-attribute grade.** It is not sufficient inside an unquoted attribute, inside `<script>` or `<style>`, or for
a URL. Quote your attributes, and use `safeUrl` for URLs.

---

## See also

- [`docs/FORGE_ERRORS.md`][eh] — the `html` / `escapeHtml` render paths and the character map (§3)
- [`docs/SECURITY_HARDENING.md`][sh-2d] §2d — automatic `safeUrl` sanitization at JSX render time, and why no `hx-*` attribute is covered
- [`docs/NAMESPACES.md`][namespaces-5m] §5m — why the primitives are a namespace of their own, below both `http` and `render`
- [`src/http/README.md`][http-readme] — the response builders that send what these primitives build
- [`src/render/jsx/README.md`][jsx-readme] — the SSR renderer that escapes through them

[eh]: ../../docs/FORGE_ERRORS.md
[eh-3b]: ../../docs/FORGE_ERRORS.md#3b-html-tagged-template
[eh-3c]: ../../docs/FORGE_ERRORS.md#3c-escapehtml
[http-readme]: ../http/README.md
[jsx-readme]: ../render/jsx/README.md
[namespaces-5m]: ../../docs/NAMESPACES.md#5m-html--safe-markup-primitives
[sh-2d]: ../../docs/SECURITY_HARDENING.md#2d-getnonce-and-automatic-url-sanitization
