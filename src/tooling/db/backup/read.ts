import { CliError } from "../../cli/errors";
import { scanSql, splitCreateTableBody, sqlIdentifierEquals, unquoteSqlIdentifier } from "../schema/normalize";
import type { SqlToken } from "../schema/types";
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
export async function readColumns(io: DbIo, home: Home, table: string): Promise<readonly ColumnInfo[]> {
  return toColumnInfo(await queryRows(io, home, tableInfoSelect(table)));
}

function declaredCollation(tokens: readonly SqlToken[]): string | null {
  let depth = 0;
  let collation: string | null = null;
  for (const [index, token] of tokens.entries()) {
    if (token.kind === "punct" && token.text === "(") depth += 1;
    if (token.kind === "punct" && token.text === ")") depth -= 1;
    if (depth === 0 && token.kind === "word" && token.text.toUpperCase() === "COLLATE") {
      collation = unquoteSqlIdentifier(tokens[index + 1]?.text ?? "");
    }
  }
  return collation;
}

function primaryKeyEntries(tokens: readonly SqlToken[]): SqlToken[][] {
  const at = tokens.findIndex(
    (token, index) => token.kind === "word" && token.text.toUpperCase() === "PRIMARY" && tokens[index + 1]?.text.toUpperCase() === "KEY",
  );
  if (at === -1) return [];
  const entries: SqlToken[][] = [[]];
  let depth = 0;
  for (const token of tokens.slice(at + 2)) {
    const punct = token.kind === "punct" ? token.text : "";
    if (punct === ")" && depth === 1) break;
    if (punct === "(") depth += 1;
    if (punct === ")") depth -= 1;
    if (punct === "," && depth === 1) entries.push([]);
    else if (depth > 1 || (depth === 1 && punct !== "(")) entries[entries.length - 1]?.push(token);
  }
  return entries;
}

/** How and where the DDL collates `key` otherwise than BINARY, a column's own outranking the PRIMARY KEY clause's, or null. @internal */
export function keyCollation(tableSql: string, key: string): { collation: string; declaredOn: "column" | "primary-key" } | null {
  let parts: ReturnType<typeof splitCreateTableBody>;
  try {
    parts = splitCreateTableBody(tableSql);
  } catch {
    return null;
  }
  let found: ReturnType<typeof keyCollation> = null;
  for (const clause of parts.clauses) {
    const tokens = scanSql(clause.normalized).filter((token) => token.kind !== "space");
    const entries = clause.kind === "column" ? [tokens] : primaryKeyEntries(tokens);
    const entry = entries.find((candidate) => sqlIdentifierEquals(unquoteSqlIdentifier(candidate[0]?.text ?? ""), key));
    const collation = entry === undefined ? null : declaredCollation(entry);
    if (collation === null || collation.toUpperCase() === "BINARY") continue;
    if (clause.kind === "column") return { collation, declaredOn: "column" };
    found ??= { collation, declaredOn: "primary-key" };
  }
  return found;
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
      `${name}.${key} holds more than one storage class — a keyset read's seek and its order disagree across classes, so this table cannot be backed up`,
    );
  }
}

/** One table's shape, and the key columns a value probe still has to be run for — none where the keys need none. */
function analyseTable(
  name: string,
  info: readonly Record<string, unknown>[],
  declaration: readonly Record<string, unknown>[],
): { table: AppTable; probes: readonly string[] } {
  const columns = toColumnInfo(info);
  const aliased = columns.filter((column) => column.name.startsWith(TYPE_ALIAS_PREFIX)).map((column) => column.name);
  if (aliased.length > 0) {
    throw new CliError(
      "invalid-args",
      `${name} declares column(s) [${aliased.join(", ")}] beginning ${TYPE_ALIAS_PREFIX} — a read projects each column's storage class under that name, so this table cannot be backed up`,
    );
  }
  const names = columns.map((column) => column.name);
  const rowidTable = { name, keys: ["rowid"], columns: names, pageRows: PAGE_ROWS };
  const keys = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  // A rowid is the engine's own integer: never NULL, never another storage class, so never read for one.
  if (keys.length === 0) return { table: rowidTable, probes: [] };
  const tableSql = String(declaration[0]?.sql ?? "");
  const collated = keys.flatMap((key) => {
    const declared = keyCollation(tableSql, key);
    return declared === null ? [] : [{ key, ...declared }];
  });
  const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(tableSql);
  const columnCollated = collated.find((entry) => entry.declaredOn === "column");
  if (columnCollated !== undefined && withoutRowid) {
    throw new CliError(
      "invalid-args",
      `${name}.${columnCollated.key} collates ${columnCollated.collation} and ${name} is WITHOUT ROWID — a keyset read orders by BINARY and this table has no other column to order by, so it cannot be backed up`,
    );
  }
  // A PRIMARY KEY clause's collation leaves the key read BINARY-correct but scanning and sorting the
  // table on every page, since the index no longer serves that order; rowid keeps the indexed seek.
  if (collated.length > 0 && !withoutRowid) return { table: rowidTable, probes: [] };
  return { table: { name, keys, columns: names, pageRows: PAGE_ROWS }, probes: keys };
}

/** Describes several tables as a bounded read addresses them, in the order asked, in two spawns rather than two each. @internal */
export async function describeTables(io: DbIo, home: Home, names: readonly string[]): Promise<AppTable[]> {
  const described = await queryBatches(
    io,
    home,
    names.flatMap((name) => [tableInfoSelect(name), tableSqlSelect(name)]),
  );
  const analysed = names.map((name, index) => analyseTable(name, described[index * 2] ?? [], described[index * 2 + 1] ?? []));
  const probes = analysed.flatMap((analysis) => analysis.probes.map((key) => ({ name: analysis.table.name, key })));
  const answers = await queryBatches(
    io,
    home,
    probes.flatMap((probe) => keyProbeSelects(probe.name, probe.key)),
  );
  probes.forEach((probe, index) => {
    checkKeyValues(probe.name, probe.key, answers[index * 2] ?? [], answers[index * 2 + 1] ?? []);
  });
  return analysed.map((analysis) => analysis.table);
}

/** The table as a bounded read addresses it: the columns it orders by, and the page size. @internal */
export async function describeTable(io: DbIo, home: Home, name: string): Promise<AppTable> {
  const [table] = await describeTables(io, home, [name]);
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

/** Every table the app owns, parents first, each with the keys a paged read of it orders by. @internal */
export async function discoverAppTables(io: DbIo, home: Home): Promise<AppTable[]> {
  const objects = toSchemaObjects(await queryRows(io, home, INVENTORY_SELECT));
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
export async function readPage(io: DbIo, home: Home, table: AppTable, columns: readonly string[], after: ReadCursor): Promise<RowPage> {
  const read = await queryRows(io, home, verificationSelect(table, columns, after));
  const raw = read.map((row) => decodeReadRow(columns, row));
  const rows = raw.map((row) => canonicaliseRow(columns, table.keys, row));
  const last = raw[raw.length - 1];
  const cursor =
    last === undefined
      ? null
      : table.keys.map((key) => {
          const cell = last[key];
          return cell instanceof SqlReal ? cell.value : (cell as string | number | readonly number[]);
        });
  return { rows, raw, cursor, exhausted: raw.length < table.pageRows };
}

function advanced(table: AppTable, previous: ReadCursor, next: ReadCursor): ReadCursor {
  if (JSON.stringify(previous) !== JSON.stringify(next)) return next;
  throw new CliError(
    "invalid-args",
    `${table.name} read a full page and its key ${table.keys.join(", ")} did not advance past ${JSON.stringify(previous)} — a keyset read cannot page past a repeated or NULL key, so this table cannot be backed up`,
  );
}

/** Every row of one table, read a page at a time. @internal */
export async function readWholeTable(io: DbIo, home: Home, table: AppTable): Promise<SourceTable> {
  const columns = [...table.keys.filter((key) => !table.columns.includes(key)), ...table.columns];
  const rows: CanonicalRow[] = [];
  const raw: Record<string, unknown>[] = [];
  let cursor: ReadCursor = null;
  for (;;) {
    const page = await readPage(io, home, table, columns, cursor);
    rows.push(...page.rows);
    raw.push(...page.raw);
    if (page.exhausted) break;
    cursor = advanced(table, cursor, page.cursor);
  }
  return { table, columns, rows, raw };
}

/** One table on a restored target, against the source held in memory. @internal */
export async function compareTable(io: DbIo, source: SourceTable, target: Home): Promise<TableComparison> {
  let state = mergeRowPage(emptyComparison(), source.rows, [], { source: true, target: false });
  let cursor: ReadCursor = null;
  for (;;) {
    const page = await readPage(io, target, source.table, source.columns, cursor);
    state = mergeRowPage(state, [], page.rows, { source: true, target: page.exhausted });
    if (page.exhausted) break;
    cursor = advanced(source.table, cursor, page.cursor);
  }
  return finishComparison(source.table.name, state);
}
