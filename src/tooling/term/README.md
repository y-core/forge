---
title: Terminal Measurement and Output
description: "How wide a string is, how wide the window is, how to lay text out in columns, and how much colour the stream can carry."
audience: internal
---

# `@y-core/forge/tooling/term`

Printing a table to a terminal is measurement, not string concatenation: a CJK character is two columns wide, an ANSI escape is zero, and an emoji
built from four code points is one cell. This namespace holds the measuring and the laying out, so nothing else in forge has to own a padding
expression.

Reach for it when output has to line up, fit a window, or carry colour. An application's own `config/commands.ts` renders with the same primitives
forge does, which is why this is a published subpath rather than an internal directory.

```ts
import { createColorize, definitionList, renderGrid, resolveColorLevel, stringWidth } from "@y-core/forge/tooling/term";
```

---

## Getting started

`renderGrid` takes rows as plain records and returns lines. Columns are derived from the first row's key order unless you declare them.

```ts
import { BORDERS, renderGrid, terminalWidth } from "@y-core/forge/tooling/term";

const lines = renderGrid(
  [
    { step: "typecheck", result: "pass", detail: "1.4s" },
    { step: "lint", result: "fail", detail: "3 findings in src/ui" },
  ],
  { border: BORDERS.single, maxWidth: terminalWidth(), columns: [{ key: "step" }, { key: "result" }, { key: "detail", wrap: true }] },
);

for (const line of lines) process.stderr.write(`${line}\n`);
```

Everything here returns strings. Nothing writes, and nothing throws — where the output goes is the caller's decision.

---

## Choosing how a grid behaves under pressure

The options that matter are the ones that decide what happens when the content is wider than the window, in the order they bite:

- **`maxWidth`** — omit it and the grid is as wide as its content, which is right for a file and wrong for a terminal. Pass `terminalWidth()` for a
  grid a person will read.
- **`wrap` on a column** — marks the column that gives up width first and wraps rather than truncating. Usually the one free-text column; without
  one, every column truncates.
- **`border`** — `none`, `ascii`, `single` or `markdown`. `none` is not "spaces instead of lines": it is a border whose every slot is zero width,
  and a zero-width slot is skipped rather than drawn.

When the grid still will not fit, width comes off the **widest** column still above its floor, repeatedly. Spreading the loss is what keeps a narrow
window readable — draining one column first produces a stack of single letters. A wrapping column stops at about a word, a truncating one at `abc…`,
and when every column has hit its floor the grid overflows, which is the honest outcome.

---

## Laying out a two-column list

`definitionList` is the borderless shape `--help` needs — terms on the left, wrapping descriptions on the right.

```ts
const lines = definitionList(
  [
    { term: "--only <step>", description: "Run one step. Any step label works." },
    { term: "--list", description: "Print the steps of the selected mode and run none." },
  ],
  { width: terminalWidth(), indent: 2 },
);
```

---

## Measuring a string yourself

`stringWidth` is one linear scan: ANSI escapes skipped, East-Asian wide characters two columns, combining and zero-width marks none, a tab eight, an
emoji sequence one cell of two. Box-drawing characters and the horizontal ellipsis stay at one, which is what lets a grid measure its own borders.

```ts
stringWidth("日本語"); // 6
stringWidth("[31mred[39m"); // 3
```

`truncate` returns the width alongside the text, so a caller laying out a column never measures the same string twice and the two can never
disagree.

---

## Adding colour

Resolve what the stream can carry, then build a styler for that level.

```ts
const level = resolveColorLevel({ env: process.env, isTTY: process.stderr.isTTY, argv: process.argv });
const c = createColorize(level);

process.stderr.write(c.red.bold("failed") + c.dim(` (${count} findings)`) + "\n");
```

`createColorize` is chainable across 16, 256 and 24-bit colour, with `hex` and `rgb`, degrading on the level integer. `PLAIN` is the frozen level-0
styler that returns its input — the right default for a renderer whose caller has not resolved a level.

---

## Gotchas

**`RE_ANSI` is for replacement only — never scan with it.** It carries `g`, and a `g`-flagged `.test()` with a manually assigned `lastIndex`
searches _from_ that offset rather than anchoring _at_ it, so a later match is consumed together with every visible character in between. That is a
documented bug in the reference this was taken from; `width.ts` compiles its own `"y"`-flagged clone for exactly that reason.

**Colour is threaded, never ambient.** There is no detected module-level singleton — `CODE_RULES.md` §1 bans the global that would hold it, and one
level could not express what forge needs anyway: `forge verify > log.txt` must still colour progress on the attached stderr while the redirected
stdout stays clean, so `execute()` resolves two. Renderers take a `Colorize` defaulting to `PLAIN`.

**Nesting restores the outer style rather than resetting**, so `red(green(x) + "y")` comes back red. A style is also closed at every newline and
reopened after it, so a background colour cannot bleed to the right edge and a multi-line cell cannot break the grid drawn around it. `wrapLines`
reopens on each line whatever was still open when the previous one ended, for the same reason.

**Grids are rectangular.** No row or column spanning, and no junction selection beyond the corners, because nothing forge prints has needed
either.

**This namespace is a sink.** It imports `node:process` and nothing else in this repository — not `tooling/cli`, not `result`. Consumption runs
`tooling/{cli,gate,release,cf} → tooling/term` and never the reverse, and if `term` ever wants a `CliError` that is the signal it has taken on a
concern belonging elsewhere, not a reason to add the import.

---

## Attribution

Vendored and adapted logic, all MIT unless noted, all reproduced under the licence text below.

| What | Upstream | Source |
| --- | --- | --- |
| ANSI pattern, East-Asian and combining range tables, the OSC 8 measuring rule, the sticky-regex discipline | [`@visulima/string`](https://github.com/visulima/visulima) | `packages/data-manipulation/string/src/{constants,get-string-truncated-width}.ts` |
| Border slot record and the zero-width-means-skip convention; `padAlign` | [`@visulima/tabular`](https://github.com/visulima/visulima) | `packages/terminal/tabular/src/style.ts`, `src/utils/pad-and-align-content.ts` |
| Colour-support precedence order | [`@visulima/is-ansi-color-supported`](https://github.com/visulima/visulima), after [`chalk/supports-color`](https://github.com/chalk/supports-color) | `packages/terminal/is-ansi-color-supported/src/is-color-supported.server.ts` |
| SGR code table, level degradation, the chainable engine's nesting and multi-line rewrites | [`@visulima/colorize`](https://github.com/visulima/visulima), after [`ansis`](https://github.com/webdiscus/ansis) (ISC, © 2023 webdiscus) | `packages/terminal/colorize/src/{ansi-codes,colorize.server}.ts` |
| RGB → 256 → 16 conversions | [`color-convert`](https://github.com/Qix-/color-convert) (© 2011–2016 Heather Arthur, 2016–2021 Josh Junon) | `conversions.js` |

Written fresh, with only the structure adopted: the width scanner, the capability resolver, the code factory.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## See also

- [`docs/SOURCE_OF_TRUTH.md`][sot-2f] §2f — why this README, and not a `docs/` document, owns the rulings above
- [`src/tooling/cli/README.md`][cli-readme] — the command layer that renders with these primitives

[cli-readme]: ../cli/README.md
[sot-2f]: ../../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows
