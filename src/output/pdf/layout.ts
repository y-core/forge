import { ok } from "../../result/result";
import { preparePdfRender } from "./prepare";
import type { PdfDocument, PdfLayout, PdfLayoutNode, PdfNode, PdfPagePosition, PdfRendererOptions, PdfResult } from "./types";
import { substitutedRun } from "./writer/content-stream";

// `num` from `text.ts` trims trailing zeros, because a PDF operand is read by a parser; a fixture is
// read by a person, and a variable-width number puts every token after it in a different column.
const PLACES = 3;

function fixed(value: number): string {
  const drawn = value.toFixed(PLACES);
  return drawn === `-${(0).toFixed(PLACES)}` ? (0).toFixed(PLACES) : drawn;
}

function projected(node: PdfNode, at: PdfPagePosition): PdfLayoutNode | undefined {
  const drawing = { tag: node.tag, ...(node.alt === undefined ? {} : { alt: node.alt }) };
  switch (node.kind) {
    case "text":
      return {
        kind: "text",
        ...drawing,
        x: node.x,
        y: node.y,
        text: substitutedRun(node, at),
        face: node.face,
        size: node.size,
        tracking: node.tracking,
      };
    case "image":
      return { kind: "image", ...drawing, x: node.x, y: node.y, width: node.width, height: node.height };
    case "path":
      return { kind: "path", ...drawing };
    // An ink change is paint state rather than a drawing, so it is not in the layout at all: a
    // palette must not be able to move a line of the description it produces.
    default:
      return undefined;
  }
}

/** Where every drawing of a document landed, under the same refusals a render is held to. @public */
export function describePdfLayout(doc: PdfDocument, options: PdfRendererOptions = {}): PdfResult<PdfLayout> {
  const prepared = preparePdfRender(doc, options);
  if (!prepared.ok) return prepared;
  const { pages } = prepared.data;
  return ok({
    pages: pages.map((page, index) => ({
      nodes: page.nodes.flatMap((node) => {
        const drawn = projected(node, { index, count: pages.length });
        return drawn === undefined ? [] : [drawn];
      }),
    })),
  });
}

// Every token is `key=value` and none is positional, so nothing has to be counted to be read, a
// token added later never changes what an existing one means, and `rg 'tag=title'` works.
function line(node: PdfLayoutNode, page: number): string {
  const tokens = [`page=${page}`, `kind=${node.kind}`, `tag=${node.tag}`];
  if (node.kind !== "path") tokens.push(`x=${fixed(node.x)}`, `y=${fixed(node.y)}`);
  if (node.kind === "image") tokens.push(`width=${fixed(node.width)}`, `height=${fixed(node.height)}`);
  if (node.kind === "text") tokens.push(`size=${fixed(node.size)}`, `face=${node.face}`, `tracking=${fixed(node.tracking)}`);
  if (node.alt !== undefined) tokens.push(`alt=${JSON.stringify(node.alt)}`);
  // The words go last because they are the one unbounded-width value: a change of wording then
  // shifts nothing to its right, and the run is quoted so it can never break the line it is on.
  if (node.kind === "text") tokens.push(`text=${JSON.stringify(node.text)}`);
  return tokens.join(" ");
}

/** A layout as one line per drawing: a text fixture a reviewer reads a diff of. @public */
export function formatPdfLayout(layout: PdfLayout): string {
  // Every line is terminated rather than separated, so a committed fixture carries no `\ No newline`
  // noise and an empty layout is an empty file.
  return layout.pages.flatMap((page, index) => page.nodes.map((node) => `${line(node, index + 1)}\n`)).join("");
}
