import { D1_LIMITS } from "../../../storage/db/limits";
import { sqlStatementSpans } from "../backup/split";
import { sha256 } from "../digest";
import { parseMigrationHeader } from "../schema/header";
import {
  bareSqlName,
  maskSqlProse,
  readQualifiedObjectName,
  splitCreateTableBody,
  sqlIdentifierKey,
  unquoteSqlIdentifier,
} from "../schema/normalize";
import {
  isSqlName,
  isSqlPrimaryKeyAt,
  isSqlWord,
  sqlCheckNullRefusals,
  sqlColumnHasNonNullDefault,
  sqlColumnNullRefusals,
  sqlColumnRefusesOwnNull,
  splitSqlAtDepthZero,
  spokenSqlTokens,
} from "../schema/nullability";
import type { CreateTableParts, SqlToken } from "../schema/types";
import { sqlLineAt } from "../sql";
import type { LintFinding, LintRule, Migration, SqlStatement } from "../types";

const CREATE_TRIGGER = /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i;

/** Splits SQL into statements at each `;`, a trigger's `BEGIN … END` body kept whole, each beside its text with comments, literals and quoted names masked. @internal */
export function splitSqlStatements(sql: string): SqlStatement[] {
  return sqlStatementSpans(sql).flatMap(({ start, end, terminated }) => {
    const raw = sql.slice(start, end);
    const masked = maskSqlProse(raw, { identifiers: true });
    return terminated || masked.trim() !== "" ? [{ raw, masked, offset: start }] : [];
  });
}

const ALTER_TABLE = /\bALTER\s+TABLE\b/i;
const ADD_COLUMN = /\bADD\s+(COLUMN\s+)?/i;
const WHERE = /\bWHERE\b/i;

interface LintContext {
  statement: SqlStatement;
  before: readonly SqlStatement[];
  file: string;
}

interface Check {
  rule: LintRule;
  message: string;
  find: (context: LintContext) => number;
}

interface CheckHit {
  at: number;
  message: string;
}

interface DetailedCheck {
  rule: LintRule;
  findEach: (context: LintContext) => readonly CheckHit[];
}

function checkHits(check: Check | DetailedCheck, context: LintContext): readonly CheckHit[] {
  if ("findEach" in check) return check.findEach(context);
  const at = check.find(context);
  return at === -1 ? [] : [{ at, message: check.message }];
}

function unboundedAt(masked: string, verb: RegExp): number {
  if (CREATE_TRIGGER.test(masked)) return -1;
  const at = masked.search(verb);
  if (at === -1) return -1;
  return WHERE.test(masked.slice(at)) ? -1 : at;
}

function leadingKeywordAt(statement: string, pattern: RegExp): number {
  const match = pattern.exec(statement);
  if (match === null) return -1;
  return match.index + match[0].length - (match[1]?.length ?? 0);
}

function namedTable(raw: string, pattern: RegExp): string | null {
  const match = pattern.exec(raw);
  const token = match?.[1];
  if (token === undefined) return null;
  return token.replace(/^["`[]|["`\]]$/g, "").toLowerCase();
}

function createdTables(statements: readonly SqlStatement[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    const name = namedTable(
      statement.raw,
      /\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)/i,
    );
    if (name !== null) names.add(name);
  }
  return names;
}

const REBUILD_PREFIX = /^_forge_new_/;

const PRAGMA = /^\s*(PRAGMA)\s+/i;

const D1_PRAGMAS: ReadonlySet<string> = new Set([
  "table_list",
  "table_info",
  "table_xinfo",
  "index_list",
  "index_info",
  "index_xinfo",
  "quick_check",
  "foreign_key_check",
  "foreign_key_list",
  "case_sensitive_like",
  "ignore_check_constraints",
  "legacy_alter_table",
  "recursive_triggers",
  "reverse_unordered_selects",
  "optimize",
  "defer_foreign_keys",
]);

function pragmaName(masked: string): string | null {
  return /^\s*PRAGMA\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(masked)?.[1]?.toLowerCase() ?? null;
}

const CREATE_TABLE = /^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\b/i;

const AUTH_TABLE_PREFIX = "auth_";

interface AuthForeignKey {
  at: number;
  columns: readonly string[];
  parent: string;
  action: string | null;
}

interface BodyClause {
  kind: "column" | "constraint";
  tokens: readonly SqlToken[];
}

function onDeleteAction(tokens: readonly SqlToken[]): string | null {
  const on = tokens.findIndex((token, i) => isSqlWord(token, "ON") && isSqlWord(tokens[i + 1], "DELETE"));
  if (on === -1) return null;
  const verb = tokens[on + 2]?.text.toUpperCase() ?? "";
  return verb === "SET" || verb === "NO" ? `${verb} ${tokens[on + 3]?.text.toUpperCase() ?? ""}` : verb;
}

function authKeyAt(tokens: readonly SqlToken[], references: number, end: number, columns: readonly string[], at: number): AuthForeignKey[] {
  const named = readQualifiedObjectName(tokens, references + 1);
  if (named === null) return [];
  const parent = named.name.replace(REBUILD_PREFIX, "");
  if (!sqlIdentifierKey(parent).startsWith(AUTH_TABLE_PREFIX)) return [];
  return [{ at, columns, parent, action: onDeleteAction(tokens.slice(references + 1, end)) }];
}

function columnAuthKeys(tokens: readonly SqlToken[]): AuthForeignKey[] {
  const head = tokens[0];
  if (head === undefined) return [];
  const references = tokens.flatMap((token, i) => (isSqlWord(token, "REFERENCES") ? [i] : []));
  return references.flatMap((r, n) =>
    authKeyAt(tokens, r, references[n + 1] ?? tokens.length, [unquoteSqlIdentifier(head.text)], tokens[r]?.start ?? head.start),
  );
}

function listedColumns(tokens: readonly SqlToken[], open: number): string[] {
  const close = tokens.findIndex((token, i) => i > open && token.kind === "punct" && token.text === ")");
  return tokens
    .slice(open + 1, close === -1 ? tokens.length : close)
    .filter(isSqlName)
    .map(bareSqlName);
}

function tableAuthKeys(tokens: readonly SqlToken[]): AuthForeignKey[] {
  const foreign = tokens.findIndex((token, i) => isSqlWord(token, "FOREIGN") && isSqlWord(tokens[i + 1], "KEY"));
  if (foreign === -1) return [];
  const references = tokens.findIndex((token, i) => i > foreign && isSqlWord(token, "REFERENCES"));
  if (references === -1) return [];
  return authKeyAt(tokens, references, tokens.length, listedColumns(tokens, foreign + 2), tokens[foreign]?.start ?? 0);
}

function constraintRefusesNull(tokens: readonly SqlToken[]): string[] {
  const primary = tokens.findIndex((_, i) => isSqlPrimaryKeyAt(tokens, i));
  if (primary !== -1) return listedColumns(tokens, primary + 2);
  return sqlCheckNullRefusals(tokens);
}

// The tokens of the column an `ALTER TABLE … ADD [COLUMN]` adds, or `null` when the statement adds none.
function addedColumn(tokens: readonly SqlToken[]): SqlToken[] | null {
  const table = tokens.findIndex((token) => isSqlWord(token, "TABLE"));
  const add = tokens.findIndex((token, i) => i > table + 1 && isSqlWord(token, "ADD"));
  if (add === -1) return null;
  return splitSqlAtDepthZero(tokens.slice(isSqlWord(tokens[add + 1], "COLUMN") ? add + 2 : add + 1), ",")[0] ?? null;
}

function addColumnRefusingNullAt(raw: string): number {
  const column = addedColumn(spokenSqlTokens(raw));
  const head = column?.[0];
  if (column === null || head === undefined || sqlColumnHasNonNullDefault(column)) return -1;
  return sqlColumnRefusesOwnNull(column) ? head.start : -1;
}

function alteredOrCreatedTable(tokens: readonly SqlToken[]): string {
  const table = tokens.findIndex((token) => isSqlWord(token, "TABLE"));
  const exists = isSqlWord(tokens[table + 1], "IF") && isSqlWord(tokens[table + 2], "NOT") && isSqlWord(tokens[table + 3], "EXISTS");
  const name = readQualifiedObjectName(tokens, table + (exists ? 4 : 1))?.name ?? "";
  return name.replace(REBUILD_PREFIX, "");
}

function authKeyFault(key: AuthForeignKey, notNull: ReadonlySet<string>): string | null {
  if (key.action === "CASCADE") return null;
  if (key.action === null) return "no ON DELETE clause, which is NO ACTION";
  if (key.action !== "SET NULL") return `ON DELETE ${key.action}`;
  const held = key.columns.filter((column) => notNull.has(sqlIdentifierKey(column)));
  return held.length === 0 ? null : `ON DELETE SET NULL on ${held.join(", ")}, which cannot hold NULL`;
}

function authKeyHits(table: string, keys: readonly AuthForeignKey[], notNull: ReadonlySet<string>): CheckHit[] {
  return keys.flatMap((key) => {
    const fault = authKeyFault(key, notNull);
    if (fault === null) return [];
    const message =
      `${table} (${key.columns.join(", ")}) references ${key.parent} with ${fault}, so D1 refuses the delete of an ${key.parent} row ` +
      "that purgeAuthEphemera or an admin remove makes — declare ON DELETE CASCADE, or ON DELETE SET NULL on a nullable column";
    return [{ at: key.at, message }];
  });
}

function bodyClauses(raw: string, parts: CreateTableParts): BodyClause[] {
  let cursor = parts.open + 1;
  return parts.clauses.map((clause) => {
    const start = raw.indexOf(clause.raw, cursor);
    cursor = start + clause.raw.length;
    return { kind: clause.kind, tokens: spokenSqlTokens(clause.raw, start) };
  });
}

function createTableAuthHits(raw: string): CheckHit[] {
  let parts: CreateTableParts;
  try {
    parts = splitCreateTableBody(raw);
  } catch {
    return [];
  }
  const clauses = bodyClauses(raw, parts);
  const notNull = new Set(
    clauses
      .flatMap(({ kind, tokens }) => (kind === "constraint" ? constraintRefusesNull(tokens) : sqlColumnNullRefusals(tokens)))
      .map(sqlIdentifierKey),
  );
  const keys = clauses.flatMap(({ kind, tokens }) => (kind === "column" ? columnAuthKeys(tokens) : tableAuthKeys(tokens)));
  return authKeyHits(alteredOrCreatedTable(spokenSqlTokens(raw)), keys, notNull);
}

function addColumnAuthHits(raw: string): CheckHit[] {
  const tokens = spokenSqlTokens(raw);
  const column = addedColumn(tokens);
  if (column === null) return [];
  return authKeyHits(alteredOrCreatedTable(tokens), columnAuthKeys(column), new Set(sqlColumnNullRefusals(column).map(sqlIdentifierKey)));
}

const CHECKS: readonly (Check | DetailedCheck)[] = [
  {
    rule: "drop-no-if-exists",
    message: "DROP without IF EXISTS fails the whole migration when the object is already gone — write DROP … IF EXISTS",
    find: ({ statement, before }) => {
      const at = statement.masked.search(/\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b(?!\s+IF\s+EXISTS\b)/i);
      if (at === -1) return -1;
      // A rebuild drops the table it has just copied into `_forge_new_<name>`, and that table is known to be there.
      const dropped = namedTable(statement.raw, /\bDROP\s+TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)/i);
      if (dropped !== null && [...createdTables(before)].some((name) => REBUILD_PREFIX.test(name) && name.replace(REBUILD_PREFIX, "") === dropped))
        return -1;
      return at;
    },
  },
  {
    rule: "unbounded-update",
    message: "UPDATE with no WHERE rewrites every row in the table",
    // An upsert's `DO UPDATE SET` is bounded by the conflicting row, and is the idiom a seed is told to write.
    find: ({ statement }) => unboundedAt(statement.masked, /(?<!\bDO\s+)\bUPDATE\b(?=[\s\S]*\bSET\b)/i),
  },
  {
    rule: "unbounded-delete",
    message: "DELETE with no WHERE empties the table",
    find: ({ statement }) => unboundedAt(statement.masked, /\bDELETE\s+FROM\b/i),
  },
  {
    rule: "virtual-table",
    message: "CREATE VIRTUAL TABLE leaves the database unbackupable — D1's export throws on a virtual table",
    find: ({ statement }) => statement.masked.search(/\bCREATE\s+VIRTUAL\s+TABLE\b/i),
  },
  {
    rule: "autoincrement",
    message: "AUTOINCREMENT needs sqlite_sequence carried alongside the rows, which no backup artifact does — use INTEGER PRIMARY KEY",
    find: ({ statement }) => statement.masked.search(/\bAUTOINCREMENT\b/i),
  },
  {
    rule: "explicit-transaction",
    message: "forge applies each migration in its own transaction, and a nested BEGIN or COMMIT fails inside it",
    find: ({ statement }) => leadingKeywordAt(statement.masked, /^\s*(BEGIN|COMMIT|ROLLBACK|END)\b/i),
  },
  {
    rule: "attach-database",
    message: "D1 is one database — ATTACH and DETACH are not supported",
    find: ({ statement }) => leadingKeywordAt(statement.masked, /^\s*(ATTACH|DETACH)\b/i),
  },
  {
    rule: "add-column-not-null-no-default",
    message:
      "ADD COLUMN of a column that refuses NULL, with no non-NULL DEFAULT, fails on any table that already has rows — add it nullable or with a constant DEFAULT",
    find: ({ statement }) =>
      ALTER_TABLE.test(statement.masked) && ADD_COLUMN.test(statement.masked) ? addColumnRefusingNullAt(statement.raw) : -1,
  },
  {
    rule: "add-column-non-constant-default",
    message:
      "ADD COLUMN with a DEFAULT that is not a constant — CURRENT_TIME, CURRENT_DATE, CURRENT_TIMESTAMP or a parenthesised expression — is refused by SQLite",
    find: ({ statement }) => {
      const s = statement.masked;
      if (!ALTER_TABLE.test(s) || s.search(ADD_COLUMN) === -1) return -1;
      return s.search(/\bDEFAULT\s*(\(|CURRENT_(TIME|DATE|TIMESTAMP)\b)/i);
    },
  },
  {
    rule: "add-column-constrained",
    message: "ADD COLUMN with PRIMARY KEY or UNIQUE is refused by SQLite — a constrained column is a table rebuild",
    find: ({ statement }) => {
      const s = statement.masked;
      if (!ALTER_TABLE.test(s) || s.search(ADD_COLUMN) === -1) return -1;
      return s.search(/\b(PRIMARY\s+KEY|UNIQUE)\b/i);
    },
  },
  {
    rule: "alter-column-unsupported",
    message: "D1's SQLite has no ALTER COLUMN — changing a column is a table rebuild, which `forge db migrate compose` emits from schema.sql",
    find: ({ statement }) => (ALTER_TABLE.test(statement.masked) ? statement.masked.search(/\bALTER\s+COLUMN\b/i) : -1),
  },
  {
    rule: "pragma-unsupported",
    message: "D1 always enforces foreign keys and ignores PRAGMA foreign_keys — only defer_foreign_keys relaxes them, inside a transaction",
    find: ({ statement }) => (pragmaName(statement.masked) === "foreign_keys" ? leadingKeywordAt(statement.masked, PRAGMA) : -1),
  },
  {
    rule: "pragma-unsupported",
    message: "D1 refuses this PRAGMA with SQLITE_AUTH, so the migration fails where it runs",
    find: ({ statement }) => {
      const name = pragmaName(statement.masked);
      return name === null || name === "foreign_keys" || D1_PRAGMAS.has(name) ? -1 : leadingKeywordAt(statement.masked, PRAGMA);
    },
  },
  {
    rule: "table-too-wide",
    message: `a table of more than ${D1_LIMITS.columns} columns, which D1 refuses — split it into tables joined on its key`,
    find: ({ statement }) => {
      if (!CREATE_TABLE.test(statement.masked)) return -1;
      let columns: number;
      try {
        columns = splitCreateTableBody(statement.raw).clauses.filter((clause) => clause.kind === "column").length;
      } catch {
        return -1;
      }
      return columns > D1_LIMITS.columns ? statement.masked.search(/\bCREATE\b/i) : -1;
    },
  },
  {
    rule: "auth-key-blocks-delete",
    findEach: ({ statement }) => {
      if (CREATE_TABLE.test(statement.masked)) return createTableAuthHits(statement.raw);
      if (ALTER_TABLE.test(statement.masked) && ADD_COLUMN.test(statement.masked)) return addColumnAuthHits(statement.raw);
      return [];
    },
  },
];

/** Checks one migration's SQL against every rule, reporting the line each finding sits on. @public */
export function lintMigration(file: string, sql: string): LintFinding[] {
  const header = parseMigrationHeader(sql);
  const findings: LintFinding[] = [];
  if (header.stamp === null) {
    findings.push({
      rule: "generated-edited",
      file,
      line: 1,
      message: "a migration with no compose stamp — `forge db migrate compose` writes every migration; change schema.sql and compose it",
    });
  } else if (header.stamp.body !== sha256(header.covered)) {
    findings.push({
      rule: "generated-edited",
      file,
      line: 2,
      message: "a generated migration was edited after compose wrote it — edit schema.sql and compose again",
    });
  }
  const statements = splitSqlStatements(sql);
  for (const [i, statement] of statements.entries()) {
    const context: LintContext = { statement, before: statements.slice(0, i), file };
    for (const check of CHECKS) {
      for (const hit of checkHits(check, context))
        findings.push({ rule: check.rule, file, line: sqlLineAt(sql, statement.offset + hit.at), message: hit.message });
    }
  }
  return findings;
}

/** Runs a named subset of the migration rules over any SQL, so a seed is held to the ones it can break without the migration-only ones. @internal */
export function lintStatements(file: string, sql: string, rules: readonly LintRule[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const statements = splitSqlStatements(sql);
  for (const [i, statement] of statements.entries()) {
    const context: LintContext = { statement, before: statements.slice(0, i), file };
    for (const check of CHECKS) {
      if (!rules.includes(check.rule)) continue;
      for (const hit of checkHits(check, context))
        findings.push({ rule: check.rule, file, line: sqlLineAt(sql, statement.offset + hit.at), message: hit.message });
    }
  }
  return findings;
}

/** Checks every discovered migration, naming each finding by the file it came from. @public */
export function lintMigrations(migrations: readonly Migration[]): LintFinding[] {
  return migrations.flatMap((migration) => lintMigration(migration.path, migration.sql));
}

/** Renders one finding as the single line the CLI prints for it. @internal */
export function formatLintFinding(finding: LintFinding): string {
  return `${finding.file}:${finding.line} ${finding.rule} — ${finding.message}`;
}
