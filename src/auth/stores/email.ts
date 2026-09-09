/** Reduces an address to the form the unique index holds, so one mailbox cannot become two accounts. @public */
export function normalizeEmail(email: string): string {
  // NFKC before casing, both over the whole address: SQLite's `COLLATE NOCASE` folds ASCII only, so
  // `İ` and `ﬀ` would each open a second account for one mailbox.
  return email.trim().normalize("NFKC").toLowerCase();
}
