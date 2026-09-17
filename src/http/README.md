---
title: HTTP Responses and Safe HTML
description: "Response builders, typed header-value builders, and a safe-HTML toolkit that escapes every interpolation by default."
audience: consumer
---

# `@y-core/forge/http`

Every handler in a server-rendered app ends the same way: a `Response` with the right content type, carrying markup that did not let a user's name
become a `<script>` tag. This namespace is those two jobs — builders that fix the content type so you cannot get it wrong, and a tagged template
that escapes by default so you have to opt out of safety rather than into it.

```ts
import { fragmentResponse, html, htmlResponse, jsonResponse } from "@y-core/forge/http";
```

Every HTTP output concern lands here rather than reaching for `@remix-run/headers` directly — [`NAMESPACES.md`][namespaces-5d] §5d owns that split.

---

## Getting started

The body builders cover almost every handler. Each fixes its own `content-type` and **throws** if you pass one in `headers`, in any casing — a
response whose declared type disagrees with its bytes is a bug worth failing on rather than ignoring.

```ts
import { fragmentResponse, htmlResponse, jsonResponse } from "@y-core/forge/http";

htmlResponse("<html>…</html>"); // full page; a leading <!DOCTYPE html> is ensured
fragmentResponse("<div>saved</div>", 200); // HTMX partial; no DOCTYPE, because it is swapped into a live document
jsonResponse({ id: 7 }, 201); // JSON.stringify + application/json; charset=utf-8
```

The second argument is the status (`200` by default), the third is extra headers.

**If you are rendering JSX, you want `renderPage` from [`@y-core/forge/jsx`][jsx-readme] instead** — it calls `htmlResponse` for you. Reach for
`htmlResponse` when you already hold a markup string. For a fragment, `renderToString` returns `SafeHtml` that `fragmentResponse` takes directly.

```ts
import { fragmentResponse } from "@y-core/forge/http";
import { renderToString } from "@y-core/forge/jsx";

return fragmentResponse(await renderToString(<CartRow item={item} />));
```

---

## Interpolating a value into markup safely

The `html` tagged template escapes every `${…}` it interpolates, so a value that arrives from a request cannot close a tag or open a script.

```ts
import { html } from "@y-core/forge/http";

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
import { html, rawHtml } from "@y-core/forge/http";

html`<div>${rawHtml(trustedMarkupFromAnotherRenderer)} ${userInput}</div>`; // only userInput is escaped
```

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
import { escapeHtml, safeUrl } from "@y-core/forge/http";

const href = escapeHtml(safeUrl(userSuppliedUrl));
```

`safeUrl` admits `http:`, `https:`, `mailto:`, `tel:` and anything scheme-less — a relative path, a fragment, a query — and collapses the rest to
`"#"`, including protocol-relative forms like `//host` and `/\host`. It strips control characters and whitespace before reading the scheme, so
`java\tscript:` and a leading-newline variant are caught too.

Inside JSX you do not call either one: the renderer already routes URL-bearing attributes through `safeUrl` and escapes the result. The full
account, including why no `hx-*` attribute is covered, is [`SECURITY_HARDENING.md`][sh-2d] §2d.

---

## Answering an HTMX submission with a status banner

`renderSuccess`, `renderError` and `renderValidationErrors` return pre-styled banner markup as `SafeHtml` — not a `Response`. **The status goes on
`fragmentResponse`, not on the renderer** ([`FORGE_ERRORS.md`][eh-2] §2).

```ts
import { fragmentResponse, renderSuccess, renderValidationErrors } from "@y-core/forge/http";

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
Tailwind to have seen this directory — `forge.css` deliberately does not scan `src/http`, so add the source path to your own stylesheet:

```css
@source "../node_modules/@y-core/forge/src/http";
```

The path is relative to the stylesheet you write it in; [`forge.css`][forge-css] documents the same pattern for the other opt-in surfaces. Pass your
own `class` and `ulClass` instead and you need none of that — the defaults are never emitted.

`successAttr` is the marker attribute stamped on the success wrapper, `data-success` by default, so client code and tests can find it. It is the one
option interpolated verbatim rather than escaped; keep it a literal you wrote, never anything derived from a request.
[`FORGE_ERRORS.md`][eh-2d] §2d owns why the two option kinds differ, and `renderSuccess` throws on a name that is not a valid HTML identifier.

---

## Redirecting after a side effect

`createRedirectResponse` takes a location and either a status number or a whole `ResponseInit`:

```ts
import { createRedirectResponse } from "@y-core/forge/http";

createRedirectResponse("/dashboard", 303); // after a successful form POST
createRedirectResponse(new URL("https://example.com/next")); // a URL is stringified; 302 by default
createRedirectResponse("/dashboard", { status: 303, headers: { "cache-control": "no-store" } });
```

Reach for the `ResponseInit` form whenever you need headers — there is no third argument, and the number form is a shorthand for the status alone.
The body is always `null`, and a `Location` header you supply yourself is kept rather than overwritten.

---

## Returning a visitor to where they came from

A `?next=` value, a hidden form field or a stored return target is attacker-controlled: left alone it turns your own redirect into an open one.
`safeRedirectPath` reduces it to a same-origin path, or hands back your fallback.

```ts
import { createRedirectResponse, safeRedirectPath } from "@y-core/forge/http";

const next = safeRedirectPath(url.searchParams.get("next"), "/dashboard");
return createRedirectResponse(next, 303);
```

| Candidate | Result |
| --- | --- |
| `/dashboard?tab=1#top` | `/dashboard?tab=1#top` |
| `/foo/../bar` | `/bar` — resolved and normalised |
| `//evil.example`, `/\evil.example` | the fallback — a browser reads both as a host |
| `/..//evil.example/x` | the fallback — normalisation can open an authority the raw string did not have |
| `https://evil.example/x`, `javascript:alert(1)` | the fallback |
| `#top`, `?`, `""`, `null` | the fallback |

The fallback is returned verbatim and never checked, so make it a literal in your source rather than a second untrusted value.

---

## Setting a header other than `content-type`

`ContentType`, `CacheControl`, `SetCookie`, `Accept`, `Vary`, `ContentDisposition`, `ContentRange` and `Range` build a header **value** from a typed
object instead of a hand-written string. Construct one with `new`, then stringify it:

```ts
import { CacheControl, fragmentResponse } from "@y-core/forge/http";

return fragmentResponse(body, 200, { "cache-control": new CacheControl({ maxAge: 3600, public: true }).toString() });
```

They produce a value, not a `Headers` object, so the result goes wherever a header string goes — a builder's `headers` argument, a `ResponseInit`,
or `headers.set(…)`. Each also has a static `from(value)` that parses an existing header value back into an instance, which is how you read one
off an inbound request and change a single field.

What they cannot do for you: **the body builders each pin their own `content-type`**, so use a raw `Response` on the rare occasion you
need to set it explicitly. For application cookies prefer `createSignedCookie` / `createUnsignedCookie` from
[`@y-core/forge/session`][session-readme], which handle signing and parsing; `SetCookie` is the low-level builder underneath, for raw header values.

---

## Composing a URL path

`joinPath` glues a base and any number of segments into one path, collapsing the duplicate slashes that come from concatenating configured values,
and trimming a trailing one. A leading slash survives if the base had one.

```ts
import { joinPath } from "@y-core/forge/http";

joinPath("/showcase/"); // "/showcase"
joinPath("/showcase/ui/api", "preview"); // "/showcase/ui/api/preview"
joinPath("showcase", "ui", "preview"); // "showcase/ui/preview"
```

---

## Gotchas

**`html` renders `false` as the text `false`.** Only `null` and `undefined` become the empty string. The JSX habit of writing `${cond && markup}` to
render nothing therefore prints `false` into the page — write `${cond ? markup : null}` instead.

**`SafeHtml` is a class, not a string.** Read the markup out with `String(value)` or by interpolating it; `String.prototype` methods are not on it.
The barrel exports it as a **type only**, which is deliberate: `html` and `rawHtml` are the only ways to make one, so a plain string can never be
mistaken for vetted markup.

**Calling `html(value)` as a plain function throws a `TypeError`** rather than emitting its argument unescaped. This is the one mistake that would
silently turn the whole defence off, so it is refused loudly.

**`isSafeHtml` is an `instanceof` check**, so it answers `false` across two copies of this module. Forge ships raw TypeScript and a bundler produces
one copy per build, so this only bites when two forge versions are bundled together.

**`escapeHtml` is text-node and quoted-attribute grade.** It is not sufficient inside an unquoted attribute, inside `<script>` or `<style>`, or for
a URL. Quote your attributes, and use `safeUrl` for URLs.

**`safeRedirectPath` strips spaces and control characters anywhere in the candidate, not just at the ends** — `/a b` comes back as `/ab`. A path
that genuinely contains a space must arrive percent-encoded.

**`safeRedirectPath` knows no origin**, so an absolute URL is refused even when it names your own host. Pass it the path, not the URL.

---

## See also

- [`docs/FORGE_ERRORS.md`][eh] — the fragment renderers' contract and where the status goes (§2), the option-escaping split (§2d), and the
  `htmlResponse` / `html` / `escapeHtml` render paths (§3)
- [`docs/SECURITY_HARDENING.md`][sh-2d] §2d — automatic `safeUrl` sanitization at JSX render time, and why no `hx-*` attribute is covered
- [`docs/NAMESPACES.md`][namespaces-5d] §5d — why every HTTP output concern lands here rather than in `@remix-run/headers`
- [`src/jsx/README.md`][jsx-readme] — `renderPage` and `renderToString`, the usual producers of the bodies these builders send
- [`src/session/README.md`][session-readme] — signed and unsigned cookies, preferred over the raw `SetCookie` builder

[eh]: ../../docs/FORGE_ERRORS.md
[eh-2]: ../../docs/FORGE_ERRORS.md#2-fragment-renderers-http-namespace
[eh-2d]: ../../docs/FORGE_ERRORS.md#2d-fragment-options-and-escaping
[eh-3b]: ../../docs/FORGE_ERRORS.md#3b-html-tagged-template
[eh-3c]: ../../docs/FORGE_ERRORS.md#3c-escapehtml
[forge-css]: ../ui/assets/css/forge.css
[jsx-readme]: ../jsx/README.md
[namespaces-5d]: ../../docs/NAMESPACES.md#5d-http--all-http-output-concerns
[session-readme]: ../session/README.md
[sh-2d]: ../../docs/SECURITY_HARDENING.md#2d-getnonce-and-automatic-url-sanitization
