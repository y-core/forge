---
title: Renderers
description: "Pick the renderer for what a Worker is producing — an HTML page or fragment, an htmx answer, rendered markdown, or a PDF document."
audience: consumer
---

# `@y-core/forge/render`

Everything that turns data into a document lives under `render`. **There is no top-level `render` barrel.** Import from the subpath for what you
are producing:

- `@y-core/forge/render/jsx` — server-rendered HTML from JSX components: a whole page with `renderPage`, a fragment with `renderToString`
- `@y-core/forge/render/htmx` — the htmx half of a route: reading `HX-*` request headers, emitting `hx-*` attributes, the `HX-*` response
  directives and the status banners a swap answers with
- `@y-core/forge/render/markdown` — CommonMark and GFM parsed to a tree and rendered to HTML, with the dialect constructs an app composes
- `@y-core/forge/render/pdf` — a PDF document from the same component style, measured, paginated and written in the Worker

Each child's own README teaches it. Sending what a renderer produced is [`@y-core/forge/http`][http-readme]'s — `htmlResponse`,
`fragmentResponse` and `pdfResponse` take the result without knowing which renderer made it.

---

## Gotchas

**The htmx status banners render Tailwind classes `forge.css` does not scan.** Add an `@source` line for `src/render/htmx` to your own stylesheet,
or pass your own classes — [`src/render/htmx/README.md`][htmx-readme] has both.

---

## See also

- [`src/render/jsx/README.md`][jsx-readme] — the SSR runtime, `renderPage` and `renderToString`
- [`src/render/htmx/README.md`][htmx-readme] — htmx request headers, attributes, response directives and status banners
- [`src/render/markdown/README.md`][markdown-readme] — the markdown engine and its editor
- [`src/render/pdf/README.md`][pdf-readme] — the PDF document engine
- [`docs/NAMESPACES.md`][namespaces-5j] §5j — why every renderer is a child of this container, and the one naming carve-out `render/pdf` takes

[htmx-readme]: ./htmx/README.md
[http-readme]: ../http/README.md
[jsx-readme]: ./jsx/README.md
[markdown-readme]: ./markdown/README.md
[namespaces-5j]: ../../docs/NAMESPACES.md#5j-render--one-namespace-per-renderer
[pdf-readme]: ./pdf/README.md
