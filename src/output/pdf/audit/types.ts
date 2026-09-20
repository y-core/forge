/** What a finding is about, which is what a caller filters and reports on. @public */
export type PdfAuditRule = "tagged" | "lang" | "metadata" | "title" | "alt" | "fonts";

/** One thing standing between a document and the conformance it is aiming at. @public */
export interface PdfAuditFinding {
  rule: PdfAuditRule;
  /** What is wrong, and what setting it right means — never only the rule's own name. */
  message: string;
}
