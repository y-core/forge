---
title: PDF Output
description: "The server-rendered PDF engine: a renderer that answers a Result, a palette that accepts hex and nothing else, and a page ceiling."
audience: consumer
---

# `@y-core/forge/render/pdf`

A Worker that can render a page can render a printable copy of it. This namespace is the engine that does it — no browser, no headless Chromium and
no runtime dependency.

```ts
import { createPdfRenderer } from "@y-core/forge/render/pdf";
```

It is a child of the `render/` container, which holds one namespace per renderer ([`NAMESPACES.md`][ns-5j] §5j).

---

## Rendering a document

`createPdfRenderer` takes the decisions that hold for every document — the page ceiling, the colour scheme — and returns a renderer you keep.
`render` is **async and answers a `Result`**: a document that cannot be rendered comes back as a named error to handle, never an exception to catch.

```ts
import { createPdfRenderer } from "@y-core/forge/render/pdf";
import { ContentDisposition, pdfResponse } from "@y-core/forge/http";

const renderer = createPdfRenderer({ maxPages: 8 });

const rendered = await renderer.render(doc);
if (!rendered.ok) return renderError(rendered.error.message);

return pdfResponse(rendered.data, 200, {
  "content-disposition": new ContentDisposition({ type: "attachment", filename: "declaration.pdf" }).toString(),
});
```

`http` owns the response, and it takes bytes without knowing what made them — so this namespace never reaches into the response path, and `http`
never depends on this one.

---

## Composing a document

A document is a list of elements: form-vocabulary components such as `Heading` and `Field`, built out of layout primitives such as `Stack`, `Row`
and `Text`. `Stack` puts its children one under the next and is transparent to a page break; `KeepTogether` is the one that is not.

```ts
import { Field, Heading, Note, Row, Stack, Text } from "@y-core/forge/render/pdf";

const doc = {
  title: "Declaration of interest",
  letterhead: { name: "Meridian Attorneys", tagline: "Commercial practice", email: "records@meridian.example", phone: "+27 21 555 0143" },
  content: [
    Heading({ children: "Part A - the declarant" }),
    Field({ fields: [{ label: "Surname", value: "Du Toit" }] }),
    Field({ fields: [{ label: "Identity number" }] }), // no value: ruled for the reader to write on
    Note({ children: "Complete every section in black ink." }),
  ],
};
```

**A heading keeps its section with it.** Everything after a `Heading` travels with it to the next page rather than leaving the head stranded at the
foot of one — unless the section is taller than a page, in which case it has to break somewhere and does.

### Width is tracks, and only tracks

A `Row` divides its width into **tracks**: a number is a share of what is left, `{ points }` is a fixed width, and `gap` is the only spacing. There
is no `grow`, `shrink`, `basis` or `justify` — one model, so a document is never laid out half in each.

```ts
Row({ tracks: [{ points: 120 }, 1, 1], gap: 12, children: [label, first, second] });
```

### The same components, written as JSX

Every component takes **one props object with `children` inside it** — a `Table` takes its cells in `header` and `rows` instead, each cell any
content `children` would take — which is exactly what forge's JSX runtime calls. So the tree above can be written as markup instead — in a file
that names this namespace's runtime as its JSX source:

```tsx
/** @jsxImportSource @y-core/forge/render/pdf */
const doc = {
  title: "Declaration of interest",
  content: (
    <>
      <Heading>Part A - the declarant</Heading>
      <Field fields={[{ label: "Surname", value: "Du Toit" }]} />
    </>
  ),
};
```

**The pragma is not optional, and `@y-core/forge/render/jsx` will not do.** TypeScript resolves the `JSX` namespace through `jsxImportSource`, and
the HTML runtime's requires a component to answer with a `JSXElement`; a PDF component answers with a `PdfElement`.
`@y-core/forge/render/pdf/jsx-runtime` declares the namespace that admits one — and declares no intrinsic elements at all, so `<div>` in a document
is a compile error rather than something that silently renders nothing.

`content` takes either spelling, and the two produce the same display list. `render` lowers a JSX tree for you; call `toPdfElements` yourself only
when you need the elements before then.

---

## The page

Paper is data. `resolvePdfPage` settles a named size, an explicit point size, an orientation and per-side margins into points, and everything
downstream — measurement, pagination, `/MediaBox` — sees points only.

```ts
createPdfRenderer({ page: { size: "letter", orientation: "landscape", margin: { all: 40, left: 72 } } });
```

`PDF_PAGE_SIZES` is every size the engine names. An unlisted one is `points: [width, height]` in portrait, which orientation then swaps.

---

## The page ceiling

`maxPages` is a runaway guard rather than a formatting choice. It **bounds pagination itself** instead of being compared to its result: the page
that would cross the ceiling is never built, and a document that overruns produces no bytes at all rather than a truncated file:

```ts
const rendered = await createPdfRenderer({ maxPages: 2 }).render(longDocument);
rendered.ok; // false
rendered.error.kind; // "max-pages"
```

`DEFAULT_PDF_MAX_PAGES` is what a renderer takes when the caller names none. Raise it explicitly for a genuinely long document — the ceiling is
then visible in the call rather than discovered in production.

---

## Running headers and footers

A `header` or `footer` is laid out **once** and repeated on every page, outside the flowing content — so the content box gives up exactly the room
the band takes, and a document with a footer simply breaks sooner.

`PageNumber` is the one thing the writer knows that layout did not. A band cannot know which page it will land on, so the component reserves the
room and the writer substitutes the number as it emits:

```ts
const renderer = createPdfRenderer({ page: { size: "a4" } });
const doc = { title: "Declaration", footer: Row({ children: [PageNumber(), Text({ children: " of " }), PageNumber({ total: true })] }), content };
```

The room is reserved against the digits of `DEFAULT_PDF_MAX_PAGES`, so a band's layout does not shift between page 9 and page 10. A renderer with a
larger `maxPages` raises it to match: `PageNumber({ digits: 4 })`.

---

## Tables

A `Table` is the one construct whose columns must agree across every row. They are resolved **once** for the whole table, a header row repeats at
the top of every page the table continues onto, and a row moves whole rather than splitting across the seam.

```ts
Table({
  tracks: [{ points: 120 }, 1, 1],
  header: [Text({ children: "Class" }), Text({ children: "Held" }), Text({ children: "Percentage" })],
  rows: holdings.map((one) => [Text({ children: one.class }), Text({ children: one.held }), Text({ children: one.percentage })]),
});
```

---

## Where a page ends

`orphans` and `widows` are applied **at the split index**, before anything is painted — a paragraph that would strand fewer than `orphans` lines at
the foot of a page moves whole, and one that would carry fewer than `widows` onto the next carries more of them. Both default to 2.

**A word wider than its column overflows** rather than being cut mid-word, because in a legal document a silently broken word reads as a different
word. `Text({ breakWord: true })` opts a run into the cut where that is the lesser evil.

---

## Compression and metadata

**Compression is on by default**, and it also settles the file's shape: the default writes a `%PDF-1.5` file with object streams behind a
cross-reference stream, which is what makes a tagged document cost roughly what an untagged one does. Pass `compress: false` for a `%PDF-1.4` file
with a classic `xref` table that you can read in a text editor — and note that a deflate stream's bytes belong to the runtime's compressor, so
assert what a stream _inflates to_ rather than the stream itself.

`metadata: "standard"` writes an `/Info` dictionary from `info` and an `/ID` beside the document's root — in the trailer under `compress: false`,
and in the cross-reference stream's own dictionary otherwise. **`/ID` is derived from the uncompressed content, never random**, so two renders of
one document are the same file, a caller can cache on content, and the identity survives a change of compressor.

```ts
createPdfRenderer({ metadata: "standard", info: { title: "Declaration of interest", author: "Meridian Attorneys" } });
```

---

## Tagging, so a screen reader can read the document

A tagged render writes a structure tree a screen reader follows, a document language, and a request that the viewer show the title rather than the
filename.

```ts
createPdfRenderer({ tagged: true, lang: "en-ZA" });
```

**`tagged` defaults to on wherever `fonts` carries a face.** A structure tree over the base-14 faces is conformant only as far as whatever face the
viewer substitutes, which is not a property of the file — so the default follows the one thing that decides whether the output can conform at all,
and a caller who embeds a face gets an accessible document without asking twice. Name `tagged` to override it in either direction.

**The tree follows the components you wrote**: a heading becomes an `H2`, a paragraph a `P`, and a rule an artifact outside the reading order.

**A drawing enters the tree only with the words a reader announces in its place.** `alt` on an image, a path or a letterhead's mark makes it a
`/Figure`; a drawing without one is an artifact rather than a figure a reader reaches and cannot describe. A tick box says its own state.

`lang` defaults to `DEFAULT_PDF_LANG`. An explicit `tagged: false` writes no structure object at all — no marked content, no `/StructTreeRoot` and
no `/StructParents` — so the file makes no accessibility claim rather than a partial one.

---

## Links

`Link` wraps whatever it is given and places an annotation over where that run actually landed — so a paragraph broken across a page is activated on
each page, at the rectangle it occupies there rather than the one it was measured in.

```tsx
<Link to={{ uri: "https://example.org/terms" }}>
  <Text>The full terms</Text>
</Link>
<Link to={{ page: 2 }}>
  <Text>See Part C</Text>
</Link>
```

A destination is an address outside the document or a page inside it. In a tagged document a link is **reachable as well as clickable**: its
structure element carries an object reference to its own annotation, which is what a screen reader follows.

---

## The XMP packet and the outline

`metadata: "standard"` also writes an XMP packet and an outline.

**The packet and `/Info` are derived from one title**, never given their own — a metadata block disagreeing with another about a document's title is
the ordinary way an otherwise correct file fails a conformance check. The packet carries `dc:title`, and `pdfuaid:part` where the document is also
tagged. It is never compressed, because a checker reads it out of the file as it stands.

**The outline is the document's own heads**, nested exactly as the structure tree's sections are: a `Heading({ level: 2 })` sits under the
`Heading` before it, and neither reads a level table of its own. Nothing else becomes a bookmark, and a head that set no words is left out rather
than listed blank.

---

## Colour

Colour enters through one object. `createPdfPalette` names the colours a document draws in, and the engine reads the names rather than carrying
values around — so a scheme is one thing to change, not a scattering of literals.

```ts
const palette = createPdfPalette({ heading: "#1f4e79", rule: "#1f4e79", letterhead: "#1f4e79" });
if (!palette.ok) throw new Error(palette.error.message);

const renderer = createPdfRenderer({ palette: palette.data });
```

**`#rrggbb` and `#rrggbbaa` are the whole accepted notation.** A named colour, `rgb()` and HSL are each refused by name. A non-opaque alpha reaches
the page as a graphics state; an opaque one carries no alpha at all, so a document of solid inks declares none.

**The names are `heading`, `rule`, `letterhead` and `intro` — `PDF_INK_NAMES`, and nothing else.** Any other name is a colour no page would ever
consult, so it is a type error, and a refusal naming the offending key for a palette arriving as JSON.

**A colour the palette never named draws no ink operator at all**, rather than falling back to black. That is what lets one document opt into a
brand colour for its headings and leave its rules in the default.

---

## Drawing

Every shape the engine draws is one path: a pen records moves, lines, curves, rectangles and a close, and the path is then filled, stroked or both.
A rule and a rounded panel are the same mechanism, which is why a per-corner radius costs nothing to reach for.

```tsx
const chevron = createPdfPen().move(0, 0).line(6, 6).line(0, 12).commands();

<Path commands={chevron} height={12} stroke="…" weight={1.5} />
<Panel radius={{ topLeft: 12, bottomRight: 4 }} padding={12} fill={[0.96, 0.96, 0.96]}>
  <Text>Declared under oath</Text>
</Panel>
```

`Panel` sizes its box to what its children measure and **keeps them whole** — a background that broke across a page would print on one page and not
the next.

**A gradient takes the place of a fill rather than joining one.** `fill` is an ink or a shading, axial between two points or radial between two
circles, and a shading needs two stops because the type says so:

```ts
<Path commands={chevron} height={12} alpha={0.4} fill={{ kind: "axial", from: [0, 0], to: [0, 12], stops: [{ at: 0, ink: [1, 1, 1] }, { at: 1, ink: [0, 0, 0] }] }} />
```

`alpha` on a path is bracketed, so a translucent shape leaves the page opaque behind it.

---

## The letterhead's mark

**Forge holds no artwork of its own.** A letterhead's mark is caller data: an SVG converted to paths at build time by
`@y-core/forge/tooling/assets`, handed to the letterhead as the artifact that step wrote.

```ts
const letterhead = {
  name: "Meridian Attorneys",
  tagline: "Commercial and estate practice",
  email: "records@meridian.example",
  phone: "+27 21 555 0143",
  mark: JSON.parse(await markJson) as PdfArtwork,
  markWidth: 250,
};
```

The wording is set beside whatever box the mark occupies, and the block is as tall as whichever of the two is taller. A letterhead with no mark sets
its wording from the left margin. **The mark keeps its own colours** — they are the mark; everything set in type takes the palette's `letterhead`
ink, and emits no ink operator at all where the palette names none.

---

## Asserting on a layout, without asserting on bytes

`describePdfLayout` answers where every drawing of a document landed, and `formatPdfLayout` writes that out as one drawing per line. A test then
diffs text a reviewer can read instead of bytes nobody can.

```ts
import { describePdfLayout, formatPdfLayout } from "@y-core/forge/render/pdf";

const described = describePdfLayout(doc, options);
if (!described.ok) throw new Error(described.error.message);
const fixture = formatPdfLayout(described.data);
```

```text
page=1 kind=text tag=title x=56.000 y=74.000 size=14.000 face=bold tracking=1.100 text="DECLARATION OF INTEREST"
page=1 kind=path tag=rule
page=1 kind=image tag=artwork x=56.000 y=109.000 width=120.000 height=36.000 alt="The Meridian mark"
page=1 kind=text tag=label x=56.000 y=158.000 size=9.000 face=bold tracking=0.000 text="Surname"
page=1 kind=text tag=value x=110.511 y=158.000 size=10.000 face=regular tracking=0.000 text="Du Toit"
page=2 kind=text tag=value x=56.000 y=786.000 size=10.000 face=regular tracking=0.000 text="2"
```

**A change of one field value is one token on one line.** Every token is `key=value` and none is positional, the words come last because they are
the only unbounded-width value, and there is no node ordinal — position in the file _is_ drawing order, so inserting a paragraph does not rewrite
every line after it. Numbers are fixed to three places, so a column never moves under a value.

**It is refused exactly where a render is**, with the same error: an unsupported option, a character the faces cannot set, a document over the page
ceiling. A description that succeeded for a document `render` refuses would let you sign off on a layout that cannot be produced.

**A page number is already resolved**, to the page it landed on — never to the run that reserved its width. Paint is not a drawing, so a palette
cannot move a line of a committed fixture, and nothing of the display list reaches you: no command list, no placeholder, no embedded face name.

`@y-core/forge/testing/snapshot` is the other half — it compares that text against a committed fixture and reports the differing lines.

---

## Auditing a render before you make it

`@y-core/forge/render/pdf/audit` reads the document and the options a render is about to be made with, and reports what stands between them and a
conformant file. It is a separate subpath because conformance checking is a choice, and `render` should not charge every document for it.

```ts
import { auditPdf } from "@y-core/forge/render/pdf/audit";

const findings = auditPdf(doc, options);
if (findings.length > 0) throw new Error(findings.map((finding) => finding.message).join("\n"));
```

**Each finding says what to do as well as what is wrong.** It reads no bytes: it answers from the document and the options, before a render is
made.

It reads `content`, and a container's children through it, so a `Table` or a drawing nested in a `Stack` is reported as a bare one is. It says
nothing about `header` or `footer`: a running band is painted as a pagination artifact, and PDF/UA-1 exempts an artifact from the structure tree
and from `alt` alike — so an `alt` added there would reach no byte of the file. **Put anything a reader must hear in `content`.**

---

## Images

`createPdfImage` takes JPEG and PNG bytes, palette and alpha PNGs included, and answers a `Result`:

```tsx
const logo = await createPdfImage(bytes);
if (!logo.ok) throw new Error(logo.error.message);

<Image image={logo.data} width={120} />;
```

`Image` fills the width of its box and scales at the image's own aspect ratio unless it is given a height.

**Some inputs are declined by name rather than handled badly:** an interlaced PNG (Adam7 means a full decode of an input a caller can re-save in a
step), a progressive JPEG, and any PNG carrying a `tRNS` chunk. That last is colour-key transparency — one grey level or one RGB triple the file
declares clear — and PDF carries transparency only as a soft mask, so re-saving it as RGBA is what embeds it.

---

## Fonts

The base-14 faces need no embedding and cover WinAnsi — Latin-1 with the usual punctuation. **A character they cannot set is refused by name**
before a byte is written, rather than printed as something else. This binds what is _set on a page_; a metadata entry is a text string rather than a
run, written as UTF-16BE the moment it leaves ASCII, so what a face can draw never bounds what a document may be called.

```ts
(await createPdfRenderer().render(docContaining("価"))).error.kind; // "encoding"
```

Beyond that set, `@y-core/forge/render/pdf/fonts` carries font packs and the face a document selects through the **CSS font-matching ladder** —
stretch, then style, then weight, in the order CSS Fonts 4 §5.2 specifies.

```ts
import { createPdfFontSet, readPdfFontPack } from "@y-core/forge/render/pdf/fonts";

const fonts = createPdfFontSet(packs.map((pack) => readPdfFontPack(pack, (path) => bytesOf(path))));
const face = fonts.match({ family: "Oswald", weight: 700, style: "italic" });
```

The packs come from the asset pipeline: a `fonts.subsets` entry names the face and **the text it must
be able to set**, and the build subsets it to exactly those glyphs and writes `fonts/packs.json`
beside the bytes. The artifact is plain JSON — that is the whole contract between the build and the
engine, so neither names the other's types and a Worker never parses a font.

```ts
// forge.assets.ts
fonts: {
  subsets: [{ family: "Oswald", from: "node_modules/…/Oswald_400Regular.ttf", to: "fonts/oswald-400.ttf", covering: CORPUS }],
}
```

**A whole pack becomes the faces a document embeds in one call.** `readPdfFontPack` feeds the matching
ladder; `readPdfEmbeddedFonts` feeds `createPdfRenderer({ fonts })` directly, naming each built face the
way the document refers to it and carrying the `postScriptName` the file's `/BaseFont` is written as.

```ts
import { readPdfEmbeddedFonts } from "@y-core/forge/render/pdf/fonts";

const fonts = readPdfEmbeddedFonts(pack, (path) => bytesOf(path), (face) => (face.weight >= 700 ? "bold" : "body"));
```

**Hand every metric over in the face's own units**, never pre-scaled to a 1000-unit em: the engine applies that scale itself, so an adapter that
scales too is invisible on a 1000-upem face and shrinks every other one to `1000/unitsPerEm` of its true size.

### Making a tagged document that passes a conformance check

A conformance checker asks the file for the glyphs it draws with. The base-14 faces are not in the file, so a tagged document set in them conforms
only as far as whatever face the viewer substitutes — which is not a property of the file, and is why **supplying `fonts` is what makes `tagged`
default to `true`**. `auditPdf` reports the tagged-on-base-14 combination, so a caller who skips this step learns it from the audit rather than from
a failed check.

**Pick a metric-compatible face, and the pagination you signed off on survives.** An embedded run is measured against the face's own advances and
its own pair table, never against the Helvetica table — so an arbitrary face renders correctly and _reflows_: lines break in different places, and
a two-page declaration can become three. A face drawn to Helvetica's metrics reflows nowhere.

| Face | Licence | Use it? |
| --- | --- | --- |
| **Arimo** | OFL 1.1 | Yes. Metric-compatible with Arial, itself drawn to Helvetica's metrics across WinAnsi. OFL, but names no Reserved Font Name, so a subset needs no rename — which matters, because subsetting is modification. |
| Liberation Sans | OFL 1.1 | Works, and is better known. Unlike Arimo's, its licence names a Reserved Font Name, and that clause binds the subset you ship, so the built face must be renamed. |
| Nimbus Sans | AFPL/GPL + font exception | No. The exception exempts the documents you produce, not the font files you redistribute — and a pack ships the file. |

Name the face and the text it must set in `forge.assets.ts`, then hand the built pack to the renderer:

```ts
// forge.assets.ts — `covering` is the corpus, and WinAnsi is the whole of what the base-14 faces set
import { WIN_ANSI_CHARACTERS } from "@y-core/forge/render/pdf";

fonts: {
  subsets: [{ family: "Arimo", from: "node_modules/…/Arimo-Regular.ttf", to: "fonts/arimo-400.ttf", covering: WIN_ANSI_CHARACTERS }],
}
```

Then match the face out of the pack and name it as the one the document embeds. `tagged` is not named anywhere: supplying `fonts` is what turns it
on.

```ts
const fonts = createPdfFontSet(packs.map((pack) => readPdfFontPack(pack, (path) => bytesOf(path))));
const matched = fonts.match({ family: "Arimo", weight: 400 });
if (!matched.ok) throw new Error(matched.error.message);

const { metrics, sfnt } = matched.data;
// A pack may ship metrics only, and a face with no bytes is the one that cannot conform — see below.
if (sfnt === undefined) throw new Error("Arimo 400 carries no sfnt: the pack ships metrics only");

const arimo: PdfEmbeddedFont = {
  name: "body",
  postScriptName: matched.data.postScriptName,
  sfnt,
  glyphs: metrics.glyphs,
  metrics,
};

const options: PdfRendererOptions = { fonts: [arimo], metadata: "standard", info: { title: doc.title } };
```

**`PdfFace.sfnt` is optional, and that guard is not ceremony.** A pack that ships metrics only measures correctly and embeds nothing — so silencing
the error with `!` produces exactly the file this section exists to prevent: `fonts` is non-empty, `tagged` therefore defaults to `true`, `auditPdf`
reports nothing, and the tagged document still carries no glyphs. Neither the engine nor the audit can see the difference, because both are reading
a face that says it has bytes. Check `sfnt` where you build the face, or pass the face to `fonts` only when it has one.

`auditPdf(doc, options)` returns `[]` when nothing stands between those options and a conformant file. Run it before the render, not after.

### Setting a run in an embedded face

`Text({ font })` takes the face itself, and `createPdfRenderer({ fonts })` is given the same faces so
the writer can embed them once and name them in every page's resources:

```ts
const renderer = createPdfRenderer({ fonts: [oswald] });
const doc = { title: "Declaration", content: [Text({ children: "Declaration of interest", font: oswald })] };
```

**The text of an embedded run stays selectable, searchable and copyable** — for a legal document that is a requirement, not a nicety. A kerned
line breaks where the face it is set in says it does, and the kern reaches the page.

**`font` takes a list, and a run falls back per code point.** The faces are tried in order and the
base-14 pair is the last resort, so one glyph missing from the first face falls back for itself
rather than dragging its neighbours with it — or failing the document:

```ts
Text({ children: "Zürich", font: [oswald, fallbackFace] });
```

**A code point no offered face and no base-14 face can set is refused by name** — there is no notdef
box and no substitution.

### Setting the whole document in an embedded face

`defaultFont` names faces from `fonts` — **one per weight, and both are required**:

```ts
const renderer = createPdfRenderer({
  fonts: [oswaldRegular, oswaldBold],
  defaultFont: { regular: "oswald", bold: "oswald-bold" },
});
```

The pair is not a convenience. A run's base face is discarded once it carries an embedded one, so a
single default face would set every heading, label and title in the regular weight without saying
so. Naming a face `fonts` does not carry is refused as `kind: "font"` before anything is drawn.

This reaches everything the document sets — the form vocabulary, the title, the intro and the
letterhead alike. A run that names its own `font` keeps it and keeps the base-14 pair as its last
resort; a run that took the default is held to the default, so an uncovered glyph is refused naming
the face rather than quietly set in Helvetica.

**The whole document reflows, and that is the point of the warning above.** Every line is now
measured against the embedded face's advances, so an arbitrary face moves every break in the
document at once — not just the runs you opted in. `LABEL_WIDTH` and the option-group widths were
tuned against Helvetica and stop meaning what they meant. Pick from the metric-compatibility table
above, or render the document before and after and read the difference by eye.

**A missing italic fails by name; it is never synthesised by shearing the roman.** An oblique stands in for an italic because it is a real face, but
a family that ships neither answers an error rather than quietly setting the roman — in a legal document a sheared roman is a different typeface,
not a near miss.

---

## Producing an archival copy

**`archival` asks for PDF/A, and a document that does not ask pays nothing for it** — no output intent, no profile bytes, no page group. Ask for a
level and the file gains an `/OutputIntents` entry with an embedded sRGB profile (ICC v2, about 3 KB), a `pdfaid` block in the XMP packet, and a
`/Group` on any page that composites. The header becomes `%PDF-1.7`.

```ts
createPdfRenderer({
  archival: "a-2b",
  metadata: "standard",
  fonts: [face],
  defaultFont: { regular: "body", bold: "body" },
  info: { title: "Declaration of interest", created: new Date("2026-09-21T09:30:00Z") },
});
```

Within a part, each level is a superset of the one before: **`b`** is visual reproducibility, **`u`** adds the Unicode mapping every embedded face
already carries, and **`a`** adds the full tagging requirement and so needs `tagged: true`. **Ask for part 3 (`a-3b`, `a-3u`, `a-3a`) when the
archive you deliver to names it.** It differs from part 2 only in permitting an embedded file, so a part 3 file with nothing attached is valid and
renders exactly as its part 2 twin does, save the part it declares.

**A-1 is not admitted.** It is a PDF 1.4 part and forbids both the cross-reference stream and the object streams that make a tagged file
affordable, so admitting it would mean keeping a second, worse writer path for an obsolete part.

**The date is yours to supply, and that is not an oversight.** `/ID` is derived from the content so two renders of one document are the same file;
a wall-clock date would destroy that. PDF/A requires a creation date, so a render asking for a level without `info.created` is **refused by name**
rather than stamped with the moment it ran.

**Every prohibition is refused before a byte is written**, on the `pdfa` error kind, with the remedy in the message: a run left in the base-14 pair,
a face supplied without `sfnt`, `metadata` that writes no packet, a missing creation date, `a-2a` or `a-3a` without tagging, a link scheme an
archive cannot follow, a CMYK image an sRGB intent cannot explain, and an attachment at a part 2 level [below](#attaching-a-file). **`auditPdf`
reports every one of them before you render**, which is what a Worker can run.

**What is held is forge's own rules, not the specifications.** Nothing checks the `pdfaid` and `pdfuaid` declarations against PDF/A and PDF/UA
themselves. Run an external checker before you rely on a file being conformant.

---

## Attaching a file

**`attachments` embeds files in the document**, each associated with the document as a whole — the XML an invoice was rendered from, say, or the
spreadsheet behind a table. A reader lists them in its attachments pane and saves each under its `name`.

```ts
createPdfRenderer({
  archival: "a-3b",
  metadata: "standard",
  fonts: [face],
  defaultFont: { regular: "body", bold: "body" },
  info: { title: "Invoice 2026-0412", created: new Date("2026-10-14T09:00:00Z") },
  attachments: [
    {
      name: "invoice.xml",
      mime: "application/xml",
      bytes: xml,
      relationship: "Source",
      description: "The invoice as structured data",
      modified: new Date("2026-10-14T08:55:00Z"),
    },
  ],
});
```

**`relationship` says how the file stands to the document**: `Source` is what the document was made from, `Data` is what a table or chart in it
draws, `Alternative` is the same content in another form, `Supplement` adds to it, and `Unspecified` is for none of these.

**An archival render takes attachments only at a part 3 level.** PDF/A-2 forbids an embedded file, so `a-2b`, `a-2u` and `a-2a` refuse any
attachment and name the part 3 level to ask for instead. A document asking for no level may attach files freely.

**Every attachment needs a `name` no other attachment uses, a `mime` type and a valid `modified` date, at any level or none.** A render missing
any of them is refused on the `attachment` error kind before a byte is written, and `auditPdf` reports every one of them under the `attachment`
rule.

**The `/ID` covers the attachments.** Renders of one document that differ only in an attached file's bytes, name or MIME type carry different
identifiers.

---

## Reading a PDF's attachments

`@y-core/forge/render/pdf/attachments` reads back the files a PDF embeds — the XML an invoice arrived with, say — from a file you did not
necessarily write. It uses only Web APIs, so it runs in a Worker and in a browser alike.

```ts
import { readPdfAttachments } from "@y-core/forge/render/pdf/attachments";

const read = await readPdfAttachments(bytes);
if (!read.ok) return new Response(read.error.message, { status: 422 });
const xml = read.data.find((file) => file.mime === "application/xml");
```

**Each file comes back as the `PdfAttachment` a render takes**, so a file read from one PDF can be attached to the next. Its `name` is the
specification's `/UF` where it has one, its `bytes` are inflated, and a `relationship` the file does not declare reads as `Unspecified`.

**The read is bounded, because the bytes are hostile until proved otherwise**: each decoded stream is charged to its own limit and to a total.
**Entries naming the same embedded stream share one `bytes` array**, so a write through one is seen through every other. Pass `limits` to tighten or
widen any bound:

| Limit | Default | Refuses |
| --- | --- | --- |
| `maxInputBytes` | 6 MiB | a larger file, before a byte of it is parsed |
| `maxObjects` | 100,000 | a file carrying more objects, packed ones included |
| `maxInflatedBytes` | 6 MiB | a stream inflating past it — decompression is cancelled there, never finished and then measured |
| `maxTotalDecodedBytes` | 6 MiB | the streams read so far decoding past it together, stored or inflated, any inflation cancelled the same way |

**The defaults are sized for a Worker's 128 MB isolate**, because a read holds several times its input at its peak. A browser reading larger
files raises `maxInputBytes`, `maxInflatedBytes` and `maxTotalDecodedBytes` together, and should expect the same multiple of whatever it allows.

**Every refusal is a failed `Result`, never a throw** — a limit passed, a malformed or encrypted file, an attachment the reader cannot decode, and
an attachment with no valid `/ModDate` or encoded with any filter but `/FlateDecode` — and **a PDF with nothing attached is a failure too**, rather
than an empty list.

---

## What it is not

Not a browser. There is no CSS engine and no HTML input — a document is composed from components, not from a stylesheet. Complex-script shaping,
runtime SVG, AES encryption, signatures and AcroForms are all out of scope, and so is reading an existing PDF beyond its attachments.

[ns-5j]: ../../../docs/NAMESPACES.md#5j-render--one-namespace-per-renderer
