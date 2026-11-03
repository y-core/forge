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

/** One dump kept in the bucket. @public */
export interface D1BackupRecord {
  readonly key: string;
  readonly databaseId: string;
  /** The Time Travel bookmark the dump was taken at. */
  readonly bookmark: string;
  /** ISO 8601, the instant the backup ran. */
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

/** Why a backup reader refused an object. @public */
export type D1BackupFailureKind = "malformed";
