/** One published component `catalog.md` does not yet route a job to, and the task that owes it. @internal */
export interface CatalogGap {
  /** The component name, as its barrel exports it. */
  key: string;
  /** The ledger task that closes it. Mandatory and non-empty. */
  owner: string;
}
