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

/** What a CLI verb expects of the Workflow it starts: its conventional name, and what its `run()` must return. @internal */
export interface WorkflowPurpose<T> {
  readonly preferred: string;
  readonly returns: string;
  read(output: unknown): T | null;
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
