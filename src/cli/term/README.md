# `@y-core/forge/cli/term`

Everything forge needs to know about the terminal it is writing to: how wide a
string is, how wide the window is, how to lay text out in columns, and how much
colour the stream can carry.

```ts
import { renderGrid, definitionList, stringWidth, createColorize, resolveColorLevel } from "@y-core/forge/cli/term";
```

An application's own `config/commands.ts` renders with the same primitives forge
does, which is why this is a published subpath rather than an internal directory.

## A sink

`cli/term` imports `node:process` and nothing else in this repository — not
`cli/core`, not `result`. Consumption runs `cli/{core,pkg,sync} → cli/term` and
never the reverse.

It returns plain strings and throws nothing. If `term` ever wants a `CliError`,
that is the signal it has taken on a concern belonging to `core`, not a reason to
add the import.

Internal order: `ansi → width → {wrap, grid}`, `capability → codes → color`,
`border → grid`.

## Measurement

`stringWidth` is one linear scan that skips ANSI escapes, counts East-Asian wide
characters as two columns, combining marks and zero-width characters as none, a
tab as eight, and an emoji sequence — ZWJ joins and all — as one cell of two.
Box-drawing characters and the horizontal ellipsis stay at one column, which is
what lets a grid draw its own borders and measure them correctly.

`truncate` returns the width alongside the text, so a caller laying out a column
never measures the same string twice and the two can never disagree.

## The one column engine

`renderGrid` is behind every aligned block forge prints: the `forge sync` tables,
the `--help` command and flag lists, and the release summary. Each of those was
its own padding expression before.

Borders are flat slot records, and **a zero-width slot is skipped rather than
drawn**. That is the whole mechanism by which one engine serves both `sync`'s
boxed grid and `help`'s borderless columns: `BORDERS.none` is fifteen zero-width
slots, not a set of spaces that would have to be trimmed back off.

Presets: `none`, `ascii`, `single`, `markdown`. `definitionList` is a
borderless two-column grid over `renderGrid` — the shape `--help` needs twice and
the release summary once.

When a grid will not fit, width comes off the **widest** column still above its floor, repeatedly.
Spreading the loss rather than draining one column first is what keeps a narrow window readable —
taking it all from the wrapping column produces a stack of single letters. A wrapping column stops
at about a word, a truncating one at `abc…`, and when every column has reached its floor the grid
overflows, which is the honest outcome and the legible one.

`wrapLines` reopens on each line whatever was still open when the previous one ended. The breaks it
introduces were not in the input, so a style opened before one and closed after it would span the
break — and in a grid that means the border between the two lines is painted in the cell's colour.

Grids here are rectangular. There is no row or column spanning, and no junction
selection beyond the four corners, because nothing forge prints has ever needed
either.

## Colour

`resolveColorLevel` is **pure**: the caller supplies `env`, `isTTY` and `argv`, so
its precedence rules are testable with exact-match assertions rather than by
mutating `process.env`.

`createColorize(level)` is a chainable styler — 16, 256 and 24-bit, `hex` and
`rgb`, degrading on the level integer. Two behaviours are worth knowing:
nesting restores the _outer_ style rather than resetting, so `red(green(x) + "y")`
comes back red; and a style is closed at every newline and reopened after it, so a
background colour cannot bleed to the right edge and a multi-line cell cannot
break the grid drawn around it.

**Threaded, never ambient.** There is no detected module-level singleton —
`CODE_RULES.md` §1 bans the global that would hold it, and one level could not
express what forge needs anyway: `forge verify > log.txt` must still colour
progress on the attached stderr while the redirected stdout stays clean, so
`execute()` resolves two. Renderers take a `Colorize` defaulting to `PLAIN`, the
frozen level-0 styler that returns its input.

## Attribution

Vendored and adapted logic, all MIT unless noted, all reproduced under the licence
text below.

| What                                                                                                       | Upstream                                                                                                                                             | Source                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ANSI pattern, East-Asian and combining range tables, the OSC 8 measuring rule, the sticky-regex discipline | [`@visulima/string`](https://github.com/visulima/visulima)                                                                                           | `packages/data-manipulation/string/src/{constants,get-string-truncated-width}.ts` |
| Border slot record and the zero-width-means-skip convention; `padAlign`                                    | [`@visulima/tabular`](https://github.com/visulima/visulima)                                                                                          | `packages/terminal/tabular/src/style.ts`, `src/utils/pad-and-align-content.ts`    |
| Colour-support precedence order                                                                            | [`@visulima/is-ansi-color-supported`](https://github.com/visulima/visulima), after [`chalk/supports-color`](https://github.com/chalk/supports-color) | `packages/terminal/is-ansi-color-supported/src/is-color-supported.server.ts`      |
| SGR code table, level degradation, the chainable engine's nesting and multi-line rewrites                  | [`@visulima/colorize`](https://github.com/visulima/visulima), after [`ansis`](https://github.com/webdiscus/ansis) (ISC, © 2023 webdiscus)            | `packages/terminal/colorize/src/{ansi-codes,colorize.server}.ts`                  |
| RGB → 256 → 16 conversions                                                                                 | [`color-convert`](https://github.com/Qix-/color-convert) (© 2011–2016 Heather Arthur, 2016–2021 Josh Junon)                                          | `conversions.js`                                                                  |

Written fresh, with only the structure adopted: the width scanner, the capability
resolver, the code factory.

```
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
