/** D1's hard per-statement and per-table limits: the client refuses a statement over them, and `forge db lint` a table over them. @public */
export const D1_LIMITS = { boundParams: 100, statementBytes: 100_000, columns: 100 } as const;
