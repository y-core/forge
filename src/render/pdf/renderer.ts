import { err, ok } from "../../result/result";
import { DEFAULT_PDF_LANG, pdfTaggingOn } from "./limits";
import { fileIdentifier, infoDictionary, pdfWritableInfo } from "./metadata";
import { preparePdfRender } from "./prepare";
import type { PdfAttachment, PdfPage, PdfRenderer, PdfRendererOptions, PdfResolvedPage } from "./types";
import { composePdf } from "./writer/content-stream";
import { deflate } from "./writer/deflate";
import { PDF_ENCODER } from "./writer/objects";
import type { PdfFileMetadata } from "./writer/types";
import { writePdf } from "./writer/writer";
import { xmpPacket } from "./xmp";

// A file's length precedes its bytes, so a byte moved from one attachment into the next is a new identity.
function identifierMaterial(streams: readonly string[], attachments: readonly PdfAttachment[]): Uint8Array<ArrayBuffer> {
  const parts = [
    PDF_ENCODER.encode(streams.join("\n")),
    ...attachments.flatMap((file) => [PDF_ENCODER.encode(`\n${file.name}\n${file.mime}\n${file.bytes.length}\n`), file.bytes]),
  ];
  const material = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    material.set(part, at);
    at += part.length;
  }
  return material;
}

// `/ID` hashes the *uncompressed* operators, so one document keeps one identity whether or not its
// streams are filtered — and two renders of it produce the same file, byte for byte.
async function assemble(pages: readonly PdfPage[], paper: PdfResolvedPage, options: PdfRendererOptions): Promise<Uint8Array<ArrayBuffer>> {
  const tagging = pdfTaggingOn(options) ? { lang: options.lang ?? DEFAULT_PDF_LANG } : undefined;
  const composed = composePdf(pages, paper, options.fonts, tagging, options.archival, options.attachments);
  const standard = options.metadata === "standard";
  // The packet and the dictionary are derived from one title rather than given two, because two
  // metadata blocks disagreeing is the ordinary way a conformant file fails a conformance check.
  const info = pdfWritableInfo(options.info ?? {});
  const metadata: PdfFileMetadata | undefined = standard
    ? {
        info: infoDictionary(info),
        id: await fileIdentifier(identifierMaterial(composed.streams, options.attachments ?? [])),
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
