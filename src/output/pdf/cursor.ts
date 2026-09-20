import {
  BLACK_INK,
  CONTACT_SIZE,
  LETTERHEAD_GAP,
  LETTERHEAD_LINE_GAP,
  LETTERHEAD_MARK_GAP,
  LETTERHEAD_MARK_WIDTH,
  LETTERHEAD_NAME_SIZE,
  LETTERHEAD_TAGLINE_SIZE,
  OPAQUE_INK,
  RULE_WEIGHT,
} from "./geometry";
import { pdfContentBox, resolvePdfPage } from "./page";
import { createPdfPen, roundedBoxCommands, transformCommands } from "./path";
import type { Ink, PdfArtwork, PdfCursor, PdfCursorOptions, PdfLetterhead, PdfPage, PdfResolvedPage, PdfTag } from "./types";
import { BASE14_TYPESETTING } from "./typesetting";

// Closing a translucent run has to restore opacity as well as colour: alpha is graphics state, and
// state set outside a `q`/`Q` bracket outlives the run that set it.
function closing(ink: Ink): Ink {
  return ink[3] === undefined ? BLACK_INK : OPAQUE_INK;
}

function markWidthOf(letterhead: PdfLetterhead): number {
  return letterhead.mark === undefined ? 0 : (letterhead.markWidth ?? LETTERHEAD_MARK_WIDTH);
}

// The block is as tall as whichever is taller, the mark or the wording, so a short mark does not
// crop the wording and a tall one is not cropped by it.
function letterheadHeight(letterhead: PdfLetterhead): number {
  const mark = letterhead.mark;
  const artwork = mark === undefined ? 0 : (markWidthOf(letterhead) * mark.height) / mark.width;
  const wording = LETTERHEAD_NAME_SIZE + LETTERHEAD_LINE_GAP + LETTERHEAD_TAGLINE_SIZE;
  return Math.max(artwork, wording);
}

/** Where the first line of a page sits, once a letterhead has taken the room it needs. @internal */
export function letterheadTop(letterhead: PdfLetterhead | undefined, paper: PdfResolvedPage = resolvePdfPage()): number {
  const top = paper.margin.top;
  return letterhead === undefined ? top : top + letterheadHeight(letterhead) + LETTERHEAD_GAP * 2;
}

// A throw rather than a return code: `newPage` has call sites in four files that could not act on a
// refusal, and every one of them would be a silent overrun if the answer were theirs to check.
/** What `newPage` raises at a cursor's ceiling; `paginateWithin` is the only thing that catches it. @internal */
export class PdfPageCeiling extends Error {}

/** A cursor over a fresh document, repeating `letterhead` at the head of every page it opens. @internal */
export function createCursor(letterhead: PdfLetterhead | undefined, options: PdfCursorOptions = {}): PdfCursor {
  const { channel = {}, paper = resolvePdfPage(), header, measure, typesetting = BASE14_TYPESETTING, ceiling } = options;
  const bottom = options.bottom ?? pdfContentBox(paper).bottom;
  const content = pdfContentBox(paper);
  const pages: PdfPage[] = [];
  let top = content.top;
  let page: PdfPage = { nodes: [], links: [], y: content.top, letterheadNodes: 0 };
  let tag: PdfTag = "value";
  let alt: string | undefined;
  let linking = false;
  // A node belongs to the run the cursor is tagged for, so a page's structure is a property of where
  // a node was drawn; a link's content is a link whatever it is made of, so that wins over the tag.
  const marked = (): { tag: PdfTag; alt?: string } => {
    const own = linking ? "link" : tag;
    return alt === undefined ? { tag: own } : { tag: own, alt };
  };

  const cursor: PdfCursor = {
    pages,
    channel,
    paper,
    typesetting,
    get pageTop() {
      return top;
    },
    get y() {
      return page.y;
    },
    set y(value: number) {
      page.y = value;
    },
    get empty() {
      return page.nodes.length === page.letterheadNodes;
    },
    tagged(next, draw, describe) {
      const [wasTag, wasAlt] = [tag, alt];
      [tag, alt] = [next, describe];
      draw();
      [tag, alt] = [wasTag, wasAlt];
    },
    text(run, x, y, face, size, tracking = 0, placeholder, embedded) {
      // The one place the document default is applied, which is what makes it reach the form
      // vocabulary, the front matter and the letterhead alike.
      const set = embedded === undefined ? typesetting.embedded(face)?.name : (embedded ?? undefined);
      page.nodes.push({
        kind: "text",
        ...marked(),
        x,
        y,
        run,
        face,
        size,
        tracking,
        ...(placeholder === undefined ? {} : { placeholder }),
        ...(set === undefined ? {} : { embedded: set }),
      });
    },
    linked(target, box, draw) {
      const was = linking;
      linking = true;
      const from = page.y;
      draw();
      linking = was;
      page.links?.push({ target, x: box.x, y: from, width: box.width, height: page.y - from });
    },
    path(commands, paint = {}) {
      page.nodes.push({ kind: "path", ...marked(), commands, ...paint });
    },
    image(of, x, y, width, height, alpha) {
      page.nodes.push({ kind: "image", ...marked(), x, y, width, height, image: of, ...(alpha === undefined ? {} : { alpha }) });
    },
    rule(y) {
      cursor.segment(content.x, y, content.width, RULE_WEIGHT);
    },
    segment(x, y, width, weight) {
      cursor.path(
        createPdfPen()
          .move(x, y)
          .line(x + width, y)
          .commands(),
        { paint: "stroke", weight },
      );
    },
    polyline(points, weight) {
      const pen = createPdfPen();
      for (const [index, [x, y]] of points.entries()) (index === 0 ? pen.move : pen.line).call(pen, x, y);
      cursor.path(pen.commands(), { paint: "stroke", weight });
    },
    roundedRect(x, y, size, radius, weight) {
      cursor.path(roundedBoxCommands(x, y, size, size, radius), { paint: "stroke", weight });
    },
    ink(colour, onto = "fill") {
      page.nodes.push({ kind: "ink", ...marked(), channel: onto, ink: colour });
    },
    painted(ink, draw) {
      if (ink === undefined) {
        draw();
        return;
      }
      cursor.ink(ink);
      draw();
      cursor.ink(closing(ink));
    },
    stroked(ink, draw) {
      if (ink === undefined) {
        draw();
        return;
      }
      cursor.ink(ink, "stroke");
      draw();
      cursor.ink(closing(ink), "stroke");
    },
    newPage() {
      if (ceiling !== undefined && pages.length >= ceiling) throw new PdfPageCeiling();
      page = { nodes: [], links: [], y: content.top, letterheadNodes: 0 };
      pages.push(page);
      if (letterhead !== undefined) {
        drawLetterhead(cursor, letterhead, content);
        page.y = letterheadTop(letterhead, paper);
      }
      if (header !== undefined && measure !== undefined) {
        for (const element of header.elements) for (const fragment of element.fragments(measure)) fragment.paint(cursor);
      }
      top = page.y;
      page.letterheadNodes = page.nodes.length;
    },
    reserve(height) {
      if (page.y + height > bottom) cursor.newPage();
    },
  };

  return cursor;
}

function sameInk(one: Ink | undefined, other: Ink | undefined): boolean {
  return one !== undefined && other !== undefined && one.length === other.length && one.every((channel, index) => channel === other[index]);
}

// The artwork keeps its own colours — they are the mark, and the palette says nothing about them.
// An ink persists until the next one, so a run sharing a colour states it once and resets at its end.
function drawArtwork(cursor: PdfCursor, artwork: PdfArtwork, x: number, y: number, width: number): void {
  const scale = width / artwork.width;
  let fill: Ink | undefined;
  let stroke: Ink | undefined;
  for (const drawn of artwork.paths) {
    if (drawn.fill !== undefined && !sameInk(drawn.fill, fill)) cursor.ink(drawn.fill);
    if (drawn.stroke !== undefined && !sameInk(drawn.stroke, stroke)) cursor.ink(drawn.stroke, "stroke");
    fill = drawn.fill ?? fill;
    stroke = drawn.stroke ?? stroke;
    cursor.path(transformCommands(drawn.commands, x, y, scale), {
      paint: drawn.stroke === undefined ? "fill" : drawn.fill === undefined ? "stroke" : "fill-stroke",
      ...(drawn.weight === undefined ? {} : { weight: drawn.weight * scale }),
    });
  }
  if (fill !== undefined) cursor.ink(closing(fill));
  if (stroke !== undefined) cursor.ink(closing(stroke), "stroke");
}

function drawLetterhead(cursor: PdfCursor, letterhead: PdfLetterhead, content: { x: number; width: number; top: number }): void {
  const right = content.x + content.width;
  const markWidth = markWidthOf(letterhead);
  const wordingX = content.x + (markWidth === 0 ? 0 : markWidth + LETTERHEAD_MARK_GAP);
  const nameY = content.top + LETTERHEAD_NAME_SIZE;
  const taglineY = nameY + LETTERHEAD_LINE_GAP + LETTERHEAD_TAGLINE_SIZE;

  if (letterhead.mark !== undefined) {
    cursor.tagged(
      "artwork",
      () => {
        drawArtwork(cursor, letterhead.mark as PdfArtwork, content.x, content.top, markWidth);
      },
      letterhead.mark.alt,
    );
  }

  cursor.tagged("letterhead", () => {
    cursor.painted(cursor.channel.letterhead, () => {
      cursor.text(letterhead.name, wordingX, nameY, "regular", LETTERHEAD_NAME_SIZE);
      cursor.text(letterhead.tagline, wordingX, taglineY, "regular", LETTERHEAD_TAGLINE_SIZE);
      for (const [line, at] of [
        [letterhead.email, nameY],
        [letterhead.phone, taglineY],
      ] as const) {
        cursor.text(line, right - cursor.typesetting.width(line, CONTACT_SIZE), at, "regular", CONTACT_SIZE);
      }
    });
  });

  cursor.tagged("rule", () => {
    cursor.stroked(cursor.channel.rule, () => {
      cursor.rule(content.top + letterheadHeight(letterhead) + LETTERHEAD_GAP);
    });
  });
}
