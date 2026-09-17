import { CliError } from "../../cli/errors";
import { scanSql, splitCreateTableBody, sqlIdentifierEquals, unquoteSqlIdentifier } from "../schema/normalize";
import { INVENTORY_SELECT, quoteSqlIdentifier, tableInfoSelect, tableSqlSelect, toColumnInfo, toSchemaObjects } from "../sql";
import type { ColumnInfo, DbIo, Home } from "../types";
import { queryBatches, queryRows } from "../wrangler";
import { canonicaliseRow, classifyTable, decodeReadRow, SqlReal, TYPE_ALIAS_PREFIX, verificationSelect } from "./artifact";
import { emptyComparison, finishComparison, mergeRowPage } from "./compare";
import type { AppTable, CanonicalRow, ReadCursor, RowPage, SourceTable, TableComparison } from "./types";

// One page's worst case has to fit in one `d1 execute --json` result, which is a bound on bytes
// rather than on rows; 256 keeps a wide row inside it without a second round trip per page.
const PAGE_ROWS = 256;

/** One table's columns in declaration order. @internal */
export function readColumns(io: DbIo, home: Home, table: string): readonly ColumnInfo[] {
  return toColumnInfo(queryRows(io, home, tableInfoSelect(table)));
}

/** The collation the DDL declares on `key`, or null when it declares none and SQLite's own BINARY applies. @internal */
export function keyCollation(tableSql: string, key: string): string | null {
  let parts: ReturnType<typeof splitCreateTableBody>;
  try {
    parts = splitCreateTableBody(tableSql);
  } catch {
    return null;
  }
  for (const clause of parts.clauses) {
    const tokens = scanSql(clause.normalized).filter((token) => token.kind !== "space");
    const names = tokens.filter((token) => token.kind === "word" || token.kind === "identifier").map((token) => unquoteSqlIdentifier(token.text));
    // A column clause names the key first; a PRIMARY KEY constraint names it anywhere inside its list.
    const covers = clause.kind === "column" ? sqlIdentifierEquals(names[0] ?? "", key) : names.some((name) => sqlIdentifierEquals(name, key));
    if (!covers) continue;
    const at = tokens.findIndex((token) => token.kind === "word" && token.text.toUpperCase() === "COLLATE");
    const collation = at === -1 ? null : unquoteSqlIdentifier(tokens[at + 1]?.text ?? "");
    if (collation !== null && collation.toUpperCase() !== "BINARY") return collation;
  }
  return null;
}

/** The statements a key probe asks: whether any row holds NULL, then how many storage classes the column spans. @internal */
export function keyProbeSelects(name: string, key: string): [string, string] {
  const table = quoteSqlIdentifier(name);
  const column = quoteSqlIdentifier(key);
  return [`SELECT 1 AS present FROM ${table} WHERE ${column} IS NULL LIMIT 1`, `SELECT COUNT(DISTINCT typeof(${column})) AS classes FROM ${table}`];
}

function checkKeyValues(name: string, key: string, nulls: readonly Record<string, unknown>[], classes: readonly Record<string, unknown>[]): void {
  if (nulls.length > 0) {
    throw new CliError(
      "invalid-args",
      `${name}.${key} holds NULL in at least one row — a keyset read seeks past the key it last read and cannot seek past a NULL, so this table cannot be backed up`,
    );
  }
  if (Number(classes[0]?.classes ?? 1) > 1) {
    throw new CliError(
      "invalid-args",
      `${name}.${key} holds more than one storage class — a keyset read orders by one column and its seek and its order disagree across classes, so this table cannot be backed up`,
    );
  }
}

/** One table's shape, and the key a value probe still has to be run for — null where the key needs none. */
function analyseTable(
  name: string,
  info: readonly Record<string, unknown>[],
  declaration: readonly Record<string, unknown>[],
): { table: AppTable; probe: string | null } {
  const columns = toColumnInfo(info);
  const aliased = columns.filter((column) => column.name.startsWith(TYPE_ALIAS_PREFIX)).map((column) => column.name);
  if (aliased.length > 0) {
    throw new CliError(
      "invalid-args",
      `${name} declares column(s) [${aliased.join(", ")}] beginning ${TYPE_ALIAS_PREFIX} — a read projects each column's storage class under that name, so this table cannot be backed up`,
    );
  }
  const keys = columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk);
  if (keys.length > 1) {
    throw new CliError(
      "invalid-args",
      `${name} has a composite primary key (${keys.map((column) => column.name).join(", ")}) — a keyset read orders by one column, so this table cannot be backed up`,
    );
  }
  const key = keys[0]?.name ?? "rowid";
  const tableSql = String(declaration[0]?.sql ?? "");
  const collation = key === "rowid" ? null : keyCollation(tableSql, key);
  if (collation === null) {
    // A rowid is the engine's own integer: never NULL, never another storage class, so never read for one.
    return { table: { name, key, columns: columns.map((column) => column.name), pageRows: PAGE_ROWS }, probe: key === "rowid" ? null : key };
  }

  if (/\bWITHOUT\s+ROWID\b/i.test(tableSql)) {
    throw new CliError(
      "invalid-args",
      `${name}.${key} collates ${collation} and ${name} is WITHOUT ROWID — a keyset read orders by BINARY and this table has no other column to order by, so it cannot be backed up`,
    );
  }
  return { table: { name, key: "rowid", columns: columns.map((column) => column.name), pageRows: PAGE_ROWS }, probe: null };
}

/** Describes several tables as a bounded read addresses them, in the order asked, in two spawns rather than two each. @internal */
export function describeTables(io: DbIo, home: Home, names: readonly string[]): AppTable[] {
  const described = queryBatches(
    io,
    home,
    names.flatMap((name) => [tableInfoSelect(name), tableSqlSelect(name)]),
  );
  const analysed = names.map((name, index) => analyseTable(name, described[index * 2] ?? [], described[index * 2 + 1] ?? []));
  const probed = analysed.filter((analysis): analysis is { table: AppTable; probe: string } => analysis.probe !== null);
  const answers = queryBatches(
    io,
    home,
    probed.flatMap((analysis) => keyProbeSelects(analysis.table.name, analysis.probe)),
  );
  probed.forEach((analysis, index) => {
    checkKeyValues(analysis.table.name, analysis.probe, answers[index * 2] ?? [], answers[index * 2 + 1] ?? []);
  });
  return analysed.map((analysis) => analysis.table);
}

/** The table as a bounded read addresses it: the column it orders by, and the page size. @internal */
export function describeTable(io: DbIo, home: Home, name: string): AppTable {
  const [table] = describeTables(io, home, [name]);
  if (table === undefined) throw new CliError("invalid-args", `${name} could not be described — the read returned nothing for it`);
  return table;
}

/** The tables one `CREATE TABLE` references, read from its own text. @internal */
export function referencedTables(tableSql: string): string[] {
  // D1 refuses `pragma_foreign_key_list` with `SQLITE_AUTH`, so the DDL already in hand is the source.
  const tokens = scanSql(tableSql).filter((token) => token.kind !== "space" && token.kind !== "comment");
  const found: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "word" || token.text.toUpperCase() !== "REFERENCES") continue;
    const parent = tokens[index + 1];
    if (parent === undefined || (parent.kind !== "word" && parent.kind !== "identifier")) continue;
    found.push(unquoteSqlIdentifier(parent.text));
  }
  return found;
}

/** Reorders table names so every parent precedes the children that reference it. @internal */
export function dependencyOrder(names: readonly string[], edges: readonly { readonly child: string; readonly parent: string }[]): string[] {
  // A load split across transactions violates a foreign key at the first commit, and D1 accepts
  // `defer_foreign_keys` without honouring it, so the load order is what has to carry the constraint.
  const present = new Set(names);
  const parents = new Map<string, Set<string>>(names.map((name) => [name, new Set<string>()]));
  for (const edge of edges) {
    if (edge.child === edge.parent || !present.has(edge.child) || !present.has(edge.parent)) continue;
    parents.get(edge.child)?.add(edge.parent);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  const remaining = [...names];
  while (remaining.length > 0) {
    const next = remaining.findIndex((name) => [...(parents.get(name) ?? [])].every((parent) => placed.has(parent)));
    if (next === -1) break;
    const [name] = remaining.splice(next, 1);
    if (name === undefined) break;
    ordered.push(name);
    placed.add(name);
  }
  return [...ordered, ...remaining];
}

/** Every table the app owns, parents first, each with the key a paged read of it orders by. @internal */
export function discoverAppTables(io: DbIo, home: Home): AppTable[] {
  const objects = toSchemaObjects(queryRows(io, home, INVENTORY_SELECT));
  const tables = objects.filter((object) => object.type === "table" && classifyTable(object.name) === "app");
  const edges = tables.flatMap((table) => referencedTables(table.sql ?? "").map((parent) => ({ child: table.name, parent })));
  return describeTables(
    io,
    home,
    dependencyOrder(
      tables.map((table) => table.name),
      edges,
    ),
  );
}

/** Reads one page, ordered by the table's key and seeking past `after`. @internal */
export function readPage(io: DbIo, home: Home, table: AppTable, columns: readonly string[], after: ReadCursor): RowPage {
  const read = queryRows(io, home, verificationSelect(table, columns, after));
  const raw = read.map((row) => decodeReadRow(columns, row));
  const rows = raw.map((row) => canonicaliseRow(columns, table.key, row));
  const last = raw[raw.length - 1];
  const key = last?.[table.key];
  const cursor = last === undefined ? null : key instanceof SqlReal ? key.value : (key as ReadCursor);
  return { rows, raw, cursor, exhausted: raw.length < table.pageRows };
}

function advanced(table: AppTable, previous: ReadCursor, next: ReadCursor): ReadCursor {
  const same = Array.isArray(previous) && Array.isArray(next) ? previous.join() === (next as readonly number[]).join() : previous === next;
  if (!same) return next;
  throw new CliError(
    "invalid-args",
    `${table.name} read a full page and its key ${table.key} did not advance past ${JSON.stringify(previous)} — a keyset read cannot page past a repeated or NULL key, so this table cannot be backed up`,
  );
}

/** Every row of one table, read a page at a time. @internal */
export function readWholeTable(io: DbIo, home: Home, table: AppTable): SourceTable {
  const columns = table.columns.includes(table.key) ? table.columns : [table.key, ...table.columns];
  const rows: CanonicalRow[] = [];
  const raw: Record<string, unknown>[] = [];
  let cursor: ReadCursor = null;
  for (;;) {
    const page = readPage(io, home, table, columns, cursor);
    rows.push(...page.rows);
    raw.push(...page.raw);
    if (page.exhausted) break;
    cursor = advanced(table, cursor, page.cursor);
  }
  return { table, columns, rows, raw };
}

/** One table on a restored target, against the source held in memory. @internal */
export function compareTable(io: DbIo, source: SourceTable, target: Home): TableComparison {
  let state = mergeRowPage(emptyComparison(), source.rows, [], { source: true, target: false });
  let cursor: ReadCursor = null;
  for (;;) {
    const page = readPage(io, target, source.table, source.columns, cursor);
    state = mergeRowPage(state, [], page.rows, { source: true, target: page.exhausted });
    if (page.exhausted) break;
    cursor = advanced(source.table, cursor, page.cursor);
  }
  return finishComparison(source.table.name, state);
}
