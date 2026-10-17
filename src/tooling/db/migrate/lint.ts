import { D1_LIMITS } from "../../../storage/db/limits";
import { sha256 } from "../digest";
import { parseMigrationHeader } from "../schema/header";
import { maskSqlProse, splitCreateTableBody } from "../schema/normalize";
import { sqlLineAt } from "../sql";
import type { LintFinding, LintRule, Migration, SqlStatement } from "../types";

const CREATE_TRIGGER = /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i;

function triggerClosed(text: string): boolean {
  if (!/\bEND\s*$/i.test(text)) return false;
  const openers = text.match(/\b(BEGIN|CASE)\b/gi)?.length ?? 0;
  const closers = text.match(/\bEND\b/gi)?.length ?? 0;
  return openers <= closers;
}

/** Splits SQL into statements at each `;`, consuming `CREATE TRIGGER … BEGIN … END` as one; comments and literals are already masked. @internal */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const masked = maskSqlProse(sql, { identifiers: true });
  const found: SqlStatement[] = [];
  let start = 0;
  let inTrigger = false;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] !== ";") continue;
    const text = masked.slice(start, i);
    if (!inTrigger && CREATE_TRIGGER.test(text)) inTrigger = true;
    if (inTrigger && !triggerClosed(text)) continue;
    inTrigger = false;
    found.push({ masked: text, raw: sql.slice(start, i), offset: start });
    start = i + 1;
  }
  if (masked.slice(start).trim() !== "") found.push({ masked: masked.slice(start), raw: sql.slice(start), offset: start });
  return found;
}

const ALTER_TABLE = /\bALTER\s+TABLE\b/i;
const ADD_COLUMN = /\bADD\s+(COLUMN\s+)?/i;
const WHERE = /\bWHERE\b/i;
const DEFAULT = /\bDEFAULT\b/i;

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

const CHECKS: readonly Check[] = [
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
    message: "CREATE VIRTUAL TABLE leaves the database unbackupable — `wrangler d1 export` throws on a virtual table",
    find: ({ statement }) => statement.masked.search(/\bCREATE\s+VIRTUAL\s+TABLE\b/i),
  },
  {
    rule: "autoincrement",
    message: "AUTOINCREMENT needs sqlite_sequence carried alongside the rows, which no backup artifact does — use INTEGER PRIMARY KEY",
    find: ({ statement }) => statement.masked.search(/\bAUTOINCREMENT\b/i),
  },
  {
    rule: "explicit-transaction",
    message: "wrangler wraps each migration in its own transaction, and a nested BEGIN or COMMIT fails inside it",
    find: ({ statement }) => leadingKeywordAt(statement.masked, /^\s*(BEGIN|COMMIT|ROLLBACK|END)\b/i),
  },
  {
    rule: "attach-database",
    message: "D1 is one database — ATTACH and DETACH are not supported",
    find: ({ statement }) => leadingKeywordAt(statement.masked, /^\s*(ATTACH|DETACH)\b/i),
  },
  {
    rule: "add-column-not-null-no-default",
    message: "ADD COLUMN … NOT NULL with no DEFAULT is refused by SQLite outright",
    find: ({ statement }) => {
      const s = statement.masked;
      if (!ALTER_TABLE.test(s) || DEFAULT.test(s) || s.search(ADD_COLUMN) === -1) return -1;
      return s.search(/\bNOT\s+NULL\b/i);
    },
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
      if (!/^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\b/i.test(statement.masked)) return -1;
      let columns: number;
      try {
        columns = splitCreateTableBody(statement.raw).clauses.filter((clause) => clause.kind === "column").length;
      } catch {
        return -1;
      }
      return columns > D1_LIMITS.columns ? statement.masked.search(/\bCREATE\b/i) : -1;
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
      const at = check.find(context);
      if (at === -1) continue;
      findings.push({ rule: check.rule, file, line: sqlLineAt(sql, statement.offset + at), message: check.message });
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
      const at = check.find(context);
      if (at === -1) continue;
      findings.push({ rule: check.rule, file, line: sqlLineAt(sql, statement.offset + at), message: check.message });
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
