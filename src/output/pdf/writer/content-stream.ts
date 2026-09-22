import { kernedArray } from "../embed";
import { BOLD, REGULAR } from "../geometry";
import { collectPdfImages } from "../image";
import { resolvePdfPage } from "../page";
import { pathOperators } from "../path";
import { createPdfResources } from "../resources";
import { markedBracket, markedRuns, structureTreeOf } from "../structure";
import { num, pdfString } from "../text";
import type {
  PdfArchival,
  PdfDocumentFonts,
  PdfImage,
  PdfNode,
  PdfPage,
  PdfPagePosition,
  PdfResolvedPage,
  PdfResources,
  PdfTagging,
  PdfTextNode,
} from "../types";
import type { PdfComposition } from "./types";

// A placeholder is the one thing the writer knows that layout did not: a band is laid out once, and
// the page it lands on is only settled when the file is emitted.
/** A run's words once the page it landed on is known, which is what the file actually carries. @internal */
export function substitutedRun(node: PdfTextNode, at: PdfPagePosition): string {
  if (node.placeholder === undefined) return node.run;
  return String(node.placeholder === "page-count" ? at.count : at.index + 1);
}

// The name is derived from the face's position rather than from the face's own name: a hash of the
// name collides, and the loser's runs then draw in the winner's glyphs with nothing disclosing it.
/** The resource name the face at `index` of a document's `fonts` is addressed by. @internal */
export function fontResource(index: number): string {
  return `E${index}`;
}

/** One display-list node as the operators that draw it, in PDF's y-up user space. @internal */
export function operatorsFor(
  node: PdfNode,
  height = resolvePdfPage().height,
  at: PdfPagePosition = { index: 0, count: 1 },
  fonts?: PdfDocumentFonts,
  resources: PdfResources = createPdfResources(height),
): string {
  const up = (y: number): number => height - y;
  switch (node.kind) {
    case "text": {
      const embedded = node.embedded === undefined ? undefined : fonts?.find((font) => font.name === node.embedded);
      const run = substitutedRun(node, at);
      // A viewer applies no shaping of its own, so a kern reaches the page only as a `TJ` number:
      // plain `Tj` would draw every embedded run wider than measurement reserved for it.
      const [set, operator] = embedded === undefined ? [`(${pdfString(run)})`, "Tj"] : [kernedArray(run, embedded), "TJ"];
      const resource = node.embedded === undefined ? (node.face === "bold" ? BOLD : REGULAR) : resources.font(node.embedded);
      return `BT /${resource} ${num(node.size)} Tf ${num(node.tracking)} Tc ${num(node.x)} ${num(up(node.y))} Td ${set} ${operator} ET`;
    }
    case "path":
      return pathOperators(node, up, resources);
    case "image": {
      // An image is drawn on the unit square, so the rectangle it fills is a transform rather than
      // an argument — and the transform has to be bracketed or it scales everything after it.
      const state = node.alpha === undefined ? "" : `/${resources.alpha(node.alpha)} gs `;
      const place = `${num(node.width)} 0 0 ${num(node.height)} ${num(node.x)} ${num(up(node.y + node.height))} cm`;
      return `q ${state}${place} /${resources.image(node.image)} Do Q`;
    }
    default: {
      // An ink change persists until the next one, so its alpha is set outside any `q`/`Q` bracket —
      // which is why closing a translucent run means naming an opaque ink rather than restoring one.
      const alpha = node.ink[3];
      const state = alpha === undefined ? "" : `/${resources.alpha(alpha)} gs `;
      return `${state}${num(node.ink[0])} ${num(node.ink[1])} ${num(node.ink[2])} ${node.channel === "stroke" ? "RG" : "rg"}`;
    }
  }
}

/** Every page's content stream, in document order, before any filter is applied. @internal */
function contentStreams(
  pages: readonly PdfPage[],
  paper: PdfResolvedPage,
  resources: PdfResources,
  fonts?: PdfDocumentFonts,
  tagged = false,
): string[] {
  return pages.map((page, index) => {
    const at: PdfPagePosition = { index, count: pages.length };
    const drawn = page.nodes.map((node) => operatorsFor(node, paper.height, at, fonts, resources));
    if (!tagged) return drawn.join("\n");
    // The tree points at a run by its marked-content id, so the bracket in the stream and the
    // element in the tree are both derived from the same grouping rather than kept in step by hand.
    return markedRuns(page)
      .map((run) => [markedBracket(run), ...drawn.slice(run.from, run.to + 1), "EMC"].join("\n"))
      .join("\n");
  });
}

/** A document's numbering settled and its streams built, which the digest and the writer both read. @internal */
export function composePdf(
  pages: readonly PdfPage[],
  paper: PdfResolvedPage = resolvePdfPage(),
  fonts?: PdfDocumentFonts,
  tagging?: PdfTagging,
  archival?: PdfArchival,
): PdfComposition {
  const faces = fonts ?? [];
  // The pair is resources, not metrics: a node with no `embedded` is the only thing that can select
  // F1 or F2, so a document where none does carries two font objects nothing points at.
  const base14 = pages.some((page) => page.nodes.some((node) => node.kind === "text" && node.embedded === undefined));
  // A document embedding nothing keeps the pair it might have set in, which is what makes every
  // document supplying no `fonts` byte-identical rather than merely tested to be.
  const writesBase14 = base14 || faces.length === 0;
  const images = new Map<PdfImage, number>();
  let next = 3 + (writesBase14 ? 2 : 0) + faces.length;
  for (const image of collectPdfImages(pages)) {
    images.set(image, next);
    next += image.mask === undefined ? 1 : 2;
  }
  const firstPage = next + pages.reduce((total, page) => total + (page.links?.length ?? 0), 0);
  const resources = createPdfResources(paper.height, images, new Map(faces.map((font, index) => [font.name, fontResource(index)])));
  return {
    pages,
    paper,
    fonts,
    tagging,
    streams: contentStreams(pages, paper, resources, fonts, tagging !== undefined),
    // Built here and not in the writer, because the writer and the outline both read it — and each
    // walk of every node is a traversal a render has to pay for.
    structure: structureTreeOf(pages),
    resources,
    images,
    writesBase14,
    firstPage,
    ...(archival === undefined ? {} : { archival }),
  };
}
