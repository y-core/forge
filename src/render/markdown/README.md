---
title: Markdown
description: "A linear-time CommonMark and GFM engine that renders only through an allowlist writer, with dialect constructs an app composes into its own syntax."
audience: consumer
---

# `@y-core/forge/render/markdown`

Markdown parsed the same way in a Worker, a Durable Object, a service worker and the browser. `parseMarkdown` turns a source into a tree,
`renderMarkdownHtml` writes that tree as HTML through an allowlist, and no sanitising pass runs afterwards because nothing outside the
allowlist can be written. Raw HTML in the source is never recognised; it stays text.

```ts
import { parseMarkdown, renderMarkdownHtml } from "@y-core/forge/render/markdown";
import type { HtmlSchema } from "@y-core/forge/render/markdown";
```

The CodeMirror viewport for the same markdown is a separate, browser-only subpath: [`editor/client/README.md`][editor].

---

## Rendering a document

The engine ships no ready-made schema: what may reach the page, and which URLs are safe, is your decision. A schema names every element the
writer may emit and the policy every URL attribute passes through.

```ts
import { isSafeUrl, parseMarkdown, renderMarkdownHtml } from "@y-core/forge/render/markdown";
import type { HtmlSchema } from "@y-core/forge/render/markdown";
import { rawHtml } from "@y-core/forge/html";

const schema: HtmlSchema = {
  elements: { p: {}, em: {}, strong: {}, code: {}, a: { attributes: ["href", "title"], urls: ["href"], requires: ["href"] } },
  url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
};

const body = rawHtml(renderMarkdownHtml(parseMarkdown(source), { schema }));
```

What the writer does with a schema:

- an element the schema does not name is dropped, and its text is kept, escaped;
- an attribute its rule does not list is dropped, and one its `patterns` entry does not match is dropped;
- every attribute in `urls` passes through `schema.url`, which returns the value to write or `null` to drop it;
- an element missing any attribute in `requires` is unwrapped, so a link whose URL was refused becomes its text.

Text is escaped with hexadecimal references — `&#x26;` and `&#x3C;`, plus `&#x22;`, `&#x27;`, `&#x60;`, `&#x3c;` and `&#x3e;` in attributes
— and URLs are percent-encoded before the policy sees them. `isSafeUrl` is a ready policy: relative URLs, `https`, and
`mailto` on a link, never a protocol-relative URL or a scheme hidden behind control characters.

To render a node type differently, pass `handlers`: each `MarkdownNodeHandler` writes on `enter` and `leave`, `children` chooses what is
rendered inside it, and `layout` says whether those children are laid out inline or as blocks. `lineAnchors: true` adds `data-line` — the
1-based source line — to each top-level element, for a schema that allows it. `classNames` renames or drops the classes the engine writes,
and `footnotes` renames the footnote ids.

To write markup of your own under the same rules, open the writer directly:

```ts
import { createHtmlWriter } from "@y-core/forge/render/markdown";

const writer = createHtmlWriter(schema);
writer.open("a", [["href", url]]);
writer.text(label);
writer.close();
writer.html(); // the link survives only if `schema.url` kept its href
```

A document's link references expand to at most max(64 KiB, twice the source) of URL text; past that, a reference renders as its text.

## Reading the tree

Every node is a plain `{ type, start, end, … }` object using mdast's names (`paragraph`, `listItem`, `link`, …), so a `switch` on
`node.type` narrows it. `start` and `end` are UTF-16 offsets relative to the **unit** holding the node: a unit is one top-level block, or one
item of a top-level list. `walkMarkdown` visits every node of a document in document order and hands each the unit's `base`, so
`base + node.start` is the node's offset in the source.

```ts
import { parseMarkdown, walkMarkdown } from "@y-core/forge/render/markdown";

const urls: string[] = [];
walkMarkdown(parseMarkdown(source), (node) => {
  if (node.type === "link") urls.push(node.url);
  return node.type === "inlineCode" ? false : undefined;
});
```

Return `false` from the visitor to skip a node's children. `markdownChildren` answers the children `walkMarkdown` would visit: a callout's
title before its body, and none for an image, whose description is its alt text. A leaf block keeps its source lines as `segments` rather
than a copy of the text: `codeBlockText(document.source, unit.start, node.segments)` reads a code block's content back, and
`inlinePlainText(nodes)` the text of inline nodes. `lineAtOffset(document.lineStarts, offset)` answers the 1-based line an offset is on.

GFM is always on: tables (a delimiter row may declare at most 128 columns), task list items, `~~strikethrough~~` with exactly two tildes,
literal autolinks with micromark's rules (so `ftp://` is not linked), and footnotes, which render after the document as a
`<section data-footnotes>` list.

## Composing a dialect

`defineMarkdownSyntax` validates the constructs a dialect adds, and `parseMarkdown(source, syntax)` runs them. Forge ships the constructs
below; take the ones your app needs.

```ts
import {
  createCalloutTransform,
  createWikiLinkConstruct,
  defineMarkdownSyntax,
  HIGHLIGHT_DELIMITER,
  parseMarkdown,
  TAG_CONSTRUCT,
  TASK_DUE_CONSTRUCT,
} from "@y-core/forge/render/markdown";

const ATTACHMENT = /^att:(.+)$/;

export const SYNTAX = defineMarkdownSyntax({
  inline: [createWikiLinkConstruct({ embedId: (target) => ATTACHMENT.exec(target)?.[1] ?? null }), TAG_CONSTRUCT, TASK_DUE_CONSTRUCT],
  delimiters: [HIGHLIGHT_DELIMITER],
  blocks: [createCalloutTransform(["note", "tip", "warning"])],
});

const document = parseMarkdown(source, SYNTAX);
```

| Construct | Source | Node |
| --- | --- | --- |
| `createWikiLinkConstruct({ embedId })` | `[[target]]`, `[[target\|label]]`, `![[target\|alt]]` | `wikiLink`, `embed` |
| `TAG_CONSTRUCT` | `#tag`, `#area/sub` | `tag` |
| `TASK_DUE_CONSTRUCT` | `due:YYYY-MM-DD` or `📅 YYYY-MM-DD` in a task item's first paragraph | `taskDue` |
| `HIGHLIGHT_DELIMITER` | `==text==` | `highlight` |
| `createCalloutTransform(kinds)` | `> [!kind] Title` opening a blockquote | `callout` |

- **A wiki link's `target` is the raw text between the brackets**, untrimmed and in its written case. What it points at — a page id, a title —
  is your app's to decide, so resolve it when you render or index.
- **An embed exists only where `embedId` says so.** `embedId` answers the id a `![[target]]` names, or `null`, and the whole `![[…]]` then
  stays text.
- **A callout's `kind` is lowercased** and matched against `kinds` in any case; a blockquote naming any other kind stays a blockquote. Its
  title is not among its `children`.
- **A due date is kept only when the date exists**, so a thirtieth of February stays text.
- **A tag or wiki link inside a markdown link's text, or anywhere in an image description, stays text.**
- **A labelled wiki link inside a table cell needs its pipe escaped** — `| [[target\|label]] |` — because GFM splits the row first.

A dialect's nodes need a handler to render: `renderMarkdownHtml` throws on a node with none, rather than writing nothing silently.

### Writing a construct of your own

Each kind of construct sees only a bounded span, so no construct's scan can make parsing non-linear:

- an `InlineConstruct` runs at any of its `triggers` and returns the node it read and where it ends. Its scan is handed a window: two code
  units before the trigger and `maxLength` from it, which `defineMarkdownSyntax` holds to at most 1024. Its optional `accept` runs once the
  leaf is parsed, seeing whether the node sits in a link or an image, its leaf and the leaf's container; refusing turns the node back into its
  source text.
- a `DelimiterConstruct` makes an exact run of two `char`s open and close a node on the same stack as `*`, `_` and `~~`, so crossing runs
  resolve the way emphasis does. `*`, `_` and `~` are taken.
- a `BlockTransform` replaces a finished block of one `type` after its unit's inline phase, seeing its unit's text and nothing beyond.

## Rendering an SVG fence

`sanitizeSvg` reads the source of an ` ```svg ` fence strictly and answers the drawing cut down to `SVG_TAGS` and `SVG_ATTRIBUTES`, or
`null` when the markup is not well formed or holds anything but one `<svg>`. `writeSvg` writes it through a writer, so a code handler can
render the drawing inline and fall back to a code block on `null`.

```ts
import { codeBlockText, sanitizeSvg, writeSvg } from "@y-core/forge/render/markdown";
import type { MarkdownNodeHandler } from "@y-core/forge/render/markdown";

const svgCode = (fallback: MarkdownNodeHandler): MarkdownNodeHandler => ({
  enter: (node, context) => {
    const svg = node.type === "code" && node.lang === "svg" ? sanitizeSvg(codeBlockText(context.document.source, context.unit.start, node.segments)) : null;
    if (svg === null) fallback.enter(node, context);
    else writeSvg(svg, context.writer);
  },
});
```

Scripts, `foreignObject`, `style`, event handlers and links that fail `isSafeUrl` are stripped. Every `id` is prefixed with `gv-`, and a
reference to one inside the same drawing is rewritten to match. Your schema decides what survives the write: give it a rule for each tag in
`SVG_TAGS` allowing `id` and that tag's `SVG_ATTRIBUTES`, with the drawing's links under the rule name `svgA` written as tag `a`.

## Re-parsing as a document is edited

Pass the same cache to every `parseMarkdown` of a document, and a unit whose text has not changed reuses its earlier parse instead of
running its inline phase again. A cache serves one syntax, so keep it beside the document it was filled from.

```ts
import { createUnitCache, parseMarkdown } from "@y-core/forge/render/markdown";

const cache = createUnitCache(512);
const document = parseMarkdown(draft, SYNTAX, cache);
```

An entry is reused only while every link and footnote label its unit looked up still resolves the same way. A hit hands back the cached node
itself, so per-unit data can be kept in a `WeakMap` keyed by node.

## Splitting a document into blocks

`scanBlocks` runs the block phase alone, with every paragraph's inline children still empty. Reach for it when only the block structure
matters: the units' offsets cut the source into pieces that join back to it.

```ts
import { scanBlocks } from "@y-core/forge/render/markdown";

const pieces = scanBlocks(source).units.map((unit) => source.slice(unit.start, unit.end));
```

Each item of a top-level list is a unit of its own, and every item of that list shares one `list` record.

[editor]: ./editor/client/README.md
