import { err, ok } from "../../result/result";
import { DEFAULT_PDF_LANG, pdfTaggingOn } from "./limits";
import { fileIdentifier, infoDictionary, pdfWritableInfo } from "./metadata";
import { preparePdfRender } from "./prepare";
import type { PdfPage, PdfRenderer, PdfRendererOptions, PdfResolvedPage } from "./types";
import { composePdf } from "./writer/content-stream";
import { deflate } from "./writer/deflate";
import type { PdfFileMetadata } from "./writer/types";
import { writePdf } from "./writer/writer";
import { xmpPacket } from "./xmp";

// `/ID` hashes the *uncompressed* operators, so one document keeps one identity whether or not its
// streams are filtered — and two renders of it produce the same file, byte for byte.
async function assemble(pages: readonly PdfPage[], paper: PdfResolvedPage, options: PdfRendererOptions): Promise<Uint8Array<ArrayBuffer>> {
  const tagging = pdfTaggingOn(options) ? { lang: options.lang ?? DEFAULT_PDF_LANG } : undefined;
  const composed = composePdf(pages, paper, options.fonts, tagging, options.archival);
  const standard = options.metadata === "standard";
  // The packet and the dictionary are derived from one title rather than given two, because two
  // metadata blocks disagreeing is the ordinary way a conformant file fails a conformance check.
  const info = pdfWritableInfo(options.info ?? {});
  const metadata: PdfFileMetadata | undefined = standard
    ? {
        info: infoDictionary(info),
        id: await fileIdentifier(composed.streams.join("\n")),
        xmp: xmpPacket(info, tagging !== undefined, options.archival),
      }
    : undefined;
  const filtered = options.compress === false ? undefined : await Promise.all(composed.streams.map(deflate));
  return await writePdf(composed, filtered, metadata);
}

/** Builds a renderer that draws every document it is given on the same options and palette. @public */
export function createPdfRenderer(options: PdfRendererOptions = {}): PdfRenderer {
  return {
    render(doc) {
      const prepared = preparePdfRender(doc, options);
      if (!prepared.ok) return Promise.resolve(err(prepared.error));
      return assemble(prepared.data.pages, prepared.data.paper, options).then((bytes) => ok<Uint8Array<ArrayBuffer>>(bytes));
    },
  };
}
