/** One object read back out of a file, with its dictionary text and the stream payload it declared. @internal */
export interface PdfParsedObject {
  id: number;
  dict: string;
  stream?: Uint8Array<ArrayBuffer>;
  container?: number;
}

/** A file resolved to the objects it carries, however its cross-reference chose to name them. @internal */
export interface PdfParsedFile {
  objects: ReadonlyMap<number, PdfParsedObject>;
  trailer: string;
}

/** One `/StructElem` read back into the parts a conformance rule asks about. @internal */
export interface PdfStructElement {
  id: number;
  type: string;
  children: number[];
  mcid?: number | undefined;
  alt?: boolean | undefined;
  page?: number | undefined;
}

/** What a conformance rule is called, which is the name a finding and a refusal must share. @internal */
export type PdfConformRule =
  | "annot-contents"
  | "annot-flags"
  | "annot-key"
  | "annot-parent"
  | "document-root"
  | "figure-alt"
  | "heading-skip"
  | "list-shape"
  | "mcid-unresolved"
  | "output-intent"
  | "pdfa-declaration"
  | "transparency-group"
  | "font-not-embedded"
  | "info-xmp-mismatch"
  | "page-tabs"
  | "parent-tree-next-key"
  | "table-shape";

/** One way an emitted file falls short, named by its rule and said in terms a reader can act on. @internal */
export interface PdfConformFinding {
  rule: PdfConformRule;
  detail: string;
}
