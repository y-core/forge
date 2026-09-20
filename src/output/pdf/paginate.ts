import { createCursor, letterheadTop, PdfPageCeiling } from "./cursor";
import { place } from "./elements";
import { HEADED, HEADING_TRACKING, INTRO_LINE, INTRO_SIZE, LINE, SUBTITLE_SIZE, TITLE_SIZE } from "./geometry";
import { measureRun } from "./measure";
import { pdfContentBox, resolvePdfPage } from "./page";
import { toPdfElements } from "./tree";
import type {
  PdfBand,
  PdfBox,
  PdfBreakLimits,
  PdfChannel,
  PdfCursor,
  PdfDocument,
  PdfElement,
  PdfPage,
  PdfResolvedPage,
  PdfTypesetting,
} from "./types";
import { BASE14_TYPESETTING } from "./typesetting";

function drawFrontMatter(cursor: PdfCursor, doc: PdfDocument, measure: PdfBox): void {
  const set = cursor.typesetting;
  cursor.tagged("title", () => {
    cursor.painted(cursor.channel.heading, () => {
      for (const line of set.wrap(doc.title.toUpperCase(), TITLE_SIZE, measure.width, HEADED)) {
        cursor.y += TITLE_SIZE + 4;
        cursor.text(line, measure.x, cursor.y, "bold", TITLE_SIZE, HEADING_TRACKING);
      }
    });
  });
  if (doc.intro !== undefined) {
    cursor.y += 4;
    cursor.tagged("intro", () => {
      cursor.painted(cursor.channel.intro, () => {
        for (const line of set.wrap(doc.intro ?? "", INTRO_SIZE, measure.width)) {
          cursor.y += INTRO_LINE;
          cursor.text(line, measure.x, cursor.y, "regular", INTRO_SIZE);
        }
      });
    });
    cursor.y += 4;
  }
  if (doc.subtitle !== undefined) {
    cursor.tagged("subtitle", () => {
      for (const line of set.wrap(doc.subtitle ?? "", SUBTITLE_SIZE, measure.width)) {
        cursor.y += LINE;
        cursor.text(line, measure.x, cursor.y, "regular", SUBTITLE_SIZE);
      }
    });
  }
  cursor.y += 8;
  cursor.tagged("rule", () => {
    cursor.stroked(cursor.channel.rule, () => {
      cursor.rule(cursor.y);
    });
  });
  cursor.y += 8;
}

/** The content split into the runs that are kept together: a heading and everything under it. */
function sections(content: readonly PdfElement[]): PdfElement[][] {
  const runs: PdfElement[][] = [];
  for (const one of content) {
    const last = runs.at(-1);
    if (one.startsSection === true || last === undefined) runs.push([one]);
    else last.push(one);
  }
  return runs;
}

/** A band as the element it lays out to and the room it takes, which the content box then gives up. @internal */
function bandOf(content: PdfContentOrUndefined, box: PdfBox, set?: PdfTypesetting): PdfBand | undefined {
  const elements = toPdfElements(content ?? null);
  if (elements.length === 0) return undefined;
  const height = elements.reduce((total, element) => total + element.measure(box.width, set).height, 0);
  return { elements, height };
}

type PdfContentOrUndefined = Parameters<typeof toPdfElements>[0] | undefined;

// A band is painted into a page that already exists, so it is drawn on a scratch cursor and its
// nodes appended — which keeps the band's own layout out of the flowing content's baseline.
function paintBand(page: PdfPage, band: PdfBand, box: PdfBox, y: number, channel: PdfChannel, paper: PdfResolvedPage, set: PdfTypesetting): void {
  // The scratch cursor names no ceiling: it opens one page per page already built, so counting its
  // `newPage` against the document's budget would spend the budget twice over.
  const scratch = createCursor(undefined, { channel, paper, typesetting: set });
  scratch.newPage();
  scratch.y = y;
  for (const element of band.elements) place(scratch, element, box);
  page.nodes.push(...(scratch.pages[0]?.nodes ?? []));
}

// The ceiling is held where pages are made rather than counted afterwards, so the page that would
// cross it is never built — which is what makes a runaway document cost its budget and no more.
/** The document flowed onto pages, stopping at `ceiling`; `over` says it had more to lay out. @internal */
export function paginateWithin(
  doc: PdfDocument,
  channel: PdfChannel = {},
  paper: PdfResolvedPage = resolvePdfPage(),
  limits: PdfBreakLimits = {},
  set: PdfTypesetting = BASE14_TYPESETTING,
  ceiling?: number,
): { pages: PdfPage[]; over: boolean } {
  const page = pdfContentBox(paper);
  const full: PdfBox = { x: page.x, width: page.width, height: page.bottom - page.top };
  const header = bandOf(doc.header, full, set);
  const footer = bandOf(doc.footer, full, set);

  const top = letterheadTop(doc.letterhead, paper) + (header?.height ?? 0);
  const bottom = page.bottom - (footer?.height ?? 0);
  const measure: PdfBox = { x: page.x, width: page.width, height: bottom - top };
  const cursor = createCursor(doc.letterhead, {
    channel,
    paper,
    header,
    measure,
    bottom,
    typesetting: set,
    ...(ceiling === undefined ? {} : { ceiling }),
  });
  try {
    cursor.newPage();
    drawFrontMatter(cursor, doc, measure);

    for (const elements of sections(toPdfElements(doc.content))) {
      // A section taller than a page has to break somewhere, so `fits` is what separates it from one
      // worth moving whole: without that test it would open a blank page before the same overflow.
      if (elements[0]?.startsSection === true && !cursor.empty) {
        const { height, fits } = measureRun(elements, measure, top, bottom, set);
        if (fits && cursor.y + height > bottom) cursor.newPage();
      }
      for (const element of elements) place(cursor, element, measure, limits);
    }
  } catch (thrown) {
    if (!(thrown instanceof PdfPageCeiling)) throw thrown;
    return { pages: cursor.pages, over: true };
  }

  if (footer !== undefined) {
    for (const built of cursor.pages) paintBand(built, footer, measure, bottom, channel, paper, set);
  }
  return { pages: cursor.pages, over: false };
}

/** The document flowed onto pages, each carrying the display list that draws it. @internal */
export function paginate(
  doc: PdfDocument,
  channel?: PdfChannel,
  paper?: PdfResolvedPage,
  limits?: PdfBreakLimits,
  set?: PdfTypesetting,
): PdfPage[] {
  return paginateWithin(doc, channel, paper, limits, set).pages;
}
