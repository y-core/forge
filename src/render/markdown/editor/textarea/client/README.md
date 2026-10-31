---
title: Markdown Textarea
description: "Markdown list continuation, wrap shortcuts and Mod-Enter submit for plain textareas, from one delegated listener and with no CodeMirror."
audience: consumer
---

# `@y-core/forge/render/markdown/editor/textarea/client`

Markdown editing keys for a plain `<textarea>`: Enter continues a list, Mod-B, Mod-I, Mod-E and Mod-K wrap the selection, and Mod-Enter submits
the form. The edits are the commands from `@y-core/forge/render/markdown`, so a list item is whatever the renderer reads as one. It loads no
CodeMirror; for a rendered, decorated editor use the [viewport][viewport].

```ts
import { mountMarkdownTextarea } from "@y-core/forge/render/markdown/editor/textarea/client";
import type { MarkdownTextareaOptions } from "@y-core/forge/render/markdown/editor/textarea/client";
```

It runs only in the browser.

---

## Adding markdown keys to a form

Mark each textarea with `data-markdown`, then mount once on an element that contains them. One listener serves every marked textarea inside it,
including ones swapped in later, so mount the form or the page region rather than each field.

```html
<form id="comment">
  <textarea name="body" data-markdown></textarea>
  <textarea name="note"></textarea>
</form>
```

```ts
const dispose = mountMarkdownTextarea(form, { onSubmit: (textarea) => textarea.form?.requestSubmit() });
```

A textarea without `data-markdown` keeps its plain keys. Mounting the same element again returns the first disposer, so setup that runs twice
does not bind the keys twice.

## What each key does

Enter at the end of a list item starts the next one, and Enter on an empty item ends the list; anywhere else it is a plain line break. The rules
are `continueList`'s, in [Editing markdown as it is typed][editing]. Mod-B, Mod-I, Mod-E and Mod-K write `**`, `*`, a backtick or link brackets
around the selection, or remove them where they already surround it; Mod-K selects `url` to type over. Mod is Cmd on Apple platforms and Ctrl
elsewhere, as in the viewport, so the other key keeps its native editing.

Mod-Enter calls `onSubmit` with the textarea and inserts nothing. Without `onSubmit` the key is left to the browser.

Every edit goes through the browser's own editing, so undo takes it back like typing, and the textarea fires `input` as it does for typing.

A key is left alone while Shift or Alt is held, while an input method is composing, in a `readonly` textarea, and when another listener has
already called `preventDefault()`, so a handler on the textarea itself wins.

## Tearing it down

Call the disposer when the region goes away. It removes the listener, and mounting again afterwards starts fresh.

[editing]: ../../../README.md#editing-markdown-as-it-is-typed
[viewport]: ../../client/README.md
