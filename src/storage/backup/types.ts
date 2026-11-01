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
  list(options?: { prefix?: string; cursor?: string }): Promise<BackupListing>;
  delete(keys: string | string[]): Promise<void>;
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

/** What `runD1Backup` exports, and where it keeps the dump. @public */
export interface D1BackupOptions {
  readonly accountId: string;
  readonly databaseId: string;
  /** A token holding `Account → D1 → Edit`, kept as a Worker secret. */
  readonly apiToken: string;
  readonly bucket: BackupBucket;
  /** The Workflow event's `timestamp`, so a retried step names the same object. */
  readonly at: Date;
  /** Defaults to `d1-backups`. */
  readonly prefix?: string;
  /** How many dumps of this database to keep, the newest first; omitted keeps every one. */
  readonly keep?: number;
  /** Defaults to 1000; D1 cancels an export that is left unpolled. */
  readonly pollIntervalMs?: number;
  /** How long one attempt at exporting and storing may run. Defaults to `1 hour`. */
  readonly timeout?: BackupDuration;
  /** Builds the error that fails the instance without a retry — pass `(message) => new NonRetryableError(message)`. */
  readonly nonRetryable?: (message: string) => Error;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

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
}

/** Which dumps `listD1Backups` reads. @public */
export interface D1BackupListOptions {
  readonly databaseId: string;
  /** Defaults to `d1-backups`. */
  readonly prefix?: string;
}

/** Why a backup step failed. @public */
export type D1BackupFailureKind = "options" | "auth" | "not-found" | "refused" | "malformed" | "export" | "download";

/** Where a D1 export stands: still running at a bookmark, ready behind a signed URL, or refused. @internal */
export type D1ExportState =
  | { readonly status: "active"; readonly bookmark: string }
  | { readonly status: "complete"; readonly bookmark: string | null; readonly signedUrl: string }
  | { readonly status: "error"; readonly error: string };
