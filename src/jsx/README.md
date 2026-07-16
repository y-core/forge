# `@y-core/forge/jsx`

Forge's in-house server-side rendering (SSR) JSX runtime. It is **not** React — there is no virtual
DOM, no hydration, and no client runtime. JSX trees are rendered straight to an HTML string on the
server (a Cloudflare Worker), with security defaults baked into the renderer.

Two facts up front, because they are the most common source of import mistakes:

1. **The JSX transform is wired through `tsconfig`, not a manual import.** You set
   `"jsxImportSource": "@y-core/forge/jsx"` and the TypeScript compiler auto-imports
   `@y-core/forge/jsx/jsx-runtime` for every `.tsx` file. Outside the renderer entry points
   (below), you rarely import from the `jsx` namespace directly.
2. **The renderer lives at `@y-core/forge/jsx`.** `renderPage` and `renderToString` are imported
   from the `@y-core/forge/jsx` barrel. The former `@y-core/forge/render` subpath has been
   removed — these symbols are now public only via `@y-core/forge/jsx`.

---

## Features

- **Zero-runtime SSR** — JSX compiles to plain element objects and renders to an HTML string. Nothing
  ships to the browser from this package.
- **Async function components** — components may be `async` and `await` data; the renderer awaits them
  and only enters the microtask queue when a subtree is actually asynchronous (synchronous subtrees
  render without Promise overhead).
- **Security defaults in the renderer** — HTML-escaping of text and attribute values, URL-attribute
  scheme sanitization (blocks `javascript:` injection), and CSP-aligned dropping of inline `style`
  attributes.
- **Full HTML + SVG typing** — `IntrinsicElements` covers standard HTML, SVG, ARIA, and `hx-*` (htmx)
  attributes, plus a catch-all for `data-*`.
- **Drop-in transform compatibility** — supports the automatic JSX runtime, a dev runtime, and a
  classic-mode `React.createElement` shim for esbuild's zero-config fallback.

---

## Usage

### 1. Configure the JSX transform

Point your `tsconfig.json` at the forge runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@y-core/forge/jsx"
  }
}
```

With `jsx: "react-jsx"`, the compiler auto-imports `@y-core/forge/jsx/jsx-runtime` in every file that
uses JSX. You write components with no manual runtime import:

```tsx
function Greeting({ name }: { name: string }) {
  return <p class="greeting">Hello, {name}!</p>;
}
```

> Note: forge uses the HTML attribute name `class`, not React's `className`.

### 2. Render a full page

Use `renderPage` inside a page view function to produce a complete HTML `Response` (it prepends
`<!DOCTYPE html>`):

```tsx
import { renderPage } from "@y-core/forge/jsx";

async function HomePage() {
  return (
    <html lang="en">
      <head>
        <title>Home</title>
      </head>
      <body>
        <Greeting name="world" />
      </body>
    </html>
  );
}

export async function view(): Promise<Response> {
  return renderPage(<HomePage />);
}
```

### 3. Render a fragment

When you need the HTML string rather than a full-page `Response` (partial responses, embedding,
htmx swaps), use `renderToString`:

```tsx
import { renderToString } from "@y-core/forge/jsx";

const safe = await renderToString(<Greeting name="forge" />);
// safe is a SafeHtml value: <p class="greeting">Hello, forge!</p>
```

### 4. Enable the classic-mode shim (esbuild zero-config)

If a build path falls back to esbuild's classic JSX (`React.createElement` / `React.Fragment`),
import the register shim **once** at your application entry point. It installs a `React` global that
resolves to forge's runtime:

```ts
import "@y-core/forge/jsx/register";
```

You do not need this when `jsxImportSource` is configured for the automatic runtime — it is only for
the classic fallback path.

---

## Core Components & APIs

### Export paths

| Import path | Source | Purpose |
|---|---|---|
| `@y-core/forge/jsx/jsx-runtime` | `jsx-runtime.ts` | Automatic JSX transform runtime — auto-imported by the compiler. |
| `@y-core/forge/jsx/jsx-dev-runtime` | `jsx-dev-runtime.ts` | Dev-mode JSX runtime (`jsxDEV`). |
| `@y-core/forge/jsx/register` | `register.ts` | Classic-mode shim for esbuild's zero-config fallback. |
| `@y-core/forge/jsx` | `mod.ts` | `renderPage` / `renderToString` — the public renderer (namespace barrel). |

You import directly from `jsx-runtime`, `jsx-dev-runtime`, or `register` only in build configuration
or app entry setup — never to call a function in component code.

### `renderPage(node, init?)`

Renders a JSX tree to a full-page HTML `Response`, prepending the HTML5 doctype. Import from
`@y-core/forge/jsx`. Use it in `definePage` view functions, 404 handlers, and any handler that
returns a complete HTML document.

```ts
function renderPage(
  node: JSXNode,
  init?: { status?: number; headers?: Record<string, string> },
): Promise<Response>;
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `node` | `JSXNode` | — | The JSX tree to render. |
| `init.status` | `number` | `200` | HTTP status code for the response. |
| `init.headers` | `Record<string, string>` | — | Extra response headers, merged with the HTML content type. |

Returns a `Promise<Response>` whose body is `<!DOCTYPE html>` followed by the rendered HTML.

```tsx
import { renderPage } from "@y-core/forge/jsx";

export async function notFound(): Promise<Response> {
  return renderPage(<NotFoundPage />, { status: 404 });
}
```

### `renderToString(node)`

Renders a JSX tree to a `SafeHtml` value (no doctype, no `Response` wrapper). Import from
`@y-core/forge/jsx`.

```ts
function renderToString(node: unknown): Promise<SafeHtml>;
```

| Parameter | Type | Description |
|---|---|---|
| `node` | `JSXNode` | The JSX tree to render. |

Returns a `Promise<SafeHtml>` — a string branded as safe, already escaped. Use it for partial HTML
responses or to compose markup that another `SafeHtml` template embeds.

### `Fragment`

Renders its children without a wrapper element. Use the shorthand `<>…</>` or `<Fragment>…</Fragment>`
(the shorthand resolves to `Fragment` via the transform).

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

### Component types

These types are available through the JSX transform configuration. You typically annotate component
signatures with them rather than importing them directly in component code.

#### `FC<P>`

Functional component type: receives props (plus an optional `children`) and returns a `JSXElement` or
`null`.

```tsx
import type { FC } from "@y-core/forge/jsx";

const Badge: FC<{ label: string }> = ({ label }) => <span class="badge">{label}</span>;
```

#### `PropsWithChildren<P>`

Adds `children?: JSXNode` to any props type.

```tsx
function Card({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section class="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
```

#### `JSXNode`

The union of every renderable value: `JSXElement`, `SafeHtml`, `string`, `number`, `boolean`, `null`,
`undefined`, and arrays thereof. `false`, `true`, `null`, and `undefined` render to empty output —
which makes conditional rendering with `&&` safe:

```tsx
{isAdmin && <AdminPanel />}
```

#### `JSXElement`

The element object produced by the runtime, discriminated by `$jsx: true`. You rarely construct these
by hand; the JSX transform produces them.

---

## Architecture

### How JSX becomes HTML

1. The TypeScript compiler (driven by `jsxImportSource`) rewrites JSX syntax into calls to `jsx` /
   `jsxs` from `@y-core/forge/jsx/jsx-runtime` (or `jsxDEV` from the dev runtime). Each call delegates
   to `createElement`, producing a plain `JSXElement` object: `{ type, props, key, $jsx: true }`.
2. `renderToString` (or `renderPage`) walks that tree. Function components are invoked with their
   props; `Fragment` is detected by reference and its children are rendered without a wrapper;
   intrinsic elements emit `<tag …>children</tag>`.
3. The result is wrapped as `SafeHtml`. `renderPage` additionally prepends `<!DOCTYPE html>` and wraps
   it in an HTML `Response`.

### Synchronous fast path with async escape hatch

The renderer renders synchronously whenever it can. A subtree that contains no async components and no
async children is joined into a string without ever entering the microtask queue. The moment a
function component returns a thenable (or an async child appears), the renderer awaits it and the
enclosing subtree resolves through a `Promise`. Async components are detected by duck-typed thenable
check, so custom thenables (such as deferred islands) are awaited too.

```tsx
async function User({ id }: { id: string }) {
  const user = await db.getUser(id);
  return <span>{user.name}</span>;
}
```

### Security defaults

The renderer is the security boundary for SSR output:

| Concern | Behaviour |
|---|---|
| Text content | HTML-escaped. |
| Attribute values | HTML-escaped. |
| URL attributes (`href`, `src`, `action`, `formaction`, `poster`, `cite`, …) | Scheme-sanitized to block `javascript:`-style injection. |
| Inline `style` attributes | **Silently dropped** — not emitted in the HTML. The shipped CSP uses `style-src 'self'` (no `'unsafe-inline'`), so an inline `style` would be blocked by the browser anyway. |
| Boolean attributes (`disabled`, `checked`, `required`, …) | Emitted as a bare attribute name when truthy, omitted when falsy. |
| `aria-*` truthy values | Emitted as string `"true"` per the WAI-ARIA spec. |
| Void elements (`br`, `img`, `input`, `hr`, …) | Emitted with no closing tag and no children. |

Because inline `style` is dropped, move styling to classes (Tailwind/CSS) — a `style="…"` prop will
not appear in the output even though it type-checks.

### Embedding pre-rendered HTML

A `SafeHtml` value passes through the renderer unescaped. Produce one with `rawHtml` from
`@y-core/forge/http` only for content you have already vetted as safe — never wrap untrusted input.

```tsx
import { rawHtml } from "@y-core/forge/http";

function Icon({ markup }: { markup: SafeHtml }) {
  return <span class="icon">{markup}</span>; // SafeHtml renders verbatim
}
```

### Runtime variants

| Runtime | Export | When used |
|---|---|---|
| Automatic | `jsx`, `jsxs`, `Fragment` | Production transform with `jsx: "react-jsx"`. `jsxs` is an alias of `jsx`. |
| Dev | `jsxDEV`, `Fragment` | Dev transform with `jsx: "react-jsxdev"`. |
| Classic shim | `register` side-effect | esbuild zero-config fallback; installs a `React` global mapping `createElement`/`Fragment` to the forge runtime. |

All three converge on the same `createElement` factory and the same `renderToString` walk — the choice
of runtime affects only how the compiler emits element-construction calls, never the rendered output.
