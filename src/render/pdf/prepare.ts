import { err, ok } from "../../result/result";
import { conformanceViolations } from "./conformance";
import { DEFAULT_ORPHANS, DEFAULT_PDF_MAX_PAGES, DEFAULT_WIDOWS, LINK_SCHEMES } from "./limits";
import { resolvePdfPage } from "./page";
import { paginateWithin } from "./paginate";
import { PDF_INK_NAMES } from "./palette";
import { uncovered } from "./text";
import type {
  Ink,
  PdfChannel,
  PdfDocument,
  PdfDocumentFonts,
  PdfInkName,
  PdfPage,
  PdfPalette,
  PdfPrepared,
  PdfRenderError,
  PdfRendererOptions,
  PdfResult,
} from "./types";
import { resolveTypesetting } from "./typesetting";

function channelFor(palette: PdfPalette | undefined): PdfChannel {
  if (palette === undefined) return {};
  const channel: { -readonly [name in PdfInkName]?: Ink | undefined } = {};
  for (const name of PDF_INK_NAMES) channel[name] = palette.ink(name);
  return channel;
}

// Every run is checked before a byte is written, so a character the face setting it cannot carry is
// named rather than printed as something else — a substitution the file gives a reader no sign of.
function refuse(code: number, face?: string): PdfRenderError {
  const point = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  const set = face === undefined ? "the base-14 faces" : `\`${face}\``;
  return { kind: "encoding", message: `${point} is not in ${set} — embed a font that covers it` };
}

// A default naming a face the document does not carry writes a resource name no dictionary holds,
// and the writer's lookup and its resource name then disagree.
function unresolved(options: PdfRendererOptions): PdfRenderError | undefined {
  const { defaultFont, fonts } = options;
  if (defaultFont === undefined) return undefined;
  const missing = (["regular", "bold"] as const).filter((face) => !(fonts ?? []).some((font) => font.name === defaultFont[face]));
  if (missing.length === 0) return undefined;
  const named = missing.map((face) => `${face}: \`${defaultFont[face]}\``).join(", ");
  return { kind: "font", message: `defaultFont names a face \`fonts\` does not carry — ${named}` };
}

// A PDF annotation opens what a reader hands the operating system, and no same-origin fetch turns a
// refusal here into a silent wrong request — so the scheme is judged rather than passed through.
function unreachable(pages: readonly PdfPage[]): PdfRenderError | undefined {
  for (const page of pages) {
    for (const link of page.links ?? []) {
      if (!("uri" in link.target)) continue;
      const scheme = /^([A-Za-z][\w+.-]*):/.exec(link.target.uri)?.[1]?.toLowerCase();
      if (scheme !== undefined && LINK_SCHEMES.includes(scheme)) continue;
      return { kind: "link", message: `a link target must be one of ${LINK_SCHEMES.join(", ")} — \`${link.target.uri}\` is not` };
    }
  }
  return undefined;
}

function unsettable(pages: readonly PdfPage[], fonts: PdfDocumentFonts | undefined): PdfRenderError | undefined {
  for (const page of pages) {
    for (const node of page.nodes) {
      if (node.kind !== "text" || node.embedded === undefined) continue;
      const face = fonts?.find((font) => font.name === node.embedded);
      const missing = [...node.run].map((character) => character.codePointAt(0) ?? 0).find((code) => face?.glyphs.has(code) !== true);
      if (missing !== undefined) return refuse(missing, node.embedded);
    }
  }
  // Only page runs are held to WinAnsi: a text string outside it is written as UTF-16BE, so a title
  // carrying a character the base-14 faces cannot set is still a title the file can hold.
  const runs = pages.flatMap((page) =>
    page.nodes
      .filter((node) => node.kind === "text")
      .filter((node) => node.embedded === undefined)
      .map((node) => node.run),
  );
  for (const run of runs) {
    const code = uncovered(run);
    if (code !== undefined) return refuse(code);
  }
  return undefined;
}

function overCeiling(maxPages: number): PdfRenderError {
  return {
    kind: "max-pages",
    message: `document runs past the ${maxPages}-page ceiling — pagination stopped there rather than laying out the rest`,
  };
}

// Every refusal a render answers with lives here and nowhere else, so the caller that writes bytes
// and the caller that describes the layout cannot come to disagree about which documents are legal.
/** A document and a set of options as the pages they lay out to, or the first refusal they meet. @internal */
export function preparePdfRender(doc: PdfDocument, options: PdfRendererOptions): PdfResult<PdfPrepared> {
  const refused = unresolved(options);
  if (refused !== undefined) return err(refused);
  const paper = resolvePdfPage(options.page);
  const maxPages = options.maxPages ?? DEFAULT_PDF_MAX_PAGES;
  const { pages, over } = paginateWithin(
    doc,
    channelFor(options.palette),
    paper,
    { orphans: options.orphans ?? DEFAULT_ORPHANS, widows: options.widows ?? DEFAULT_WIDOWS },
    resolveTypesetting(options.fonts, options.defaultFont),
    maxPages,
  );
  const unreached = unreachable(pages);
  if (unreached !== undefined) return err(unreached);
  const unset = unsettable(pages, options.fonts);
  if (unset !== undefined) return err(unset);
  // Read from the table `auditPdf` reports the same prohibitions out of, so the two cannot come to
  // disagree about which documents may declare a level.
  const broken = options.archival === undefined ? [] : conformanceViolations(pages, options, options.archival);
  const first = broken[0];
  if (first !== undefined) return err({ kind: "pdfa", message: first.message });
  if (over) return err(overCeiling(maxPages));
  return ok({ pages, paper });
}
