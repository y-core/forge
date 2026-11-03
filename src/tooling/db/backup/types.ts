import type { BackupBucket, D1RestoredDatabase } from "../../../storage/backup/types";
import type { JsoncEdit } from "../../cli/types";

/** What `db reset` was asked for beyond the shared flags. @public */
export interface ResetOptions {
  /** The database name the target must have, so a reset cannot be aimed by a stale flag. */
  readonly expect: string;
  readonly allowUnbacked: boolean;
  /** The R2 dump this reset relies on; absent takes the newest complete dump of this database. */
  readonly dump?: string | undefined;
  readonly bucket?: string | undefined;
  readonly prefix?: string | undefined;
}

/** What a `db reset` run removed, and what it counted before removing it. @public */
export interface ResetOutcome {
  readonly database: string;
  readonly rows: number;
  readonly removed: string | null;
  /** The key of the R2 dump that proved this database is recoverable, when one was needed. */
  readonly backedUpBy: string | null;
}

/** A reset checked through to the artifact that proves its rows recoverable, ready to be confirmed and then executed. @public */
export interface ResetPlan {
  readonly database: string;
  /** The state directory to remove, or null when there is none. */
  readonly state: string | null;
  readonly rows: number;
  /** The key of the R2 dump that proved this database is recoverable, when one was needed. */
  readonly backedUpBy: string | null;
}

/** Where a database's dumps are kept: an R2 binding and the bucket it names, the prefix, and the database id they are kept under. @internal */
export interface DumpSource {
  readonly binding: string;
  /** The `bucket_name` the binding declares, which the REST API addresses a deployed bucket by. */
  readonly bucketName: string;
  readonly prefix: string;
  readonly databaseId: string;
}

/** One dump copied between R2 and disk: its key, the two files on disk, and what its bytes measured. @internal */
export interface DumpCopy {
  readonly key: string;
  /** The dump file on disk. */
  readonly path: string;
  /** The sidecar file beside it. */
  readonly sidecar: string;
  readonly size: number;
  readonly sha256: string;
}

/** How long the REST bucket waits on Cloudflare before it fails a call. @internal */
export interface RestBucketTimeouts {
  /** A request's wait for its answer, and an upload's for its next chunk to be taken. */
  readonly requestMs: number;
  /** A download's wait between two chunks of its body. */
  readonly idleMs: number;
}

/** A D1 database a binding can name. @internal */
export interface PromotionTarget {
  readonly databaseId: string;
  readonly name: string;
}

/** What a promotion would change: one binding's database, from the one it names now to a restored one. @internal */
export interface PromotionPlan {
  readonly configPath: string;
  readonly binding: string;
  readonly env: string | null;
  readonly from: PromotionTarget;
  readonly to: PromotionTarget;
  readonly edits: readonly JsoncEdit[];
}

/** The consumed surface of one prepared D1 statement. @internal */
export interface BackupStatement {
  all(): Promise<{ results: Record<string, unknown>[] }>;
  bind(...values: unknown[]): { raw(): Promise<unknown[][]> };
}

/** The read a census takes: one statement's rows. @internal */
export interface CensusDatabase {
  prepare(query: string): { all(): Promise<{ results: Record<string, unknown>[] }> };
}

/** The consumed surface of a local D1 binding: the census read, miniflare's export, and a batch import. @internal */
export interface BackupDatabase extends CensusDatabase {
  prepare(query: string): BackupStatement;
  batch(statements: BackupStatement[]): Promise<unknown>;
}

/** One dump on its way into a restore target. @internal */
export interface D1ImportSource {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly md5: string;
}

/** Where a D1 import stands: still running at a bookmark, finished, or refused. @internal */
export type D1ImportState =
  | { readonly status: "active"; readonly bookmark: string }
  | { readonly status: "complete"; readonly bookmark: string | null; readonly queries: number }
  | { readonly status: "error"; readonly error: string };

/** Where a D1 export stands: still running at a bookmark, ready behind a signed URL, or refused. @internal */
export type D1ExportState =
  | { readonly status: "active"; readonly bookmark: string }
  | { readonly status: "complete"; readonly bookmark: string | null; readonly signedUrl: string }
  | { readonly status: "error"; readonly error: string };

/** One fragment of SQL text between statement boundaries, as offsets into the text it was cut from. @internal */
export interface SqlStatementSpan {
  readonly start: number;
  /** The index of the terminating `;`, or the text's length for an unterminated tail. */
  readonly end: number;
  readonly terminated: boolean;
  /** True when the fragment holds a token other than whitespace and comments. */
  readonly useful: boolean;
}

/** What a dump measured as it streamed. @internal */
export interface DumpMeasure {
  readonly size: number;
  readonly md5: string;
  readonly sha256: string;
  readonly rows: Record<string, number>;
}

/** A dump's bytes as they pass through, and what they measured once every one has. @internal */
export interface DumpMeter {
  readonly body: ReadableStream<Uint8Array>;
  measure(): DumpMeasure;
}

/** How the pipeline reaches D1's export and import: over REST for a deployed database, or through the platform proxy's bindings for a local one. @internal */
export interface D1Transfer {
  startExport(at: Date): Promise<string>;
  openExport(bookmark: string): Promise<{ readonly body: ReadableStream<Uint8Array>; readonly length: number | null }>;
  openTarget(into: D1RestoreTarget): Promise<D1RestoredDatabase>;
  startImport(target: D1RestoredDatabase, source: D1ImportSource): Promise<D1ImportState>;
  pollImport(target: D1RestoredDatabase, bookmark: string): Promise<D1ImportState>;
  query(target: D1RestoredDatabase, sql: string): Promise<Record<string, unknown>[]>;
}

/** What one backup or restore of the run's database goes through: its bucket, its census, and its D1 transport. @internal */
export interface BackupPorts {
  readonly bucket: BackupBucket;
  readonly database: CensusDatabase;
  readonly transfer: D1Transfer;
  /** `stream` sends the dump as it downloads, at its announced length; `whole` reads it first, as a local binding needs. */
  readonly upload: "stream" | "whole";
}

/** Where `restoreD1Backup` imports a dump: a database it creates, or the empty one `standby` names. @internal */
export type D1RestoreTarget = { readonly fresh: string } | { readonly standby: string };

/** What `takeD1Backup` exports, and where it keeps the dump. @internal */
export interface D1BackupOptions {
  readonly databaseId: string;
  readonly bucket: BackupBucket;
  readonly database: CensusDatabase;
  readonly transfer: D1Transfer;
  /** `stream` sends the dump as it downloads, at its announced length; `whole` reads it first, as a local binding needs. */
  readonly upload: "stream" | "whole";
  /** The instant the dump is named by. */
  readonly at: Date;
  /** Defaults to `d1-backups`. */
  readonly prefix?: string;
  /** How many dumps of this database to keep, the newest first; omitted keeps every one. */
  readonly keep?: number;
  /** How long the download may go without a byte before it fails. Defaults to 60000. */
  readonly idleTimeoutMs?: number;
}

/** Which dump `restoreD1Backup` imports, and where. @internal */
export interface D1RestoreOptions {
  readonly bucket: BackupBucket;
  /** The dump's object key, as `listD1Backups` answers it. */
  readonly key: string;
  readonly into: D1RestoreTarget;
  readonly transfer: D1Transfer;
}
