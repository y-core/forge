---
title: In-House SSR JSX Runtime
description: "Renders JSX to an HTML string inside the Worker — no virtual DOM, no hydration, no client runtime, and escaping already done for you."
audience: consumer
---

# `@y-core/forge/jsx`

Forge's server-side JSX runtime. It is **not** React: a JSX tree is rendered to an HTML string inside the Worker, with no virtual DOM, no hydration
and nothing shipped to the browser.

Reach for it whenever a handler has to produce HTML — a whole page, a fragment for an htmx swap, or markup that another component embeds.

```ts
import { renderPage, renderToString } from "@y-core/forge/jsx";
```

---

## Getting started

The transform is configuration, not an import. Point `tsconfig.json` at the forge runtime and the compiler auto-imports
`@y-core/forge/jsx/jsx-runtime` for every file containing JSX:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@y-core/forge/jsx" } }
```

Components are then plain functions with no runtime import of their own:

```tsx
function Greeting({ name }: { name: string }) {
  return <p class='greeting'>Hello, {name}!</p>;
}
```

Attributes are spelled the way HTML spells them — `class`, not React's `className`. Set `"jsx": "react-jsxdev"` in a development-only config to get
`@y-core/forge/jsx/jsx-dev-runtime` instead; the rendered output is identical either way.

---

## Returning a page from a handler

`renderPage` renders the tree, prepends `<!DOCTYPE html>` and wraps it in an HTML `Response`. Return it straight from a `definePage` view:

```tsx
import { definePage } from "@y-core/forge/app";
import { renderPage } from "@y-core/forge/jsx";

function HomePage({ title }: { title: string }) {
  return (
    <html lang='en'>
      <head>
        <title>{title}</title>
      </head>
      <body>
        <Greeting name='world' />
      </body>
    </html>
  );
}

export default definePage({
  view: () => renderPage(<HomePage title='Home' />),
});
```

The optional second argument sets the response status and adds headers — where an error page declares itself:

```tsx
return renderPage(<NotFoundPage />, { status: 404, headers: { "cache-control": "no-store" } });
```

Do not pass a `content-type`: the HTML one is fixed, and `@y-core/forge/http` throws when a caller supplies its own.

---

## Returning a fragment

When the caller wants markup rather than a whole document — an htmx swap, an out-of-band update, a string another template embeds — use
`renderToString`. It emits no doctype and no `Response`:

```tsx
import { renderToString } from "@y-core/forge/jsx";
import { fragmentResponse } from "@y-core/forge/http";

const rows = await renderToString(<ResultRows items={items} />);
return fragmentResponse(rows, 200);
```

The result is a `SafeHtml` value — already escaped, and passed through untouched by the renderer and the response builders rather than escaped a
second time.

---

## Awaiting data inside a component

A component may be `async` and `await` whatever it needs. The renderer awaits it in place, so no data has to be threaded down through props:

```tsx
async function User({ id }: { id: string }) {
  const user = await db.getUser(id);
  return <span>{user.name}</span>;
}
```

Anything thenable is awaited, not only an `async function`, so a deferred value of your own works the same way. A subtree with nothing asynchronous
in it costs nothing.

---

## Typing components and composing them

`FC<P>` types a component that takes props and returns markup; `PropsWithChildren<P>` adds `children` to a props type you already have:

```tsx
import type { FC, PropsWithChildren } from "@y-core/forge/jsx";

const Badge: FC<{ label: string }> = ({ label }) => <span class='badge'>{label}</span>;

function Card({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section class='card'>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
```

`JSXNode` is the type of anything renderable — elements, `SafeHtml`, strings, numbers, booleans, `null`, `undefined` and arrays of those. Use it for
a prop that accepts arbitrary markup. Because `false`, `true`, `null` and `undefined` all render to nothing, `{isAdmin && <AdminPanel />}` is safe
as written.

Return siblings without a wrapper element using the shorthand `<>…</>`, which the transform resolves to `Fragment`:

```tsx
function Row() {
  return (
    <>
      <td>A</td>
      <td>B</td>
    </>
  );
}
```

For a component that adapts an element it was handed rather than one it built, `cloneElement` shallow-merges extra props into a copy, and
`isValidElement` narrows an `unknown` to an element this runtime produced — a parsed JSON object cannot pass it.

---

## Embedding HTML you already have

A `SafeHtml` value is written into the output verbatim — the one place escaping stops:

```tsx
import { rawHtml } from "@y-core/forge/http";
import type { SafeHtml } from "@y-core/forge/http";

function Icon({ markup }: { markup: SafeHtml }) {
  return <span class='icon'>{markup}</span>;
}

const icon = rawHtml(await loadVettedIconSprite());
```

**Only call `rawHtml` on markup you control.** Request data, database text and anything a user could influence must reach the renderer as a plain
string, which is escaped for you. Wrapping untrusted input in `rawHtml` is an XSS hole, and no later step will catch it.

---

## Building through esbuild's classic JSX fallback

Some build paths fall back to esbuild's zero-config classic transform, which emits `React.createElement` and `React.Fragment`. Import the register
shim once, at the application entry point, to point that global at forge's runtime:

```ts
import "@y-core/forge/jsx/register";
```

Nothing else imports it, and a project whose `jsxImportSource` is configured never needs it.

---

## Gotchas

**A number renders, so `{items.length && <List />}` emits `0` for an empty list.** Compare explicitly — `{items.length > 0 && <List />}`.

**An inline `style` attribute type-checks and is then dropped from the output.** Style with classes; the ruling is
[`UI_SSR_COMPONENTS.md`][usc-1a] §1a's.

**URL-bearing attributes are sanitized for you, and `hx-*` attributes are not.** `href`, `src`, `action` and their kin go through `safeUrl` at
render time ([`SECURITY_HARDENING.md`][sh-2d] §2d); why no htmx attribute is in that set is [`HTMX.md`][htmx-7a] §7a's.

**Spreading a props bag cannot inject an attribute.** A key that is not a well-formed attribute name is dropped rather than emitted, so an untrusted
key like `" onmouseover"` never reaches the output. The values under trusted keys are still yours to vet.

**A computed tag name is validated.** Rendering an element whose tag is not a legal HTML tag name throws rather than emitting broken markup.

**`aria-*` booleans are serialized, ordinary booleans are not.** `aria-expanded={false}` emits `aria-expanded="false"`, because an absent one means
"not expandable at all"; `disabled={false}` emits nothing.

---

## See also

- [`src/http/README.md`][http-readme] — the response builders, `rawHtml`, and the `SafeHtml` brand this renderer passes through
- [`src/ui/README.md`][ui-readme] — the SSR component library built on this runtime
- [`docs/FORGE_ERRORS.md`][eh-3] §3 — the `html` tag and `escapeHtml`, for building HTML outside JSX
- [`docs/SECURITY_HARDENING.md`][sh-2d] §2d — automatic URL sanitization at render time, and its limits
- [`docs/UI_SSR_COMPONENTS.md`][usc-1a] §1a — dropped and unsanitized pass-through attributes

[eh-3]: ../../docs/FORGE_ERRORS.md#3-htmlresponse-html-tag-and-escapehtml
[htmx-7a]: ../../docs/HTMX.md#7a-url-valued-hx-attributes-are-deliberately-unsanitized
[http-readme]: ../http/README.md
[sh-2d]: ../../docs/SECURITY_HARDENING.md#2d-getnonce-and-automatic-url-sanitization
[ui-readme]: ../ui/README.md
[usc-1a]: ../../docs/UI_SSR_COMPONENTS.md#1a-dropped-and-unsanitized-pass-through-attributes
