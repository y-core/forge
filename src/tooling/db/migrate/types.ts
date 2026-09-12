import type { Bookmark, ChecksumComparison, Migration, RecordedChecksum, SchemaObject } from "../types";

/** What `planApply` compares: the merged migration set, the names the migrations table holds, and an optional cut. @internal */
export interface ApplyPlanRequest {
  discovered: readonly Migration[];
  /** Applied names recorded in the migrations table, as wrangler writes them. */
  applied: readonly string[];
  /** A version number or a migration name: nothing ordered after it is applied. */
  to?: string | undefined;
}

/** What one applied migration's row in the migrations table says. @internal */
export interface AppliedMigration {
  readonly name: string;
  readonly appliedAt: string | null;
}

/** What `statusRows` reads: the files on disk, the migrations table, and where their checksums disagree. @internal */
export interface StatusRowsRequest {
  discovered: readonly Migration[];
  applied: readonly AppliedMigration[];
  checksums: ChecksumComparison;
}

/** What one `forge db migrate` run was asked to do. @public */
export interface MigrateOptions {
  dryRun: boolean;
  /** `NNNN` or a full migration name: nothing numbered above it is applied. */
  to?: string | undefined;
  lint: boolean;
  /** Let a lint warning through on a deployed database, where it would otherwise abort. */
  allowWarnings: boolean;
  /** Apply although the schema fingerprint moved since the last apply recorded it. */
  allowDrift: boolean;
  bookmark: boolean;
  /** Apply the pending migrations to a copy restored from a backup artifact first, and report before touching the target. */
  rehearse: boolean;
  /** The artifact a rehearsal restores; absent takes the most recent verified backup of this database. */
  artifact?: string | undefined;
}

/** What one rehearsal proved: the artifact it restored, the rows it held, and the migrations that applied to them. @public */
export interface RehearsalOutcome {
  readonly artifact: string;
  readonly rows: number;
  readonly applied: readonly string[];
}

/** What one `forge db migrate` run did. @public */
export interface MigrateOutcome {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  /** Applied before without a forge checksum, and recorded from the file by this run. */
  readonly repaired: readonly string[];
  readonly bookmark?: Bookmark;
  /** What the rehearsal proved, when one was asked for. */
  readonly rehearsed?: RehearsalOutcome;
  readonly dryRun: boolean;
}

/** What the target database records about itself: forge's checksums, its schema facts, and the live inventory. @internal */
export interface TargetFacts {
  readonly recorded: readonly RecordedChecksum[];
  readonly meta: Readonly<Record<string, string>>;
  readonly inventory: readonly SchemaObject[];
}

/** Which applied migrations a run can record from their files, and which have no file and stay drift. @public */
export interface RepairPlan {
  readonly recordable: readonly Migration[];
}
