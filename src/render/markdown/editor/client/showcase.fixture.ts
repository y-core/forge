const FENCE = "```";
const MISSING_ID = "00000000-0000-4000-8000-000000000001";
const NOTEBOOK_ID = "0190c7a0-0000-7000-8000-0000000000a0";
const SECTION_ID = "0190c7a0-0000-7000-8000-0000000000b0";
const PAGE_ID = "0190c7a0-0000-7000-8000-000000000001";

/** A document exercising every CommonMark, GFM and dialect construct, one heading each. */
export const SHOWCASE_MARKDOWN = `# Markdown showcase

Every construct the dialect renders, one heading each.

## Headings

### Level three
#### Level four
##### Level five
###### Level six

Setext level one
================

## Inline

Plain, *emphasis*, **strong**, ***both***, \`inline code\`, ~~strikethrough~~ and ~single tilde~.
Escapes stay literal: \\*not emphasis\\*, \\# not a tag, \\[\\[not a link\\]\\].
A hard break ends this line\\
and a trailing double space ends this one\x20\x20
before the next.

Entities decode: &copy; &#35; &amp;, and a code span holds a backtick: \`\` a \` b \`\`.

## Links and images

[An inline link](https://example.com "with a title"), a [reference link][ref], an autolink <https://example.com/auto>
and a bare autolink literal www.example.com or https://example.com/literal.
Mail links: <reader@example.com> and writer@example.com.
Unsafe links keep only their text: [a script link](javascript:void(0)) and [a plain http link](http://example.com).

[ref]: https://example.com/reference

![An image](https://example.com/image.png "Image title")

## Lists

- Bullet one
- Bullet two
  - Nested bullet
    - Deeper bullet
- Bullet three

1. First
2. Second
   1. Nested ordered
3. Third

Numbering may start elsewhere:

3. Third again
4. Fourth

A loose list:

- A loose item

- Another loose item

## Tasks

- [ ] An open task due:2030-01-15
- [x] A finished task
- [ ] A task with an impossible date due:2030-02-30
- [ ] A calendar-marked task 📅 2030-03-01

Outside a task, due:2030-01-15 stays text.

## Blockquote

> A plain quotation.
>
> > Nested inside it.

## Callouts

> [!note] Note
> A note callout.

> [!tip] Tip
> A tip callout.

> [!warning] Warning
> A warning callout.

> [!danger] Danger
> A danger callout.

> [!conflict] Conflict
> A conflict callout.

> [!TIP]
> An untitled callout, its marker in capitals.
>
> A second paragraph.

> [!note] A **bold** title and no body

## Code

${FENCE}ts
const answer: number = 42;
${FENCE}

    an indented code block

~~~py
print(42)
~~~

## Table

| Left | Centre | Right |
| :--- | :----: | ----: |
| a | b | c |
| \`code\` | **strong** | 1 |
| [[${PAGE_ID}\\|piped]] | ~~gone~~ | 2 |

## Footnote references

A claim with a footnote.[^one] The same footnote again.[^one]

[^one]: The footnote's text.

## Dollar signs

price $5 and $6

## SVG

An svg fence draws in the text colour, and keeps the blank line inside it:

${FENCE}svg
<svg viewBox="0 0 120 40" role="img" aria-label="A box, a dot and a label">
  <rect x="2" y="2" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2"/>

  <circle cx="60" cy="20" r="10" fill="currentColor"/>
  <text x="80" y="25" fill="currentColor">SVG</text>
</svg>
${FENCE}

Its script and event handler are stripped:

${FENCE}svg
<svg viewBox="0 0 10 10" onload="alert('svg-payload')"><script>alert('svg-payload')</script><rect width="10" height="10" fill="currentColor"/></svg>
${FENCE}

Ids are prefixed and the references to them rewritten:

${FENCE}svg
<svg viewBox="0 0 120 40" role="img" aria-label="A fading bar, a reused dot and a word in bold">
  <defs>
    <linearGradient id="fade"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></linearGradient>
    <circle id="dot" r="4" fill="currentColor"/>
  </defs>
  <rect width="80" height="10" fill="url(#fade)"/>
  <use href="#dot" x="100" y="5"/>
  <text x="0" y="35" fill="currentColor">a <tspan font-weight="bold">bold</tspan> word</text>
</svg>
${FENCE}

A fence that is not well formed is shown as code:

${FENCE}svg
<svg viewBox="0 0 10 10"><rect width=10 height=10/></svg>
${FENCE}

A dot fence is shown as code:

${FENCE}dot
graph pair { a -- b; }
${FENCE}

## Dialect

Resolved wiki links: [[${PAGE_ID}|this page]], [[s:${SECTION_ID}|its section]], [[nb:${NOTEBOOK_ID}|its notebook]] and [[${PAGE_ID}#headings|a heading on it]].
Unresolved: [[A page that does not exist]], [[s:${MISSING_ID}|a missing section]] and [[${MISSING_ID}]].
An attachment embed: ![[att:00000000-0000-4000-8000-000000000000|diagram.png]], one with no alt: ![[att:00000000-0000-4000-8000-000000000000]], and a non-attachment: ![[not an attachment]].
Tags: #showcase and #nested/tag. A ==highlighted== phrase, and one ==with **strong** inside==.

## Edge cases

<b>Raw HTML is shown as text</b>

A tag in brackets: [#bracketed]. A highlight with spaces: x ==a == b== y.
A link's text stays text: [#not-a-tag and [[not a link]]](https://example.com/text).

---

The end.
`;
