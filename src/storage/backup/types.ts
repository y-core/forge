/** One part of a multipart upload, as R2 answers `uploadPart` and takes it back in `complete`. @public */
export interface BackupUploadedPart {
  readonly partNumber: number;
  readonly etag: string;
}

/** The consumed surface of an R2 multipart upload. @public */
export interface BackupMultipartUpload {
  uploadPart(partNumber: number, value: Uint8Array): Promise<BackupUploadedPart>;
  complete(parts: BackupUploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
}

/** One stored object as R2 answers `get`, its body read once. @public */
export interface BackupStoredObject {
  readonly size: number;
  readonly body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
}

/** One listed object, as R2 answers `list`. @public */
export interface BackupObject {
  readonly key: string;
  readonly size: number;
}

/** One page of an R2 listing. @public */
export interface BackupListing {
  readonly objects: readonly BackupObject[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

/** The consumed surface of the R2 bucket binding the dumps are kept in. @public */
export interface BackupBucket {
  createMultipartUpload(
    key: string,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ): Promise<BackupMultipartUpload>;
  put(
    key: string,
    value: string | Uint8Array | ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string };
      /** The body's length in bytes, which a stream sent over REST needs stated. */
      contentLength?: number;
    },
  ): Promise<unknown>;
  get(key: string): Promise<BackupStoredObject | null>;
  list(options?: { prefix?: string; cursor?: string }): Promise<BackupListing>;
  delete(keys: string | string[]): Promise<void>;
}

/** The consumed surface of the app's D1 binding, read for the census taken before each export. @public */
export interface BackupDatabase {
  prepare(query: string): BackupStatement;
  batch(statements: BackupStatement[]): Promise<unknown>;
}

/** The consumed surface of one prepared D1 statement. @public */
export interface BackupStatement {
  all(): Promise<{ results: Record<string, unknown>[] }>;
  bind(...values: unknown[]): { raw(): Promise<unknown[][]> };
}

/** A Workflow duration such as `10 seconds` or `1 hour`. @public */
export type BackupDuration = `${number} ${"second" | "minute" | "hour" | "day" | "week" | "month" | "year"}${"s" | ""}`;

/** How a step is retried and bounded, in the shape a Workflow step's `config` takes. @public */
export interface BackupStepConfig {
  readonly retries: { readonly limit: number; readonly delay: BackupDuration; readonly backoff: "constant" | "linear" | "exponential" };
  readonly timeout: BackupDuration;
}

/** The consumed surface of a Workflow's `step`: durable, retried, and replayed from its recorded result. @public */
export interface BackupWorkflowStep {
  do<T>(name: string, config: BackupStepConfig, callback: () => Promise<T>): Promise<T>;
}

/** The account and token a run calls Cloudflare's D1 API with. @public */
export interface CloudflareAccess {
  readonly accountId: string;
  /** A token holding `Account → D1 → Edit`, kept as a Worker secret; unused under `forge cf dev`. */
  readonly apiToken: string;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** What `runD1Backup` exports, and where it keeps the dump. @public */
export interface D1BackupOptions extends CloudflareAccess {
  readonly databaseId: string;
  readonly bucket: BackupBucket;
  /** The binding of the database being exported, for its schema digest, migration head and hazards. */
  readonly database: BackupDatabase;
  /** The Workflow event's `timestamp`, so a retried step names the same object. */
  readonly at: Date;
  /** Defaults to `d1-backups`. */
  readonly prefix?: string;
  /** How many dumps of this database to keep, the newest first; omitted keeps every one. */
  readonly keep?: number;
  /** Defaults to 1000; D1 cancels an export that is left unpolled. */
  readonly pollIntervalMs?: number;
  /** How long the download may go without a byte before it fails. Defaults to 60000. */
  readonly idleTimeoutMs?: number;
  /** How long one attempt at exporting and storing may run. Defaults to `1 hour`. */
  readonly timeout?: BackupDuration;
  /** Builds the error that fails the instance without a retry — pass `(message) => new NonRetryableError(message)`. */
  readonly nonRetryable?: (message: string) => Error;
}

/** Where `runD1Restore` imports a dump: a database it creates under `fresh`, or the empty one `standby` names. @public */
export type D1RestoreTarget =
  | { readonly fresh: string }
  | {
      readonly standby: string;
      /** The standby's own binding, which a restore under `forge cf dev` imports through. */
      readonly database?: BackupDatabase;
    };

/** Which dump `runD1Restore` imports, and where. @public */
export interface D1RestoreOptions extends CloudflareAccess {
  readonly bucket: BackupBucket;
  /** The dump's object key, as `listD1Backups` answers it. */
  readonly key: string;
  readonly into: D1RestoreTarget;
  /** Defaults to 1000. */
  readonly pollIntervalMs?: number;
  /** How long the import may run before its step fails. Defaults to `1 hour`. */
  readonly timeout?: BackupDuration;
  /** Builds the error that fails the instance without a retry — pass `(message) => new NonRetryableError(message)`. */
  readonly nonRetryable?: (message: string) => Error;
}

/** The database a restore imported into. @public */
export interface D1RestoredDatabase {
  readonly databaseId: string;
  readonly name: string;
}

/** What a restore imported, and every way the result differs from the dump's sidecar. @public */
export interface D1RestoreReport extends D1RestoredDatabase {
  readonly key: string;
  /** The target's bookmark once the import finished, or `null` where D1 keeps none. */
  readonly bookmark: string | null;
  /** The statement count D1's import answered, reported and never compared. */
  readonly queries: number;
  /** Empty when the restored database matches the sidecar. */
  readonly mismatches: readonly string[];
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

/** One dump kept in the bucket. @public */
export interface D1BackupRecord {
  readonly key: string;
  readonly databaseId: string;
  /** The Time Travel bookmark the dump was taken at. */
  readonly bookmark: string;
  /** ISO 8601, from the Workflow event that started the run. */
  readonly takenAt: string;
  /** In bytes. */
  readonly size: number;
  /** Whether the dump's sidecar was written, which is the last thing a run does before pruning. */
  readonly complete: boolean;
}

/** A value in the database that D1's dumper will not reproduce, or a table whose scan for one failed. @public */
export interface D1BackupHazard {
  readonly table: string;
  readonly column: string | null;
  readonly kind: "escape" | "integer" | "real" | "unscanned";
  readonly count: number;
}

/** What a run measured about the database before its export. @public */
export interface D1BackupCensus {
  /** SHA-256 hex over every schema object D1's dumper writes, sorted by type and name. */
  readonly schemaDigest: string;
  /** The last migration `_forge_migrations` records, or `null` when the table is absent or empty. */
  readonly migrationHead: string | null;
  readonly hazards: readonly D1BackupHazard[];
}

/** The facts kept beside one dump in its `.json` sidecar, which a restore checks itself against. @public */
export interface D1BackupSidecar extends D1BackupCensus {
  readonly key: string;
  readonly databaseId: string;
  readonly bookmark: string;
  readonly takenAt: string;
  /** In bytes. */
  readonly size: number;
  /** Hex, as D1's import takes it for its etag. */
  readonly md5: string;
  readonly sha256: string;
  /** The `INSERT` statements the dump holds per table, counted while it streamed. */
  readonly rows: Readonly<Record<string, number>>;
}

/** Which dumps `listD1Backups` reads. @public */
export interface D1BackupListOptions {
  readonly databaseId: string;
  /** Defaults to `d1-backups`. */
  readonly prefix?: string;
}

/** Why a backup step failed. @public */
export type D1BackupFailureKind =
  | "options"
  | "auth"
  | "not-found"
  | "refused"
  | "malformed"
  | "export"
  | "download"
  | "unsupported"
  | "incomplete"
  | "target"
  | "import";

/** What a dump measured as it streamed. @internal */
export interface DumpMeasure {
  readonly size: number;
  readonly md5: string;
  readonly sha256: string;
  readonly rows: Record<string, number>;
}

/** A dump's chunks as they pass through, and what they measured once every one has. @internal */
export interface DumpMeter {
  readonly chunks: AsyncIterable<Uint8Array>;
  measure(): Promise<DumpMeasure>;
}

/** How a run reaches D1's export and import: over REST for a deployed database, or through bindings under `forge cf dev`. @internal */
export interface D1Transfer {
  readonly credentials: readonly ("accountId" | "apiToken")[];
  startExport(options: D1BackupOptions): Promise<string>;
  openExport(options: D1BackupOptions, bookmark: string): Promise<{ readonly body: ReadableStream<Uint8Array>; readonly length: number | null }>;
  openTarget(options: D1RestoreOptions): Promise<D1RestoredDatabase>;
  startImport(options: D1RestoreOptions, target: D1RestoredDatabase, source: D1ImportSource): Promise<D1ImportState>;
  pollImport(options: D1RestoreOptions, target: D1RestoredDatabase, bookmark: string): Promise<D1ImportState>;
  query(options: D1RestoreOptions, target: D1RestoredDatabase, sql: string): Promise<Record<string, unknown>[]>;
}

/** Which transport a run reaches D1's export by, as both `#relax/d1-transfer` targets answer it. @internal */
export type RelaxD1Transfer = () => D1Transfer;

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
