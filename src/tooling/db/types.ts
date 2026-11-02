import type { getPlatformProxy } from "wrangler";

import type { BackupBucket } from "../../storage/backup/types";
import type { SchemaHealthState } from "../../storage/db/types";
import { v } from "../../validation/mod";
import type { CfAuth, WranglerConfig } from "../cf/types";
import type { Colorize } from "../term/types";
import type { ComposeStamp } from "./schema/types";

export type { SchemaHealthState, SchemaObject } from "../../storage/db/types";

/** Where a database lives: the app's own local state, a second local database, the deployed one, or its preview. @public */
export type Place = "local" | "standby" | "remote" | "preview";

/** A database, addressed as `place[:database]`, whose `database` is null when the caller accepts the config's single entry. @public */
export interface DbTarget {
  readonly place: Place;
  readonly database: string | null;
}

/** The `d1_databases` entry a run acts on. @public */
export interface D1Entry {
  readonly binding: string;
  readonly databaseName: string;
  readonly databaseId: string | null;
  readonly previewDatabaseId: string | null;
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

/** The side effects every I/O module reaches the world through, so a test injects a fake. @public */
export interface DbIo {
  /** Statements against a local home's own state, in one transaction, each answered with its own rows. */
  d1(home: Home, sql: readonly string[]): Promise<Record<string, unknown>[][]>;
  /** The statements `sql` is cut into for a local home — the cut `d1` makes before it runs them. */
  splitD1(home: Home, sql: string): Promise<string[]>;
  /** The R2 bucket a local home's config binds as `binding`, read through the same handle as its D1 state. */
  bucket(home: Home, binding: string): Promise<BackupBucket>;
  /** Releases the handle over `home`'s state — which anything about to delete that state must do first — or every handle when `home` is null. */
  closeD1(home: Home | null): Promise<void>;
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  /** The file's bytes as they are read, never held whole. */
  readStream(path: string): ReadableStream<Uint8Array>;
  /** Writes `body` to the file as it arrives, owner-only, replacing whatever was there, and cancels `body` when the file cannot be opened. */
  writeStream(path: string, body: ReadableStream<Uint8Array>): Promise<void>;
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
  /** Waits `ms` on the clock `now` reads — a poll's delay and a retry's backoff both wait here. */
  sleep(ms: number): Promise<void>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** HTTPS to Cloudflare: the D1 REST API and an export's signed download. */
  fetch: typeof globalThis.fetch;
  /** The installed wrangler's version, whose in-process D1 every local read goes through, or `unknown`. */
  wranglerVersion(): string;
  /** Progress lines, kept off stdout so `--json` output is the only thing there. */
  log(line: string): void;
}

/** The wrangler export a local D1 handle opens through, absent from a wrangler too old to carry it. @internal */
export type WranglerD1Module = { readonly getPlatformProxy?: typeof getPlatformProxy };

/** A database home: where its config is, and where wrangler keeps its local state. @public */
export interface Home {
  readonly label: string;
  readonly database: string;
  /** The `d1_databases` binding the database is reached through in-process. */
  readonly binding: string;
  /** The config's directory, which holds the apply lock and, by default, the local state. */
  readonly dir: string;
  readonly configPath: string;
  /** Passed as `--persist-to`; null for a remote place. */
  readonly persistTo: string | null;
  readonly place: Place;
  readonly env: string | null;
  /** The UUID the D1 REST API addresses a deployed place by; null off Cloudflare. */
  readonly databaseId: string | null;
  /** What the D1 REST API is called with, from `--account-id` and `--api-token`; null off Cloudflare. */
  readonly auth: CfAuth | null;
  /** True when the config was generated for this run and may be deleted after it. */
  readonly synthesized: boolean;
}

/** One body of SQL and the statement that records it, staged as a single file so a local load commits both or neither. @internal */
export interface RecordedUnit {
  /** The directory under `.forge/scratch/` the file is staged in. */
  readonly label: string;
  readonly name: string;
  readonly sql: string;
  /** The statement that records the unit, or null when the caller records nothing. */
  readonly record: string | null;
  /** Removes the staged file afterwards, which text carrying expanded environment values needs. */
  readonly remove: boolean;
}

/** One migration file, identified by content as well as by name. @public */
export interface Migration {
  /** The file name without `.sql`, which is also the name recorded in `_forge_migrations`. */
  readonly name: string;
  /** The leading number of `name`, e.g. `1` for `0001_init.sql`. */
  readonly version: number;
  readonly path: string;
  readonly sha256: string;
  readonly sql: string;
  /** The compose stamp, or null when the file carries none — which every verb refuses while it is pending. */
  readonly stamp: ComposeStamp | null;
}

/** A migration file as read from disk, before it is parsed. @internal */
export interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly sql: string;
}

/** The lint rules, each named so a finding and the docs can refer to one. @public */
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
  | "pragma-unsupported"
  | "table-too-wide"
  | "generated-edited"
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

/** One `_forge_migrations` row. @internal */
export interface RecordedChecksum {
  readonly appliedName: string;
  readonly sha256: string;
  /** Epoch milliseconds. */
  readonly appliedAt: number;
  /** The schema this migration left behind, or null when no apply certified one. */
  readonly fingerprint: string | null;
}

/** How the schema stands against the fingerprint the last apply certified. @public */
export interface SchemaDrift {
  readonly state: SchemaHealthState;
  /** The certified fingerprint, or null when no applied migration ever carried one. */
  readonly recorded: string | null;
  readonly actual: string;
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

/** The affinity SQLite gives a column, by its declared-type rules. @internal */
export type SqlAffinity = "INTEGER" | "TEXT" | "BLOB" | "REAL" | "NUMERIC";

/** Who owns a table: the app, the toolchain, or the engine. @internal */
export type TableClass = "app" | "managed" | "system";

/** One line of `db migrate status`. @internal */
export interface StatusRow {
  readonly name: string;
  readonly state: "applied" | "pending" | "mismatch" | "drift";
  readonly appliedAt: string | null;
}

/** The entry's wrangler history table, and the migrations it records that forge never applied. @internal */
export interface WranglerHistory {
  readonly table: string;
  readonly unapplied: readonly string[];
}

/** What `db migrate status` measured, from which the exit code is derived. @internal */
export interface StatusReport {
  readonly target: string;
  readonly database: string;
  readonly rows: readonly StatusRow[];
  readonly pending: number;
  readonly checksums: { readonly mismatched: readonly string[] };
  readonly drift: readonly string[];
  readonly fingerprint: { readonly recorded: string | null; readonly actual: string; readonly matches: boolean };
  readonly wranglerHistory: WranglerHistory;
}

/** One seed file: the directory it was declared under and its name are its identity, its hash is what decides whether it re-runs. @public */
export interface Seed {
  /** The seeds directory that declared it, as `config/db.config.ts` wrote it. */
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

/** One `_forge_seed_history` row. @internal */
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

/** What one `forge db standby reset` run was asked to do. @public */
export interface StandbyResetOptions {
  /** Seed just this directory, instead of every one `config/db.config.ts` names. */
  readonly dir?: string | undefined;
  readonly seed: boolean;
}

/** What one `forge db standby reset` run rebuilt, by migration and seed name. @public */
export interface StandbyResetOutcome {
  readonly database: string;
  readonly applied: readonly string[];
  readonly seeded: readonly string[];
  /** Left out for want of a `-- forge:places standby` line. */
  readonly excluded: readonly string[];
}

/** What `composeSeedFixture` writes: where the file goes, the tables in load order, and the rows each holds. @public */
export interface SeedFixtureOptions {
  /** The file to write, under a seeds directory `config/db.config.ts` declares. */
  readonly path: string;
  /** The tables to emit, in load order, so a foreign key points at a row already in. */
  readonly tables: readonly string[];
  readonly rows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** The `-- forge:places` line's places; absent writes no line, so the seed runs everywhere. */
  readonly places?: readonly Place[];
}

/** What one composed fixture holds, and what the schema no longer declares of it. @public */
export interface SeedFixtureOutcome {
  readonly path: string;
  readonly sha256: string;
  readonly sql: string;
  /** Per table, in the order they were emitted; `dropped` names authored keys the schema no longer declares. */
  readonly tables: readonly { readonly name: string; readonly rows: number; readonly dropped: readonly string[] }[];
}

/** A position the host config declares: where it is, and the text it was declared as — which is what a message names and a record keys on. @internal */
export interface DeclaredPath {
  /** Absolute. */
  readonly path: string;
  /** Relative to the root, exactly as `config/db.config.ts` wrote it. */
  readonly declared: string;
}

/** A schema forge ships, which `forgeSchema` names for `DbHostConfig.schemas`. @public */
export type ForgeSchemaName = "auth";

/** The `config/db.config.ts` default export: every position `forge db` reads, each named on purpose. @public */
export interface DbHostConfig {
  /** Every desired-state file or directory the app composes from, its own and each library's, in load order and with nothing read beyond them. */
  readonly schemas?: readonly string[];
  /** Every seeds directory, in run order. */
  readonly seeds?: readonly string[];
  /** Where the migrations live, relative to the root. Defaults to `config/db/migrations`. */
  readonly migrations?: string;
  /** Where the composed snapshot lives. Defaults to `config/db/schema.snapshot.json` under the root. */
  readonly snapshot?: string;
}

/** The shape `config/db.config.ts` must export, held at the boundary so a misspelt key or a bare string is refused by name. @internal */
export const DbHostConfigSchema = v.strictObject({
  schemas: v.optional(v.array(v.string())),
  seeds: v.optional(v.array(v.string())),
  migrations: v.optional(v.string()),
  snapshot: v.optional(v.string()),
});

/** How a sent Time Travel restore ended short of a refusal: D1's reply, a reply that could not be read, or a fate the transport lost. @internal */
export type D1RestoreAnswer =
  | { readonly kind: "restored"; readonly previousBookmark: string | null }
  | { readonly kind: "unreadable" }
  | { readonly kind: "unknown"; readonly reason: string };

/** The flags every `forge db` verb shares, which a caller of `resolveDbContext` names. @public */
export interface SharedDbFlags {
  target: string;
  db: string | undefined;
  config: string;
  env: string | undefined;
  root: string | undefined;
  json: boolean;
  yes: boolean;
  "account-id"?: string | undefined;
  "api-token"?: string | undefined;
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
  /** Where the config is written, with local state under it unless `persistTo` says otherwise. */
  dir: string;
  /** Overrides the state directory, so a `--to` cut applies into the real database. */
  persistTo?: string | undefined;
}

/** The undo a remote apply is given before it runs. @public */
export interface Bookmark {
  readonly bookmark: string;
  /** The command that restores the database to this point. */
  readonly restoreCommand: string;
}

/** The undo a Time Travel restore answers, and which reading of D1 its bookmark came from. @public */
export interface BookmarkUndo extends Bookmark {
  /** `restore` when D1's reply named the point it left; `pre-read` when it was read before the restore, and misses any write landing in between. */
  readonly from: "restore" | "pre-read";
  /** False when D1 accepted the restore but answered with a reply forge could not read. */
  readonly replyReadable: boolean;
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

/** One group of statements the run put to a local database, and where they came from. @internal */
export interface FakeD1Call {
  readonly home: string;
  readonly place: Place;
  /** `persistRoot(home)`, so the recorder carries the `v3` segment. */
  readonly persistTo: string;
  readonly statements: readonly string[];
  /** The file, when the statements came from one. */
  readonly source: string | null;
}

/** One canned answer to an in-process statement, matched against its text and the home it was put to. @internal */
export interface FakeD1Rule {
  match: (statement: string, home: Home) => boolean;
  reply: Record<string, unknown>[] | ((statement: string, home: Home) => Record<string, unknown>[]);
}

/** One canned Cloudflare answer, matched against the request. @internal */
export interface FakeRestRule {
  match: (url: string, init: RequestInit | undefined) => boolean;
  reply: Response | ((url: string, init: RequestInit | undefined) => Response | Promise<Response>);
}

/** One request the run sent through `DbIo.fetch`. @internal */
export interface FakeRestCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The request body as sent, or null when there was none. */
  readonly body: string | null;
}

/** An in-memory `DbIo`: a map for the filesystem, a rule table for each effect, and every call recorded. @internal */
export interface FakeDbIo extends DbIo {
  files: Map<string, string>;
  logs: string[];
  d1Calls: FakeD1Call[];
  d1Rules: FakeD1Rule[];
  restRules: FakeRestRule[];
  /** The local R2 buckets `bucket` answers, by binding. */
  readonly buckets: Map<string, BackupBucket>;
  restCalls: FakeRestCall[];
  /** Persist paths in close order, which is what pins the obligation to close before a delete. */
  closed: string[];
  /** Every wait `sleep` was asked for, in order; each one advances `now` by as much. */
  slept: number[];
}

/** A Workflow instance's state as the CLI reads it back, from either route. @internal */
export interface WorkflowInstanceState {
  readonly status: string;
  readonly output: unknown;
  readonly error: string | null;
}

/** Where `forge db backup` starts and reads a Workflow instance: the Cloudflare API, or a local dev session. @internal */
export interface WorkflowRoute {
  readonly where: string;
  create(workflow: string, params: unknown): Promise<string>;
  read(workflow: string, id: string): Promise<WorkflowInstanceState>;
}
