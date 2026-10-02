import { conformanceViolations } from "../conformance";
import { DEFAULT_ORPHANS, DEFAULT_PDF_LANG, DEFAULT_PDF_MAX_PAGES, DEFAULT_WIDOWS, pdfTaggingOn } from "../limits";
import { pdfWritableInfo } from "../metadata";
import { resolvePdfPage } from "../page";
import { paginateWithin } from "../paginate";
import { toPdfElements } from "../tree";
import type { PdfDocument, PdfElement, PdfRendererOptions } from "../types";
import { resolveTypesetting } from "../typesetting";
import type { PdfAuditFinding } from "./types";

// A subset of BCP 47 rather than the whole grammar: the registry itself is not something to ship.
// The classes spell the conventional casing; `i` admits the rest, as RFC 5646 §2.1.1 gives case no meaning.
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/i;

// The audit reads what a render is *configured* to produce rather than the bytes it produced: it
// takes the engine's types and its declared defaults.
/** Every way a render's options and front matter fall short of a conformant document. @public */
export function auditPdf(document: PdfDocument, options: PdfRendererOptions = {}): readonly PdfAuditFinding[] {
  const findings: PdfAuditFinding[] = [];
  // The `info` the render will write rather than the one the caller passed: comparing against the
  // raw value reports a title disagreement between two strings the file holds identically.
  const title = pdfWritableInfo(options.info ?? {}).title;

  if (!pdfTaggingOn(options)) {
    findings.push({ rule: "tagged", message: "the document carries no structure tree, so a screen reader has only the drawing order to read" });
  }
  // Its own rule and not `lang`: "you named no language" is an omission with a different remedy to
  // "your tag is malformed", and only a tagged document writes a `/Lang` to be wrong about.
  if (pdfTaggingOn(options) && options.lang === undefined) {
    findings.push({
      rule: "lang-default",
      message: `lang is unset, so the document will declare ${DEFAULT_PDF_LANG}; name its language as a BCP 47 tag, or set lang to ${DEFAULT_PDF_LANG} to mean it`,
    });
  } else if (options.lang !== undefined && options.lang.trim() === "") {
    findings.push({ rule: "lang", message: "lang is blank; name the document's language as a BCP 47 tag or leave it unset for the default" });
  } else if (options.lang !== undefined && !LANGUAGE.test(options.lang)) {
    findings.push({
      rule: "lang",
      message: `lang is ${options.lang}, which is not a BCP 47 tag; write it as a language and optional region, such as en-ZA`,
    });
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
  // A face supplied with no bytes embeds nothing, so the file is in the same place as one supplying
  // no face at all — and the `fonts` rule above reports a non-empty list as satisfied.
  const hollow = (options.fonts ?? []).filter((face) => face.sfnt.length === 0).map((face) => face.name);
  if (pdfTaggingOn(options) && hollow.length > 0) {
    findings.push({
      rule: "embedded-face",
      message: `the face ${hollow.join(", ")} carries no sfnt bytes, so nothing is embedded; load the face's file into sfnt`,
    });
  }
  findings.push(...structuralFindings(document, options));
  findings.push(...archivalFindings(document, options));
  return findings;
}

// Laid out here rather than judged from the options alone, because three of the prohibitions — a
// base-14 run, a link scheme, an image's colour space — are only visible once the pages exist.
/** Every PDF/A prohibition the level asked for would be refused on, read from the one table. @internal */
function archivalFindings(document: PdfDocument, options: PdfRendererOptions): PdfAuditFinding[] {
  if (options.archival === undefined) return [];
  const { pages } = paginateWithin(
    document,
    {},
    resolvePdfPage(options.page),
    { orphans: options.orphans ?? DEFAULT_ORPHANS, widows: options.widows ?? DEFAULT_WIDOWS },
    resolveTypesetting(options.fonts, options.defaultFont),
    options.maxPages ?? DEFAULT_PDF_MAX_PAGES,
  );
  return conformanceViolations(pages, options, options.archival).map((broken) => ({ rule: broken.rule, message: broken.message }));
}

// `toPdfElements` stops at the first built element, so a container's children are reachable only
// through what it declares — and a Table inside a Stack is otherwise audited as if it were not there.
function* walk(of: readonly PdfElement[]): Generator<PdfElement> {
  for (const element of of) {
    yield element;
    yield* walk(element.children ?? []);
  }
}

// No heading-skip finding: `Heading` admits levels 1 and 2 and a title is always an H1, so a gap is
// not expressible here. `conformPdf` holds that rule over the bytes, where a broken file reaches it.
/** Every blocker the document's own elements declare, which is all an audit can see without a render. @internal */
function structuralFindings(document: PdfDocument, options: PdfRendererOptions): PdfAuditFinding[] {
  if (!pdfTaggingOn(options)) return [];
  const findings: PdfAuditFinding[] = [];
  const elements = [...walk(toPdfElements(document.content))];

  if (elements.some((element) => element.audit?.table?.header === false)) {
    findings.push({
      rule: "table-header",
      message: "a Table has no header row, so a reader cannot be told which column a cell is in; give it a header",
    });
  }
  if (elements.some((element) => element.audit?.drawing?.alt === false)) {
    findings.push({
      rule: "alt",
      message: "a drawing in the reading order carries no alt, so it is announced as nothing; describe it or leave it decoration",
    });
  }
  return findings;
}
