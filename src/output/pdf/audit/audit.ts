import { pdfTaggingOn } from "../limits";
import type { PdfDocument, PdfRendererOptions } from "../types";
import type { PdfAuditFinding } from "./types";

// The audit reads what a render is *configured* to produce rather than the bytes it produced: it
// takes the engine's types and its declared defaults, never its render path.
/** Every way a render's options and front matter fall short of a conformant document. @public */
export function auditPdf(document: PdfDocument, options: PdfRendererOptions = {}): readonly PdfAuditFinding[] {
  const findings: PdfAuditFinding[] = [];
  const title = options.info?.title;

  if (!pdfTaggingOn(options)) {
    findings.push({ rule: "tagged", message: "the document carries no structure tree, so a screen reader has only the drawing order to read" });
  }
  if (options.lang !== undefined && options.lang.trim() === "") {
    findings.push({ rule: "lang", message: "lang is blank; name the document's language as a BCP 47 tag or leave it unset for the default" });
  }
  if (options.metadata !== "standard") {
    findings.push({
      rule: "metadata",
      message: 'metadata is not "standard", so the file carries neither an information dictionary nor an XMP packet',
    });
  } else if (title === undefined || title.trim() === "") {
    findings.push({ rule: "title", message: "info.title is empty, so a viewer asked to show the title has none to show" });
  } else if (title !== document.title) {
    findings.push({ rule: "title", message: `info.title is ${title} but the document is titled ${document.title}; a checker reads both` });
  }
  if (document.letterhead?.mark !== undefined && document.letterhead.mark.alt === undefined) {
    findings.push({ rule: "alt", message: "the letterhead's mark carries no alt, so it is drawn as decoration rather than announced" });
  }
  // The base-14 faces are not embedded, so a tagged document set in them is conformant only as far
  // as whatever face the viewer substitutes — which is not a property of the file.
  if (pdfTaggingOn(options) && (options.fonts ?? []).length === 0) {
    findings.push({ rule: "fonts", message: "a tagged document set in the base-14 faces relies on a font the file does not carry; embed one" });
  }
  return findings;
}
