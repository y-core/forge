import type { PdfArchival, PdfDocumentFonts, PdfImage, PdfPage, PdfResolvedPage, PdfResources, PdfStructureNode, PdfTagging } from "../types";

// The writer's own object shapes: numbering, containers and the cross-reference rows. Nothing
// here describes a document — only the file one becomes, which is why they are not the parent's.

/** What the trailer carries beyond the catalog: the information dictionary and the file identifier. @internal */
export interface PdfFileMetadata {
  info?: string | undefined;
  id?: string | undefined;
  /** The XMP packet, which a conformance checker reads in place of the dictionary. */
  xmp?: string | undefined;
}

/** A document's streams and the numbering they were built against, settled once per render. @internal */
export interface PdfComposition {
  pages: readonly PdfPage[];
  paper: PdfResolvedPage;
  fonts?: PdfDocumentFonts | undefined;
  tagging?: PdfTagging | undefined;
  streams: readonly string[];
  resources: PdfResources;
  /** The object number each image was given, which the writer allocates against rather than derives. */
  images: ReadonlyMap<PdfImage, number>;
  writesBase14: boolean;
  firstPage: number;
  /** The archival level this render declares, which the writer reads for its intent and groups. */
  archival?: PdfArchival | undefined;
  /** The nested tree, built once here because the writer and the outline both read it. */
  structure: PdfStructureNode;
}

/** An object allocated a number in document order, which is what makes the xref offsets reproducible. @internal */
export interface PdfObject {
  id: number;
  body: string | { head: string; bytes: Uint8Array; tail: string };
}

/** Where a cross-reference row sends a reader: a file offset, or the container an object is packed in. @internal */
export type PdfXrefEntry = { offset: number } | { container: number; index: number };

/** Allocates object numbers in the order the document declares them. @internal */
export interface PdfObjectManager {
  allocate(body: PdfObject["body"]): number;
  /** Takes the next number without a body, for an object whose contents are not known yet. */
  reserve(): number;
  fill(id: number, body: PdfObject["body"]): void;
  objects(): readonly PdfObject[];
}
