/** A ledger task id, which a comment or a governing document never carries; the placeholder `feat-YYMMDD-NN` spells the format and passes. @internal */
export const LEDGER_ID = /\b(?:bug|feat|chore|spike|decision)-\d{6}-\d{2,}\b/;

/** The finding text both the comment budget and the docs check report a ledger id under. @internal */
export function ledgerIdMessage(id: string, where: "a comment" | "a governing doc"): string {
  return `ledger id \`${id}\` — ${where} states the reason, not the ledger row that recorded it`;
}
