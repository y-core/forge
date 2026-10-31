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

The CodeMirror viewport for the same markdown is a separate, browser-only subpath: [`editor/client/README.md`][editor]. Its `html` rendering
shows what your own `renderMarkdownHtml` call writes, through a Trusted Types policy named `MARKDOWN_TRUSTED_TYPES_POLICY`. That name is
exported here, so your Worker can list it in the CSP without importing the editor. A plain `<textarea>` gets the same editing keys, with no
CodeMirror, from [`editor/textarea/client/README.md`][textarea].

---

## Rendering a document

Your schema decides what may reach the page and which URLs are safe. A schema names every element the writer may emit and the policy every URL
attribute passes through.

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

Text is escaped with hexadecimal references — `&#x26;` and `&#x3C;`, plus `&#x22;`, `&#x27;`, `&#x60;`, `&#x3c;` and `&#x3e;` in attributes — and
URLs are percent-encoded before the policy sees them. `isSafeUrl` is a ready policy: relative URLs, `https`, and `mailto` on a link, never a
protocol-relative URL or a scheme hidden behind control characters; [Allowing other URL schemes](#allowing-other-url-schemes) builds another.

To render a node type differently, pass `handlers`: each `MarkdownNodeHandler` writes on `enter` and `leave`, `children` chooses what is
rendered inside it, and `layout` says whether those children are laid out inline or as blocks. `lineAnchors: true` adds `data-line` — the
1-based source line — to each top-level element, for a schema that allows it. `classNames` renames or drops the classes the engine writes,
and `footnotes` renames the footnote ids.

To nest a document under the page's own headings, pass `headingOffset`: every heading moves down that many levels, from 0 to 5, and one pushed past
`h6` renders as `h6`, so at 2 a `#` heading is an `h3` and `####` onward are all `h6`. Any other value throws. To keep the line breaks an author
typed, pass `breaks: true`: a line ending inside a paragraph, list item, blockquote or heading is then written as `<br>`, exactly as a hard break
is. Allow `br` and the shifted heading tags in your schema, or the writer drops them.

A handler can fall back to the frozen `DEFAULT_MARKDOWN_HANDLERS`. It has no `table`, `linkReference`, `imageReference` or
`footnoteReference` handler, because those keep state across one render; leave such a type out of `handlers` to keep its default.

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

### Allowing other URL schemes

`createUrlPolicy` builds a policy of the same shape as `isSafeUrl` for the schemes your pages accept: `linkProtocols` applies to `href` and
`xlink:href`, `srcProtocols` to `src`, and any other URL attribute keeps relative URLs only. Relative URLs — `/x`, `x`, `#x`, `?q` — are always
kept, and whatever the lists say, a protocol-relative or backslash path (`//host`, `\\host`, `/\host`) and a scheme hidden behind control characters
are refused.

```ts
import { createUrlPolicy } from "@y-core/forge/render/markdown";

const allowsUrl = createUrlPolicy({ linkProtocols: ["http", "https"], srcProtocols: [] });

const schema: HtmlSchema = {
  elements: { p: {}, a: { attributes: ["href", "rel"], urls: ["href"], requires: ["href"] } },
  url: (candidate) => (allowsUrl(candidate) ? candidate.value : null),
};
```

Write each protocol lowercase and without its colon; `createUrlPolicy` throws on any other spelling. A URL whose scheme is written in uppercase is
refused.

GFM links a bare `www.example.com` as `http://www.example.com`, so under `isSafeUrl`, or any policy without `http`, it renders as plain text. Write
the `https://` yourself, or add `http` to `linkProtocols`.

### Setting `rel` on links

```ts
const html = renderMarkdownHtml(document, { schema, links: { rel: "nofollow noopener" } });
```

`links.rel` is written on every link the source wrote — inline, reference and autolinks, `#section` links included — and not on footnote calls or
back-references, which never leave the page. Your schema's `a` rule must list `rel`, or the writer drops it. A `handlers.link` of your own replaces
the default link rendering and writes its own attributes.

### Allowing everything forge writes

`MARKDOWN_ELEMENTS` allows every element and attribute the default handlers write — tables with their alignment, footnotes, `language-*`
classes, `data-line`, task boxes with their labels, and `rel` on links — and never `style`. Spread it into your schema beside your own `url`
policy: it sends `href` and `src` through that policy, and a link whose `href` is refused renders as its text.

```ts
import { isSafeUrl, MARKDOWN_ELEMENTS } from "@y-core/forge/render/markdown";
import type { HtmlSchema } from "@y-core/forge/render/markdown";

const schema: HtmlSchema = {
  elements: {
    ...MARKDOWN_ELEMENTS,
    code: { ...MARKDOWN_ELEMENTS.code, patterns: { class: /^language-[\w-]+$/ } },
    aside: { attributes: ["class"], patterns: { class: /^callout callout-(note|tip)$/ } },
  },
  url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
};
```

A key you write replaces the preset's rule whole, so spread the preset's rule into yours, as `code` does above, to add `patterns` without losing
its attributes. The preset carries no `patterns` of its own, so a class `classNames` renames still survives it. Elements only your handlers
write, such as a callout's `aside` or the rules `writeSvg` needs, are yours to add. To style that output, import forge's
[`markdown.css`][markdown-css].

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

## Reading and ticking tasks

`listTasks(document)` answers every GFM task box in source order: the 1-based `line` it sits on, the `offset` of its `[` in the source,
and whether it is `checked`. A box on an ordered item, in a blockquote or in a footnote is a task; one in a code block, or on an item with
nothing after it, is not.

```ts
import { listTasks, parseMarkdown, setTasks } from "@y-core/forge/render/markdown";

const document = parseMarkdown(source);
const done = listTasks(document).filter((task) => task.checked).length;

const ticked = new Set(form.getAll("task").map(Number));
const next = setTasks(source, document, ticked);
if (!next.ok) return new Response(`Lines ${next.error.join(", ")} no longer hold a task.`, { status: 409 });
```

`setTasks` takes the whole ticked set: a box on a line in the set is ticked and every other box is unticked. Only the character between a
box's brackets is rewritten, so line endings, indentation and an `X` that stays ticked survive. A line in the set that holds no box refuses
the whole call, and `error` lists those lines; pass the same `source` the document was parsed from, or it throws. `MarkdownListItem.box`
is the offset `listTasks` reads, relative to the unit like every other position.

### Ticking tasks from a form

Pass `tasks: { name }` and every task box renders as a form field, wrapped with its text in a `<label>`, whose value is the line `listTasks`
reports for it:

```ts
const html = renderMarkdownHtml(document, { schema, tasks: { name: "task" } });
// <li class="task-list-item"><label><input type="checkbox" name="task" value="3" checked> Ship it</label></li>
const page = `<form method="post">${html}<button>Save</button></form>`;
```

A browser posts only the ticked boxes, so `new Set(form.getAll("task").map(Number))` in the handler above is exactly the set `setTasks` takes. In
a loose item the label sits inside the `<p>`, and a nested list stays outside it. `disabled: true` writes `disabled` on every box. Your schema
must allow `label`, and `name` and `value` on `input` — `MARKDOWN_ELEMENTS` does — or the writer drops them and the boxes post nothing. Without
`tasks`, boxes render as they always have: no label, and `disabled`.

`setTasks` matches boxes by line number only, so a box posted from a page rendered before an edit moved the lines lands on whatever box is on
that line now.

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

`sanitizeSvg` reads the source of an ` ```svg ` fence strictly and answers a `Result` holding the drawing cut down to `SVG_TAGS` and
`SVG_ATTRIBUTES`. Its `error` is `"unparseable"` when the markup is not well formed or holds anything but one `<svg>`.
`writeSvg` writes the drawing through a writer, so a code handler can render it inline and fall back to `DEFAULT_MARKDOWN_HANDLERS.code` on an
error.

```ts
import { codeBlockText, DEFAULT_MARKDOWN_HANDLERS, sanitizeSvg, writeSvg } from "@y-core/forge/render/markdown";
import type { MarkdownNodeHandler } from "@y-core/forge/render/markdown";

const svgCode: MarkdownNodeHandler = {
  enter: (node, context) => {
    const svg = node.type === "code" && node.lang === "svg" ? sanitizeSvg(codeBlockText(context.document.source, context.unit.start, node.segments)) : null;
    if (svg?.ok) writeSvg(svg.data, context.writer);
    else DEFAULT_MARKDOWN_HANDLERS.code?.enter(node, context);
  },
};
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

### Re-splitting after an edit

When an edit replaced `[changedStart, changedEnd)` of the previous source, `rescanUnitBounds` returns the bounds `scanBlocks` would give the new
source, scanning only from the last unit before the edit that opens with no block left open to the first unit after it where both scans agree.
Keep each unit's `start`, `end` and `neutral` from the earlier scan or rescan; nothing else is needed.

```ts
import { rescanUnitBounds, scanBlocks } from "@y-core/forge/render/markdown";

const before = scanBlocks(draft).units;
const next = draft.slice(0, changedStart) + inserted + draft.slice(changedEnd);
const bounds = rescanUnitBounds(next, before, changedStart, changedEnd);
```

It returns bounds alone, without nodes, definitions or line index; parse the source when you need those. A range that does not fit the previous
bounds makes it scan the whole source.

## Editing markdown as it is typed

`continueList`, `wrapSelection` and `toggleTask` are the commands behind an editor's Enter key, its Mod-B, Mod-I, Mod-E and Mod-K shortcuts, and
its task boxes. Each answers one `MarkdownEdit` — replace `[from, to)` with `insert`, then set `selection` — or `null` when the key should do what
it does anyway. They touch no DOM, so the same edit drives a CodeMirror transaction or a textarea.

To give a `<textarea>` these keys, mount [`mountMarkdownTextarea`][textarea]. To bind these keys yourself, `MARKDOWN_WRAP_KEYS` maps the
letters `b`, `i`, `e` and `k` to the wrap each shortcut writes.

```ts
import { continueList, createMarkdownDraft, MARKDOWN_WRAP_KEYS, reviseMarkdownDraft, wrapSelection } from "@y-core/forge/render/markdown";

let draft = createMarkdownDraft(textarea.value);

textarea.addEventListener("keydown", (event) => {
  draft = reviseMarkdownDraft(draft, textarea.value);
  const selection = { from: textarea.selectionStart, to: textarea.selectionEnd };
  const wrap = event.ctrlKey || event.metaKey ? MARKDOWN_WRAP_KEYS[event.key.toLowerCase()] : undefined;
  const edit = event.key === "Enter" ? continueList(draft, selection) : wrap ? wrapSelection(draft.text, selection, wrap) : null;
  if (edit === null) return;
  event.preventDefault();
  textarea.setRangeText(edit.insert, edit.from, edit.to, "end");
  if (edit.selection !== null) textarea.setSelectionRange(edit.selection.from, edit.selection.to);
});
```

A draft is the text with its block units. `reviseMarkdownDraft` rescans only around what changed, and a command parses only the unit holding the
selection, so no keystroke re-parses the document. Call `createMarkdownDraft` when the text is loaded or replaced wholesale.

Enter continues a list only when the caret is at the end of an item, trailing spaces allowed; the edit drops them. The new item keeps the bullet or
the `.` or `)`, numbers one past the item, starts with `[ ]` after a task, and repeats the `>` and indentation before it. Enter on an item holding
only its marker, or only a box, removes the marker and ends the list. Items are found by the parser the renderer uses, so `- x` inside a code
fence, a `* * *` rule and `2. b` straight after a paragraph line are not items, and a `+` bullet or a box on an ordered item is.

`wrapSelection` takes `"strong"`, `"emphasis"`, `"inlineCode"` or `"link"` and writes `**`, `*`, a backtick, or link brackets closed by `(url)`
around the selection, keeping the wrapped text selected; a link selects `url`, ready to type over. With nothing selected it inserts the pair and
puts the caret between. Pressed again over text those markers already surround, it removes them.

`toggleTask(draft, offset)` flips the box whose `[` sits at `offset`, the offset `listTasks` reports, rewriting only the character between the
brackets as `setTasks` does. It answers `null` wherever `listTasks` sees no box. Its edit's `selection` is `null`: leave the selection where it is.

[editor]: ./editor/client/README.md
[markdown-css]: ../../ui/README.md#style-rendered-markdown
[textarea]: ./editor/textarea/client/README.md
