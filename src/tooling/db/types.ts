import { v } from "../../validation/mod";
import type { WranglerConfig } from "../cf/types";
import type { Colorize } from "../term/types";
import type { ComposeStamp, MigrationOrigin } from "./schema/types";

export type { SchemaObject } from "../../storage/db/types";

/** Where a database lives: the app's own local state, a second local database, the deployed one, or its preview. @public */
export type Place = "local" | "standby" | "remote" | "preview";

/** A database, addressed as `place[:database]`. `database` is null when the caller accepts the config's single entry. @public */
export interface DbTarget {
  readonly place: Place;
  readonly database: string | null;
}

/** The `d1_databases` entry a run acts on, with the migration fields wrangler reads from it. @public */
export interface D1Entry {
  readonly binding: string;
  readonly databaseName: string;
  readonly databaseId: string | null;
  readonly previewDatabaseId: string | null;
  /** Absolute. */
  readonly migrationsDir: string;
  readonly migrationsTable: string;
}

/** Everything a verb needs to know about the app it runs in. @public */
export interface DbConfig {
  /** Absolute application root. */
  readonly root: string;
  /** Absolute path of the wrangler config. */
  readonly configPath: string;
  readonly config: WranglerConfig;
  /** The wrangler environment (`-e`), or null for the top level. */
  readonly env: string | null;
  readonly entry: D1Entry;
  readonly target: DbTarget;
}

/** What one process run produced, with the two streams kept apart so `--json` stays parseable. @public */
export interface Spawned {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The side effects every I/O module reaches the world through, so a test injects a fake. @public */
export interface DbIo {
  spawn(cmd: string, args: readonly string[], opts: { cwd: string }): Spawned;
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  /** Creates the file only when nothing is there, returning false when the path already exists. */
  createExclusive(path: string, text: string): boolean;
  readDir(path: string): string[];
  /** Replaces `to` with `from`, which is what makes a written file appear whole or not at all. */
  rename(from: string, to: string): void;
  mkdir(path: string): void;
  remove(path: string): void;
  /** Modification time in epoch milliseconds, or null when the path is absent. */
  mtime(path: string): number | null;
  now(): Date;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Progress lines, kept off stdout so `--json` output is the only thing there. */
  log(line: string): void;
}

/** A database home: where its config is, and where wrangler keeps its local state. @public */
export interface Home {
  readonly label: string;
  readonly database: string;
  /** Directory `wrangler` runs in; `d1 export` resolves state relative to it. */
  readonly dir: string;
  readonly configPath: string;
  /** Passed as `--persist-to`; null for a remote place. */
  readonly persistTo: string | null;
  readonly place: Place;
  readonly env: string | null;
  /** True when the config was generated for this run and may be deleted after it. */
  readonly synthesized: boolean;
}

/** One migration file, identified by content as well as by name. @public */
export interface Migration {
  /** The file name without `.sql`, which is also the name wrangler records. */
  readonly name: string;
  /** The leading number of `name`, e.g. `1` for `0001_init.sql`. */
  readonly version: number;
  readonly path: string;
  readonly sha256: string;
  readonly sql: string;
  /** Composed from a desired state, or hand-written. */
  readonly origin: MigrationOrigin;
  /** The compose stamp, for a generated migration. */
  readonly stamp: ComposeStamp | null;
}

/** A migration file as read from disk, before it is parsed. @internal */
export interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly sql: string;
}

/** How serious a lint finding is: an `error` aborts an apply, a `warning` aborts a remote apply unless allowed. @public */
export type LintLevel = "error" | "warning";

/** The lint rules, each named so `--no-lint` output and the docs can refer to one. @public */
export type LintRule =
  | "drop-no-if-exists"
  | "unbounded-update"
  | "unbounded-delete"
  | "virtual-table"
  | "autoincrement"
  | "explicit-transaction"
  | "attach-database"
  | "add-column-not-null-no-default"
  | "add-column-non-constant-default"
  | "add-column-constrained"
  | "alter-column-unsupported"
  | "drop-column"
  | "rename"
  | "unique-index-on-existing-table"
  | "table-rebuild"
  | "pragma-ignored"
  | "generated-edited"
  | "custom-ddl"
  | "seed-insert-not-idempotent";

/** One statement as the linter sees it: masked for matching, raw for a name, and where it starts. @internal */
export interface SqlStatement {
  readonly masked: string;
  readonly raw: string;
  readonly offset: number;
}

/** One thing the linter has to say about a migration. @public */
export interface LintFinding {
  readonly rule: LintRule;
  readonly level: LintLevel;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Which migrations an apply would run, and what it found that it cannot reconcile. @public */
export interface ApplyPlan {
  readonly pending: readonly Migration[];
  /** Past the `--to` cut, so left for a later run. */
  readonly skipped: readonly Migration[];
  /** Applied on the database and absent from disk. */
  readonly drift: readonly string[];
}

/** One `forge_migrations` row. @internal */
export interface RecordedChecksum {
  readonly appliedName: string;
  readonly sha256: string;
}

/** Where recorded checksums and the files on disk disagree. @internal */
export interface ChecksumComparison {
  /** Applied and recorded, but the file now hashes differently. */
  readonly mismatched: readonly string[];
  /** Applied per the migrations table, but never recorded — applied by wrangler directly. */
  readonly unrecorded: readonly string[];
  /** Recorded, but no longer in the migrations table. */
  readonly orphaned: readonly string[];
}

/** One `pragma_table_info` row. @internal */
export interface ColumnInfo {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dfltValue: string | null;
  readonly pk: number;
}

/** Who owns a table: the app, the toolchain, or the engine. @internal */
export type TableClass = "app" | "managed" | "system";

/** One line of `db migrate status`. @internal */
export interface StatusRow {
  readonly name: string;
  readonly state: "applied" | "pending" | "mismatch" | "unrecorded" | "drift";
  readonly appliedAt: string | null;
}

/** What `db migrate status` measured, from which the exit code is derived. @internal */
export interface StatusReport {
  readonly target: string;
  readonly database: string;
  readonly rows: readonly StatusRow[];
  readonly pending: number;
  readonly checksums: ChecksumComparison;
  readonly drift: readonly string[];
  readonly fingerprint: { readonly recorded: string | null; readonly actual: string; readonly matches: boolean };
  readonly digest: { readonly recorded: string | null; readonly onDisk: string };
}

/** One seed file: the directory it was declared under and its name are its identity, its hash is what decides whether it re-runs. @public */
export interface Seed {
  /** The seeds directory that declared it, as `config/db.ts` wrote it. */
  readonly source: string;
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  /** The SQL as written; `${VAR}` is expanded by `seed apply` alone, so status and lint need no environment. */
  readonly sql: string;
  /** The places `-- forge:places` on line 1 restricts it to, or null when it runs everywhere. */
  readonly places: readonly Place[] | null;
}

/** A seed file as read from disk, before it is parsed. @internal */
export interface SeedFile {
  readonly name: string;
  readonly path: string;
  readonly sql: string;
}

/** One `forge_seed_history` row. @internal */
export interface SeedRecord {
  readonly source: string;
  readonly name: string;
  readonly sha256: string;
  readonly appliedAt: number;
}

/** Which seeds run, which are already in, and which changed since they ran. @public */
export interface SeedPlan {
  readonly apply: readonly Seed[];
  readonly skip: readonly Seed[];
  readonly changed: readonly Seed[];
  /** Left out of a deployed run for want of a `-- forge:places` line. */
  readonly excluded: readonly Seed[];
}

/** What one `db seed apply` run did, by seed name. @public */
export interface SeedOutcome {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  /** Recorded with a different hash; run only when `--rerun` said so. */
  readonly changed: readonly string[];
  /** Left out of a deployed run for want of a `-- forge:places` line. */
  readonly excluded: readonly string[];
  /** The Time Travel bookmark a deployed run captured as its undo. */
  readonly bookmark?: Bookmark;
}

/** A position the host config declares: where it is, and the text it was declared as — which is what a message names and a record keys on. @internal */
export interface DeclaredPath {
  /** Absolute. */
  readonly path: string;
  /** Relative to the root, exactly as `config/db.ts` wrote it. */
  readonly declared: string;
}

/** The `config/db.ts` default export: every position `forge db` reads, each named on purpose. @public */
export interface DbHostConfig {
  /** Every desired-state file or directory the app composes from, in load order — its own and each library's. Nothing is read that is not named here. */
  readonly schemas?: readonly string[];
  /** Every seeds directory, in run order. */
  readonly seeds?: readonly string[];
  /** Where the composed snapshot lives. Defaults to `schema.snapshot.json` beside the migrations directory. */
  readonly snapshot?: string;
  /** Where backups go, relative to the root. Defaults to `.forge/backups`. */
  readonly backupsDir?: string;
}

/** The shape `config/db.ts` must export, held at the boundary so a misspelt key or a bare string is refused by name. @internal */
export const DbHostConfigSchema = v.strictObject({
  schemas: v.optional(v.array(v.string())),
  seeds: v.optional(v.array(v.string())),
  snapshot: v.optional(v.string()),
  backupsDir: v.optional(v.string()),
});

/** The fields of one `d1_databases` entry `forge db` reads, held to their types before any is trusted. @internal */
export const D1EntrySchema = v.looseObject({
  binding: v.string(),
  database_name: v.optional(v.string()),
  database_id: v.optional(v.string()),
  preview_database_id: v.optional(v.string()),
  migrations_dir: v.optional(v.string()),
  migrations_table: v.optional(v.string()),
});

/** One backup artifact directory's `manifest.json`. @public */
export interface BackupManifest {
  readonly formatVersion: number;
  readonly createdAt: string;
  readonly label: string | null;
  readonly dumper: { readonly tool: string; readonly version: string };
  readonly database: { readonly name: string; readonly id: string | null; readonly target: string; readonly persistPath: string | null };
  readonly schema: SchemaFacts;
  /** Every migration the artifact was taken with, whose SQL it embeds under `migrations/`. */
  readonly migrations: readonly { readonly name: string; readonly sha256: string }[];
  readonly tables: readonly { readonly name: string; readonly rows: number; readonly digest: string }[];
  readonly artifacts: readonly { readonly file: string; readonly bytes: number; readonly sha256: string }[];
  readonly warnings: readonly string[];
  readonly verified: readonly { readonly route: string; readonly divergent: number }[];
  /** This manifest's own digest, which detects truncation, a swapped file and bit rot — and no tampering. */
  readonly selfDigest: string;
}

/** The three facts that bind an artifact to a schema, each catching what the other two cannot. @public */
export interface SchemaFacts {
  readonly migrations: readonly string[];
  /** SHA-256 over the app's own objects — the managed tables are created rather than restored, so they are not in it. */
  readonly digest: string;
  readonly migrationsDigest: string;
}

/** `full` loads a whole database; `migrations` applies the migrations dir and then loads data into it. @public */
export type RestoreRoute = "full" | "migrations";

/** The flags every `forge db` verb shares, which a caller of `resolveDbContext` names. @public */
export interface SharedDbFlags {
  target: string;
  db: string | undefined;
  config: string;
  env: string | undefined;
  root: string | undefined;
  json: boolean;
  yes: boolean;
}

/** What `resolveDbConfig` reads from the shared flags. @internal */
export interface DbConfigRequest {
  root: string;
  /** Wrangler config path, absolute or relative to `root`. */
  config: string;
  /** Binding or database name; required only when the config declares more than one. */
  db?: string | undefined;
  env?: string | undefined;
  target: string;
}

/** What a generated config needs to point wrangler at the same database from another directory. @internal */
export interface SynthesizeOptions {
  label: string;
  database: string;
  /** Where the config is written. Local state lives under it unless `persistTo` says otherwise. */
  dir: string;
  /** The migrations wrangler applies from this home; absolute. */
  migrationsDir: string;
  /** Overrides the state directory, so a `--to` cut applies into the real database. */
  persistTo?: string | undefined;
}

/** The undo a remote apply is given before it runs. @public */
export interface Bookmark {
  readonly bookmark: string;
  /** The command that restores the database to this point. */
  readonly restoreCommand: string;
}

/** What a verb runs with: the resolved config and home, the I/O port, and how to print. @public */
export interface DbRunContext {
  config: DbConfig;
  home: Home;
  io: DbIo;
  host: DbHostConfig;
  json: boolean;
  yes: boolean;
  style: Colorize;
  print: (line: string) => void;
}

/** Test seam: the I/O and host config a run uses when the caller supplies them. @internal */
export interface DbContextOverrides {
  io?: DbIo;
  host?: DbHostConfig;
}

/** One canned wrangler answer, matched against argv. @internal */
export interface FakeWranglerRule {
  match: (args: readonly string[]) => boolean;
  reply: Spawned | ((args: readonly string[]) => Spawned);
}

/** An in-memory `DbIo`: a map for the filesystem, a rule table for wrangler, and every call recorded. @internal */
export interface FakeDbIo extends DbIo {
  files: Map<string, string>;
  calls: string[][];
  logs: string[];
  rules: FakeWranglerRule[];
}
