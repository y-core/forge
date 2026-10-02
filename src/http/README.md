---
title: HTTP Responses, Headers and Paths
description: "Response builders that fix their own content type, typed header-value builders, a redirect-target guard and a path joiner."
audience: consumer
---

# `@y-core/forge/http`

Every handler in a server-rendered app ends the same way: a `Response` with the right content type and the right headers. This namespace builds
them — body builders that fix the content type so you cannot get it wrong, typed header values, and the guard that keeps a redirect on your own
origin.

```ts
import { createRedirectResponse, fragmentResponse, htmlResponse, jsonResponse } from "@y-core/forge/http";
```

Every HTTP output concern lands here rather than reaching for `@remix-run/headers` directly — [`NAMESPACES.md`][namespaces-5d] §5d owns that split.

---

## Getting started

The body builders cover almost every handler. Each fixes its own `content-type` and **throws** if you pass one in `headers`, in any casing.

```ts
import { fragmentResponse, htmlResponse, jsonResponse, pdfResponse } from "@y-core/forge/http";

htmlResponse("<html>…</html>"); // full page; a leading <!DOCTYPE html> is ensured
fragmentResponse("<div>saved</div>", 200); // HTMX partial; no DOCTYPE, because it is swapped into a live document
jsonResponse({ id: 7 }, 201); // JSON.stringify + application/json; charset=utf-8
pdfResponse(bytes); // rendered bytes + application/pdf
```

The second argument is the status (`200` by default), the third is extra headers.

**`pdfResponse` takes bytes and nothing more.** Whatever rendered them — [`@y-core/forge/render/pdf`][pdf-readme] or a byte array you built yourself
— is this namespace's business only as a `BufferSource`, which is what keeps the dependency one-way. A download filename is a header rather than an
option of its own: build it with `ContentDisposition` (§7) and pass it through `headers`.

```ts
import { ContentDisposition, pdfResponse } from "@y-core/forge/http";

return pdfResponse(bytes, 200, { "content-disposition": new ContentDisposition({ type: "attachment", filename: "declaration.pdf" }).toString() });
```

**If you are rendering JSX, you want `renderPage` from [`@y-core/forge/render/jsx`][jsx-readme] instead** — it calls `htmlResponse` for you. Reach
for `htmlResponse` when you already hold a markup string, and build that string with [`@y-core/forge/html`][html-readme] so every value in it is
escaped. For a fragment, `renderToString` returns `SafeHtml` that `fragmentResponse` takes directly.

```ts
import { fragmentResponse } from "@y-core/forge/http";
import { renderToString } from "@y-core/forge/render/jsx";

return fragmentResponse(await renderToString(<CartRow item={item} />));
```

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

**`safeRedirectPath` strips spaces and control characters anywhere in the candidate, not just at the ends** — `/a b` comes back as `/ab`. A path
that genuinely contains a space must arrive percent-encoded.

**`safeRedirectPath` knows no origin**, so an absolute URL is refused even when it names your own host. Pass it the path, not the URL.

---

## See also

- [`docs/FORGE_ERRORS.md`][eh] — where a fragment's status goes (§2) and the `htmlResponse` render path (§3a)
- [`docs/NAMESPACES.md`][namespaces-5d] §5d — why every HTTP output concern lands here rather than in `@remix-run/headers`, and escaping does not
- [`src/html/README.md`][html-readme] — the escaping primitives and the `SafeHtml` type the body builders take
- [`src/render/htmx/README.md`][htmx-readme] — the status banners and `HX-*` directives a fragment response carries
- [`src/render/jsx/README.md`][jsx-readme] — `renderPage` and `renderToString`, the usual producers of the bodies these builders send
- [`src/session/README.md`][session-readme] — signed and unsigned cookies, preferred over the raw `SetCookie` builder

[eh]: ../../docs/FORGE_ERRORS.md
[html-readme]: ../html/README.md
[htmx-readme]: ../render/htmx/README.md
[jsx-readme]: ../render/jsx/README.md
[namespaces-5d]: ../../docs/NAMESPACES.md#5d-http--responses-headers-and-paths
[pdf-readme]: ../render/pdf/README.md
[session-readme]: ../session/README.md
