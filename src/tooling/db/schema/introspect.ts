import { CliError } from "../../cli/errors";
import { isManagedObject } from "../migrate/fingerprint";
import type { DbIo, Home } from "../types";
import { queryBatches } from "../wrangler";
import { normalizeDdlText, splitCreateTableBody, sqlIdentifierKey } from "./normalize";
import type { CreateTableParts, SchemaColumn, SchemaForeignKey, SchemaIndex, SchemaModel, SchemaTable, SchemaTrigger, SchemaView } from "./types";

// D1's authorizer refuses a pragma function on `sqlite_*` and `_cf_*`, so the join filters them in SQL.
// Every leading underscore is escaped: unescaped it is LIKE's single-character wildcard.
function ownFilter(): string {
  return `m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_forge\\_%' ESCAPE '\\'`;
}

/** The reads a model is built from, batched into one wrangler spawn however many tables there are. @internal */
export function schemaModelSelects(): { inventory: string; columns: string; indexList: string; indexColumns: string; foreignKeys: string } {
  const own = ownFilter();
  return {
    inventory: `SELECT type, name, tbl_name, sql FROM sqlite_master m WHERE ${own} ORDER BY type, name`,
    columns: `SELECT m.name AS tbl, x.cid, x.name, x.type, x."notnull", x.dflt_value, x.pk, x.hidden FROM sqlite_master m JOIN pragma_table_xinfo(m.name) x WHERE m.type = 'table' AND ${own} ORDER BY m.name, x.cid`,
    indexList: `SELECT m.name AS tbl, l.name AS idx, l."unique", l.partial FROM sqlite_master m JOIN pragma_index_list(m.name) l WHERE m.type = 'table' AND ${own} ORDER BY m.name, l.name`,
    indexColumns: `SELECT m.name AS idx, i.seqno, i.name AS col FROM sqlite_master m JOIN pragma_index_info(m.name) i WHERE m.type = 'index' AND ${own} ORDER BY m.name, i.seqno`,
    foreignKeys: `SELECT m.name AS tbl, f.id, f.seq, f."table" AS parent, f."from" AS "from", f."to" AS "to", f.on_update, f.on_delete FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND ${own} ORDER BY m.name, f.id, f.seq`,
  };
}

type Row = Record<string, unknown>;
const text = (row: Row, key: string): string => String(row[key] ?? "");
const num = (row: Row, key: string): number => Number(row[key] ?? 0);

function byName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function columnsOf(table: string, parts: CreateTableParts, rows: readonly Row[]): SchemaColumn[] {
  const clauses = parts.clauses.filter((clause) => clause.kind === "column");
  if (clauses.length !== rows.length) {
    throw new Error(
      `${table}: ${rows.length} columns in pragma_table_xinfo and ${clauses.length} column clauses in its DDL — the body splitter did not read this CREATE TABLE`,
    );
  }
  return rows.map((row, i) => {
    const clause = clauses[i];
    if (clause === undefined) throw new Error(`${table}: column ${i} has no clause`);
    return {
      name: text(row, "name"),
      type: text(row, "type"),
      notnull: num(row, "notnull") !== 0,
      defaultExpr: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
      pk: num(row, "pk"),
      hidden: num(row, "hidden"),
      definition: clause.normalized,
      definitionSource: clause.source,
    };
  });
}

function foreignKeysOf(rows: readonly Row[]): SchemaForeignKey[] {
  const grouped = new Map<number, { table: string; from: string[]; to: (string | null)[]; onUpdate: string; onDelete: string }>();
  for (const row of rows) {
    const id = num(row, "id");
    const entry = grouped.get(id) ?? {
      table: text(row, "parent"),
      from: [],
      to: [],
      onUpdate: text(row, "on_update"),
      onDelete: text(row, "on_delete"),
    };
    entry.from.push(text(row, "from"));
    entry.to.push(row.to === null || row.to === undefined ? null : String(row.to));
    grouped.set(id, entry);
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
}

/** Assembles a model from those reads' rows, which a test can hand in without a database. @internal */
export function assembleSchemaModel(rows: {
  inventory: readonly Row[];
  columns: readonly Row[];
  indexList: readonly Row[];
  indexColumns: readonly Row[];
  foreignKeys: readonly Row[];
}): SchemaModel {
  const inventory = rows.inventory.filter((row) => !isManagedObject(text(row, "name")) && !isManagedObject(text(row, "tbl_name")));
  const virtual = inventory.find((row) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(text(row, "sql")));
  if (virtual !== undefined) {
    throw new CliError(
      "invalid-args",
      `${text(virtual, "name")} is a virtual table — compose does not model one, and \`wrangler d1 export\` cannot back one up`,
    );
  }

  const columnRows = new Map<string, Row[]>();
  for (const row of rows.columns) columnRows.set(text(row, "tbl"), [...(columnRows.get(text(row, "tbl")) ?? []), row]);
  const fkRows = new Map<string, Row[]>();
  for (const row of rows.foreignKeys) fkRows.set(text(row, "tbl"), [...(fkRows.get(text(row, "tbl")) ?? []), row]);
  const indexFlags = new Map(
    rows.indexList.map((row) => [text(row, "idx"), { unique: num(row, "unique") !== 0, partial: num(row, "partial") !== 0 }]),
  );
  const indexColumns = new Map<string, string[]>();
  for (const row of rows.indexColumns) indexColumns.set(text(row, "idx"), [...(indexColumns.get(text(row, "idx")) ?? []), text(row, "col")]);

  const tables: SchemaTable[] = [];
  const indexes: SchemaIndex[] = [];
  const triggers: SchemaTrigger[] = [];
  const views: SchemaView[] = [];
  for (const row of inventory) {
    const name = text(row, "name");
    const sql = text(row, "sql");
    const type = text(row, "type");
    if (type === "table") {
      const rowsOf = columnRows.get(name) ?? [];
      const parts = splitCreateTableBody(sql, { literals: new Set(rowsOf.map((column) => text(column, "name"))) });
      tables.push({
        name,
        columns: columnsOf(name, parts, rowsOf),
        constraints: parts.clauses
          .filter((clause) => clause.kind === "constraint")
          .map((clause) => clause.normalized)
          .sort(),
        strict: /\bSTRICT\b/.test(parts.options),
        withoutRowid: /\bWITHOUT ROWID\b/.test(parts.options),
        foreignKeys: foreignKeysOf(fkRows.get(name) ?? []),
        sql,
      });
    } else if (type === "index") {
      if (sql === "") continue;
      const flags = indexFlags.get(name) ?? { unique: false, partial: false };
      indexes.push({ name, table: text(row, "tbl_name"), ...flags, columns: indexColumns.get(name) ?? [], sql, normalized: normalizeDdlText(sql) });
    } else if (type === "trigger") {
      triggers.push({ name, table: text(row, "tbl_name"), sql, normalized: normalizeDdlText(sql, { literals: "verbatim" }) });
    } else if (type === "view") {
      views.push({ name, sql, normalized: normalizeDdlText(sql, { literals: "verbatim" }) });
    }
  }
  return { tables: byName(tables), indexes: byName(indexes), triggers: byName(triggers), views: byName(views) };
}

/** Reads a home's schema into a model: every read in one wrangler spawn, however many objects there are. @internal */
export function readSchemaModel(io: DbIo, home: Home): SchemaModel {
  const selects = schemaModelSelects();
  const [inventory = [], columns = [], indexList = [], indexColumns = [], foreignKeys = []] = queryBatches(io, home, [
    selects.inventory,
    selects.columns,
    selects.indexList,
    selects.indexColumns,
    selects.foreignKeys,
  ]);
  return assembleSchemaModel({ inventory, columns, indexList, indexColumns, foreignKeys });
}

/** True when two tables declare the same shape: columns equal in order, the same constraint set, the same options. @internal */
export function schemaTablesEqual(a: SchemaTable, b: SchemaTable): boolean {
  return (
    a.columns.length === b.columns.length &&
    a.columns.every((column, i) => column.definition === b.columns[i]?.definition) &&
    a.constraints.join("\0") === b.constraints.join("\0") &&
    a.strict === b.strict &&
    a.withoutRowid === b.withoutRowid
  );
}

/** Every way two models differ, one line each, empty when they are the same schema. @internal */
export function describeSchemaDifference(left: SchemaModel, right: SchemaModel, labels: { left: string; right: string }): string[] {
  const lines: string[] = [];
  const compare = <T extends { name: string }>(type: string, a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): void => {
    const byNameB = new Map(b.map((item) => [sqlIdentifierKey(item.name), item]));
    const byNameA = new Map(a.map((item) => [sqlIdentifierKey(item.name), item]));
    for (const item of a) {
      const other = byNameB.get(sqlIdentifierKey(item.name));
      if (other === undefined) lines.push(`${type} ${item.name}: in ${labels.left}, not in ${labels.right}`);
      else if (!same(item, other)) lines.push(`${type} ${item.name}: differs between ${labels.left} and ${labels.right}`);
    }
    for (const item of b)
      if (!byNameA.has(sqlIdentifierKey(item.name))) lines.push(`${type} ${item.name}: in ${labels.right}, not in ${labels.left}`);
  };
  compare("table", left.tables, right.tables, schemaTablesEqual);
  compare("index", left.indexes, right.indexes, (x, y) => x.normalized === y.normalized);
  compare("trigger", left.triggers, right.triggers, (x, y) => x.normalized === y.normalized);
  compare("view", left.views, right.views, (x, y) => x.normalized === y.normalized);
  return lines;
}
