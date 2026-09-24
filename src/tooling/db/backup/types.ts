import type { BackupManifest, Migration, RestoreRoute, SchemaObject } from "../types";

/** One table, with what a bounded keyset read of it needs: the column it orders by, and how many rows a page holds. @internal */
export interface AppTable {
  readonly name: string;
  readonly key: string;
  /** Every declared column in order, which a whole-table read projects. */
  readonly columns: readonly string[];
  readonly pageRows: number;
}

/** One row, encoded: its identity, its whole-row form, and each cell by column name. @internal */
export interface CanonicalRow {
  readonly key: string;
  readonly canonical: string;
  readonly cells: Readonly<Record<string, string>>;
}

/** Something in an artifact that is not what the artifact claims to be. @internal */
export interface ArtifactFault {
  readonly line: number;
  readonly reason: string;
}

/** One way two copies of a table disagree. Values ride at full width; truncation is the formatter's job. @internal */
export type Divergence =
  | { readonly kind: "only-in-source"; readonly key: string }
  | { readonly kind: "only-in-target"; readonly key: string }
  | { readonly kind: "value"; readonly key: string; readonly column: string; readonly source: string; readonly target: string }
  | { readonly kind: "duplicate-key"; readonly key: string; readonly side: "source" | "target" };

/** The verdict for one table. @internal */
export interface TableComparison {
  readonly table: string;
  /** Exact and never truncated — this is the number a caller asserts is zero. */
  readonly divergent: number;
  readonly divergences: readonly Divergence[];
  readonly truncated: boolean;
  readonly sourceRows: number;
  readonly targetRows: number;
}

/** The merge in progress, opaque to callers apart from being threaded from page to page. @internal */
export interface CompareState {
  readonly divergent: number;
  readonly divergences: readonly Divergence[];
  readonly sourceRows: number;
  readonly targetRows: number;
  readonly pendingSource: readonly CanonicalRow[];
  readonly pendingTarget: readonly CanonicalRow[];
  readonly lastSourceKey: string | null;
  readonly lastTargetKey: string | null;
  readonly sourceExhausted: boolean;
  readonly targetExhausted: boolean;
}

/** Where a keyset read seeks from: the last key read as text, a number or blob bytes, or null before the first page. @internal */
export type ReadCursor = string | number | readonly number[] | null;

/** One page of a table: the canonical rows, the raw rows the artifact is authored from, and the next cursor. @internal */
export interface RowPage {
  readonly rows: readonly CanonicalRow[];
  readonly raw: readonly Record<string, unknown>[];
  readonly cursor: ReadCursor;
  readonly exhausted: boolean;
}

/** A table read whole, kept in memory so one read can be compared against more than one restored target. @internal */
export interface SourceTable {
  readonly table: AppTable;
  readonly columns: readonly string[];
  readonly rows: readonly CanonicalRow[];
  readonly raw: readonly Record<string, unknown>[];
}

/** What a `db backup` run produced. @public */
export interface BackupOutcome {
  readonly directory: string;
  readonly manifest: BackupManifest;
}

/** What `db backup` was asked for beyond the shared flags. @public */
export interface BackupOptions {
  /** Where the artifact directory is created; null takes the host config's `backupsDir`. Relative paths resolve against the root. */
  readonly out: string | null;
  readonly verify: boolean;
  readonly label: string | null;
}

/** What `db restore` was asked for beyond the shared flags. @public */
export interface RestoreOptions {
  /** The artifact directory holding `manifest.json`. */
  readonly artifact: string;
  readonly route: RestoreRoute;
  /** The database name the artifact must have been taken from. */
  readonly expect?: string | undefined;
}

/** What a `db restore` run proved about the target it loaded. @public */
export interface RestoreOutcome {
  readonly database: string;
  readonly route: RestoreRoute;
  readonly artifact: string;
  readonly tables: readonly { readonly name: string; readonly rows: number; readonly matches: boolean }[];
}

/** What `db reset` was asked for beyond the shared flags. @public */
export interface ResetOptions {
  /** The database name the target must have, so a reset cannot be aimed by a stale flag. */
  readonly expect: string;
  readonly allowUnbacked: boolean;
  /** The artifact directory this reset relies on; absent takes the most recent verified backup of this database. */
  readonly backup?: string | undefined;
}

/** What a `db reset` run removed, and what it counted before removing it. @public */
export interface ResetOutcome {
  readonly database: string;
  readonly rows: number;
  readonly removed: string | null;
  /** The artifact directory that proved this database is recoverable, when one was needed. */
  readonly backedUpBy: string | null;
}

/** What a target declared and held when a restore looked at it. @public */
export interface RestoreTargetState {
  readonly objects: readonly SchemaObject[];
  readonly counts: Record<string, number>;
}

/** A restore checked through to the empty target, ready to be confirmed and then executed. @public */
export interface RestorePlan {
  readonly artifact: string;
  readonly route: RestoreRoute;
  readonly manifest: BackupManifest;
  /** The migrations the artifact embeds, each read back hashing to what the manifest declares. */
  readonly migrations: readonly Migration[];
  readonly expectedTables: readonly string[];
  readonly before: RestoreTargetState;
  /** The rows the artifact holds across every app table. */
  readonly rows: number;
}

/** A reset checked through to the artifact that proves its rows recoverable, ready to be confirmed and then executed. @public */
export interface ResetPlan {
  readonly database: string;
  /** The state directory to remove, or null when there is none. */
  readonly state: string | null;
  readonly rows: number;
  /** The artifact directory that proved this database is recoverable, when one was needed. */
  readonly backedUpBy: string | null;
}
