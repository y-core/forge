import type { SchemaRename } from "../schema/types";
import type { Bookmark, LintFinding, Migration, RecordedChecksum, SchemaObject } from "../types";

/** What `planApply` compares: the merged migration set, the names the migrations table holds, and an optional cut. @internal */
export interface ApplyPlanRequest {
  discovered: readonly Migration[];
  /** The names forge recorded as applied. */
  applied: readonly string[];
  /** A version number or a migration name: nothing ordered after it is applied. */
  to?: string | undefined;
}

/** What one applied migration's history row says. @internal */
export interface AppliedMigration {
  readonly name: string;
  readonly appliedAt: string | null;
}

/** What `statusRows` reads: the files on disk, the history rows, and the names whose checksums disagree. @internal */
export interface StatusRowsRequest {
  discovered: readonly Migration[];
  applied: readonly AppliedMigration[];
  mismatched: readonly string[];
}

/** What one `forge db migrate` run was asked to do. @public */
export interface MigrateOptions {
  dryRun: boolean;
  /** `NNNN` or a full migration name: nothing numbered above it is applied. */
  to?: string | undefined;
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
  readonly bookmark?: Bookmark;
  /** What the rehearsal proved, when one was asked for. */
  readonly rehearsed?: RehearsalOutcome;
  readonly dryRun: boolean;
}

/** What the target database records about itself: forge's history rows, and the live inventory. @internal */
export interface TargetFacts {
  readonly recorded: readonly RecordedChecksum[];
  readonly inventory: readonly SchemaObject[];
}

/** An object a migration drops, named as it stood before the migration. @internal */
export type DroppedObject =
  | { readonly type: "table"; readonly name: string }
  | { readonly type: "column"; readonly table: string; readonly name: string }
  | { readonly type: "view"; readonly name: string };

/** A drop or a rename, in the terms of the forge:drops or forge:renames line that would approve it. @internal */
export type MigrationChange =
  | { readonly action: "drops"; readonly object: DroppedObject }
  | { readonly action: "renames"; readonly rename: SchemaRename };

/** One drop or rename a pending migration makes to the target's schema, as DATABASE_MANAGEMENT.md §9b counts it. @internal */
export interface MigrationFinding {
  /** The file's name without `.sql`, as `_forge_migrations` records it. */
  readonly migration: string;
  /** `destructive` loses rows; `incompatible` loses none and breaks what the previous Worker reads. */
  readonly severity: "destructive" | "incompatible";
  readonly change: MigrationChange;
}

/** What `forge db lint` found in the migrations the target does not hold yet. @internal */
export interface PendingLintOutcome {
  readonly pending: readonly string[];
  readonly findings: readonly LintFinding[];
  /** The analysis findings, each approved by its file's own line. */
  readonly approved: readonly MigrationFinding[];
}
