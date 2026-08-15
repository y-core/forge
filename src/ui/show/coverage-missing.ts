/** One coverage key the catalog does not yet demonstrate, and the task that owes it. @internal */
export interface CoverageGap {
  /** The demo or axis key, as the coverage manifest spells it. */
  key: string;
  /** The ledger task that closes it. Mandatory and non-empty. */
  owner: string;
}

/** The coverage keys the showcase still owes, each owned by a task. The list only shrinks. @internal */
export const COVERAGE_MISSING: readonly CoverageGap[] = [];
