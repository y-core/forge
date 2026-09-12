import type { DeclaredPath, Migration } from "../types";

/** What one piece of SQL text is: prose, a literal, a name, a word, or punctuation. @internal */
export type SqlTokenKind = "space" | "comment" | "string" | "identifier" | "word" | "punct";

/** One token of SQL text, with the offsets it was cut from. @internal */
export interface SqlToken {
  readonly kind: SqlTokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Which double-quoted tokens stay as written: every one, or those in a DEFAULT or CHECK that name none of the given columns. @internal */
export type SqlLiteralRule = "verbatim" | ReadonlySet<string>;

/** One clause of a `CREATE TABLE` body: a column or a table constraint, in the three forms the engine reads. @internal */
export interface TableBodyClause {
  readonly kind: "column" | "constraint";
  readonly raw: string;
  readonly source: string;
  readonly normalized: string;
}

/** The parts of a `CREATE TABLE` statement: what precedes the body, its clauses, and the options after it. @internal */
export interface CreateTableParts {
  /** Offset of the `(` that opens the body. */
  readonly open: number;
  /** Offset of the `)` that closes it. */
  readonly close: number;
  readonly clauses: readonly TableBodyClause[];
  /** The text after the body, normalized: `STRICT`, `WITHOUT ROWID`, both or neither. */
  readonly options: string;
}

/** What one declared schema brings to the ownership decision: the names it declares. @internal */
export interface OwnershipClaim {
  /** The file, as `config/db.ts` declared it. */
  readonly source: string;
  /** Names declared in the file, or null when the path holds nothing. */
  readonly declared: readonly { readonly type: string; readonly name: string }[] | null;
}

/** One column as `pragma_table_xinfo` and the `CREATE TABLE` body together describe it. @internal */
export interface SchemaColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: boolean;
  readonly defaultExpr: string | null;
  /** Position in the primary key, 1-based; 0 when the column is not part of it. */
  readonly pk: number;
  /** 0 for an ordinary column, 2 for a VIRTUAL generated column, 3 for a STORED one. */
  readonly hidden: number;
  /** The column clause, normalized, which is what two columns are compared by. */
  readonly definition: string;
  /** The column clause with comments removed and whitespace collapsed, which is what `ADD COLUMN` emits. */
  readonly definitionSource: string;
}

/** One `pragma_foreign_key_list` constraint, with its columns gathered. @internal */
export interface SchemaForeignKey {
  readonly table: string;
  readonly from: readonly string[];
  readonly to: readonly (string | null)[];
  readonly onUpdate: string;
  readonly onDelete: string;
}

/** One table: its columns in order, its table-level constraints, its options, and its verbatim DDL. @internal */
export interface SchemaTable {
  readonly name: string;
  readonly columns: readonly SchemaColumn[];
  /** Table-level constraint clauses, normalized and sorted, compared as a set. */
  readonly constraints: readonly string[];
  readonly strict: boolean;
  readonly withoutRowid: boolean;
  readonly foreignKeys: readonly SchemaForeignKey[];
  /** `sqlite_master.sql`, verbatim. */
  readonly sql: string;
}

/** One named index, with the columns it covers. @internal */
export interface SchemaIndex {
  readonly name: string;
  readonly table: string;
  readonly unique: boolean;
  readonly partial: boolean;
  readonly columns: readonly string[];
  readonly sql: string;
  readonly normalized: string;
}

/** One trigger. @internal */
export interface SchemaTrigger {
  readonly name: string;
  readonly table: string;
  readonly sql: string;
  readonly normalized: string;
}

/** One view. @internal */
export interface SchemaView {
  readonly name: string;
  readonly sql: string;
  readonly normalized: string;
}

/** Everything a database declares that the app owns, read from a real SQLite through wrangler. @internal */
export interface SchemaModel {
  readonly tables: readonly SchemaTable[];
  readonly indexes: readonly SchemaIndex[];
  readonly triggers: readonly SchemaTrigger[];
  readonly views: readonly SchemaView[];
}

/** Bumped when the model's shape or normalization changes, so a cached model is rebuilt rather than misread. @internal */
export const SCHEMA_MODEL_VERSION = 3;

/** One `--rename`: a table, or a column of one. @internal */
export type SchemaRename =
  | { readonly kind: "table"; readonly from: string; readonly to: string }
  | { readonly kind: "column"; readonly table: string; readonly from: string; readonly to: string };

/** Why a table has to be rebuilt rather than altered in place. @internal */
export type RebuildReason =
  | "column-changed"
  | "reordered"
  | "constraints-changed"
  | "options-changed"
  | "add-column-unsupported"
  | "drop-column-unsupported";

/** What one table needs: creating, dropping, altering in place, or rebuilding through a copy. @internal */
export type TableChange =
  | { readonly kind: "create"; readonly name: string }
  | { readonly kind: "drop"; readonly name: string }
  | { readonly kind: "alter"; readonly name: string; readonly added: readonly SchemaColumn[]; readonly dropped: readonly string[] }
  | { readonly kind: "rebuild"; readonly name: string; readonly reasons: readonly RebuildReason[]; readonly dropped: readonly string[] };

/** Named objects that are new, gone, or whose DDL changed. @internal */
export interface NamedChanges {
  readonly created: readonly string[];
  readonly dropped: readonly string[];
  readonly changed: readonly string[];
}

/** Everything that separates a baseline model from a desired one. @internal */
export interface SchemaDiff {
  readonly tables: readonly TableChange[];
  readonly indexes: NamedChanges;
  readonly triggers: NamedChanges;
  readonly views: NamedChanges;
  /** Each thing the migration would discard, one line per table or column. */
  readonly destructive: readonly string[];
  /** Each thing no migration can express, with the remedy. Non-empty means nothing may be emitted. */
  readonly refusals: readonly string[];
  /** Each rebuild step whose success depends on the rows already there; advisory. */
  readonly dataDependent: readonly string[];
  /** Baseline tables whose FOREIGN KEY points at a dropped table; each is rebuilt before the drop, so no ON DELETE action fires into it. */
  readonly dropDependents: readonly string[];
}

/** Which scratch database a step uses: the replayed migrations, or the desired files loaded fresh. @internal */
export type ScratchSide = "baseline" | "desired";

/** Everything the schema verbs read from disk before any database is touched. @internal */
export interface SchemaInputs {
  readonly migrations: readonly Migration[];
  /** Every position `config/db.ts` names, in load order. */
  readonly schemas: readonly DeclaredPath[];
  /** Each declared schema that is on disk, in the same order. */
  readonly states: readonly DesiredState[];
  readonly snapshotPath: string;
  readonly snapshot: SchemaSnapshot | null;
  readonly claims: readonly OwnershipClaim[];
}

/** One declared schema's DDL as read from disk. @internal */
export interface DesiredState {
  /** The file, as `config/db.ts` declared it. */
  readonly source: string;
  /** The declared file or directory, absolute. */
  readonly path: string;
  /** Every `.sql` file that contributed, in the order they were concatenated. */
  readonly files: readonly string[];
  readonly text: string;
  readonly digest: string;
}

/** `schema.snapshot.json`: what the last compose or snapshot saw, which is what the deletion rule and `--check` read. @internal */
export interface SchemaSnapshot {
  readonly version: number;
  /** Every declared schema it was written from, keyed as `config/db.ts` declared it. */
  readonly desired: Readonly<Record<string, string>>;
  /** Digest over the migrations as they stood after the compose. */
  readonly migrationsDigest: string;
}

/** The `-- forge:compose` line a generated migration carries. @public */
export interface ComposeStamp {
  /** The digest of every declared schema the compose read, keyed as `config/db.ts` declared it. */
  readonly desired: Readonly<Record<string, string>>;
  readonly baseline: string;
  readonly body: string;
  readonly forge: string;
}

/** How a migration file came to be: composed under a `forge:compose` stamp, or hand-written. @public */
export type MigrationOrigin = "generated" | "custom";

/** What one `forge db migrate compose` run was asked to do. @public */
export interface ComposeOptions {
  /** The `<name>` part of `<NNNN>_<name>.sql`. */
  name?: string | undefined;
  custom: boolean;
  dryRun: boolean;
  /** The digest the destructive refusal printed, which approves that plan alone. */
  allowDestructive?: string | undefined;
  renames: readonly string[];
  cache: boolean;
  /** A generated migration whose stamp is rewritten to the history now on disk, its body untouched. */
  restamp?: string | undefined;
}

/** What one compose run did. @public */
export interface ComposeOutcome {
  /** The migration written, or null for a dry run and for a compose that found no change. */
  readonly path: string | null;
  readonly snapshotPath: string | null;
  readonly plan: readonly string[];
  /** Each rebuild step whose success depends on the rows already there, printed with the plan and never aborting. */
  readonly warnings: readonly string[];
  readonly sql: string;
  readonly dryRun: boolean;
}

/** What `forge db schema check` found. @public */
export interface SchemaCheckReport {
  /** Null for a checkout that declares a schema and composes nothing, where the check is that the declarations execute. */
  readonly snapshotPath: string | null;
  /** Each declared schema and the digest the snapshot holds for it. */
  readonly schemas: readonly string[];
  /** Null when nothing is declared and no snapshot exists, so there is nothing to hold in step. */
  readonly problems: readonly string[] | null;
}
