---
title: Markdown Editor
description: "A browser-only CodeMirror viewport for one markdown document, driven through one controller, decorating the dialect an app injects."
audience: consumer
---

# `@y-core/forge/render/markdown/editor/client`

A markdown viewport for one document, and the one surface through which your page drives it. Mount it on a host element a single time, switch
it between editing and viewing and between rendered and raw markdown, and nothing else on the page imports CodeMirror.

```ts
import { createAutosave, mountMarkdownViewport } from "@y-core/forge/render/markdown/editor/client";
import type { ViewportController, ViewportDialect } from "@y-core/forge/render/markdown/editor/client";
```

It runs only in the browser, and CodeMirror is an optional peer: install `@codemirror/commands`, `@codemirror/lang-markdown`,
`@codemirror/language`, `@codemirror/state` and `@codemirror/view` in the app that mounts it.

---

## Mounting a viewport

Mount the viewport on an empty host with the markdown, the state to open in, an accessible name, the element that scrolls it, and the function
to call when the text changes. Drive it only through the controller it returns.

```ts
import { mountMarkdownViewport } from "@y-core/forge/render/markdown/editor/client";

const viewport = mountMarkdownViewport(host, {
  markdown: page.markdown,
  mode: "edit",
  rendering: "rendered",
  label: "Page body",
  scroller,
  onChange: () => autosave.touch(),
  dialect: APP_DIALECT,
});
```

Take the controller as a parameter wherever it is used; never reach for the editor underneath. `getMarkdown()` answers the text exactly as
typed, byte for byte.

## Decorating your dialect

With no `dialect`, the viewport decorates CommonMark and GFM alone. To draw your own constructs, pass a `ViewportDialect`:

- `spans(text)` answers where your constructs sit in one top-level block's text, with offsets relative to that text. A `wikilink` with a
  `chip` is replaced by an atomic chip showing its label; one without is marked unresolved. An `embed` becomes a chip showing its alt text,
  and a `tag`, `highlight` or `due` is marked. Nothing the viewport would otherwise decorate inside a span is decorated.
- `calloutKinds` names the kinds a `> [!kind]` blockquote may open with; each line of one gets `cm-md-callout cm-md-callout-<kind>`.
- `theme` is a CodeMirror extension added after the viewport's own, for styling those classes per kind.

Build `spans` on the same constructs you parse with, so the editor and your rendered page agree:

```ts
import { parseMarkdown, walkMarkdown } from "@y-core/forge/render/markdown";
import type { DialectSpan, ViewportDialect } from "@y-core/forge/render/markdown/editor/client";
import { EditorView } from "@codemirror/view";

export const APP_DIALECT: ViewportDialect = {
  spans: (text) => {
    const spans: DialectSpan[] = [];
    walkMarkdown(parseMarkdown(text, SYNTAX), (node, { base }) => {
      if (node.type === "tag") spans.push({ kind: "tag", from: base + node.start, to: base + node.end });
      return undefined;
    });
    return spans;
  },
  calloutKinds: ["note", "warning"],
  theme: EditorView.theme({ ".cm-md-callout-warning": { borderInlineStartColor: "var(--foreground)" } }),
};
```

The viewport keeps each block's spans between passes while its text is unchanged, so `spans` may parse.

## Switching mode and rendering

`setMode("edit")` lets the reader type and `setMode("view")` makes the text read-only. `setRendering("rendered")` hides markdown marks, showing
them again only on the lines the cursor touches while editing, and `setRendering("raw")` shows every mark. Every combination shares one
editor, which is never re-created, so undo history and the selection survive every switch. Switching never moves focus, and a call naming the
current state does nothing.

A task's checkbox ticks the task in an editable viewport, and is disabled in a read-only one.

## Keeping the reader's place

`topAnchor()` answers the source line at the top of `scroller` and the client Y its top sits at; `scrollTo(anchor)` scrolls `scroller` until that
line sits there again. While the host is shown, `setMode` and `setRendering` keep the viewport's own place; while it is hidden they only
reconfigure, and the place is yours to keep.

When you swap the viewport for another surface or back, read the anchor from whatever is showing before the swap, switch, show the other
surface, and only then place the anchor on it. Only the latest `scrollTo` lands, and none lands once the host is hidden. A placement gives way
to the reader: a wheel, a touch or a press on `scroller`, or a scrolling key anywhere on the page, ends it where the reader took over.

```ts
const anchor = viewport.topAnchor();
viewport.setMode("view");
showArticle();
scrollArticleTo(anchor);
```

## Replacing the text from outside

When the text changes somewhere other than the viewport — a merge with another device's edit, a refresh from the server — hand the new text
to `replace`. It lands as one change, so the reader's own undo history skips it and never brings the old text back.

```ts
viewport.replace(merged.markdown, { preserveSelection: true });
```

With `preserveSelection`, the cursor and selection stay on the text they were on: only the lines that differ are replaced, so a cursor on a line
both versions share keeps its place, and one inside a changed span moves to that span's start. A wholesale rewrite is replaced as one span. Without
it, the cursor returns to the start of the text. `replace` works in either mode, and it does not call `onChange`: the text you just handed in is not
an edit to save.

## Saving as the reader types

`createAutosave` decides when to save; you decide how. Touch it from `onChange`, which runs on every change to the text, and flush it before
the page goes away.

```ts
import { createAutosave } from "@y-core/forge/render/markdown/editor/client";

const autosave = createAutosave({
  save: () => queueSave(viewport.getMarkdown()),
  timers: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id) },
});
window.addEventListener("pagehide", () => autosave.flush());
```

It saves once the reader pauses for `AUTOSAVE_DEBOUNCE_MS`, and at the latest `AUTOSAVE_MAX_WAIT_MS` after the first unsaved touch. Pass
`debounceMs` or `maxWaitMs` to change either, and fake `timers` in a test. `dirty()` answers whether a touch has not been saved yet.

## Styling it

The viewport renders inside the host's open shadow root, so page classes and utilities do not reach it. It takes the page's CSS custom
properties, which cross the shadow boundary: set forge's theme variables (`--foreground`, `--primary`, `--border` and the rest) on the host or
an ancestor to restyle it, and dark mode follows on its own. Headings and code read `--md-h1-size` to `--md-h6-size`, `--md-h1-weight` to
`--md-h6-weight` and `--md-code-font`. Size and space the host itself from the page.

## Tearing it down

Call `destroy()` when the page goes away. It empties the shadow root, so the same host can mount again. Flush the autosave first:
`dispose()` drops a touch still waiting out its debounce, and an in-app navigation fires no `pagehide`.

```ts
autosave.flush();
autosave.dispose();
viewport.destroy();
```
