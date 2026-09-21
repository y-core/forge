import type { PdfConformanceRule } from "../types";

/** What a finding is about, which is what a caller filters and reports on. @public */
// The PDF/A half is the union rather than a copy of it, so a prohibition added to the table widens
// this without a second edit — two lists that can disagree is the defect the shared table avoids.
export type PdfAuditRule = "tagged" | "lang" | "metadata" | "title" | "alt" | "fonts" | "table-header" | "embedded-face" | PdfConformanceRule;

/** One thing standing between a document and the conformance it is aiming at. @public */
export interface PdfAuditFinding {
  rule: PdfAuditRule;
  /** What is wrong, and what setting it right means — never only the rule's own name. */
  message: string;
}
