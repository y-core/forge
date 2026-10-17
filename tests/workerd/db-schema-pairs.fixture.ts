import fc from "fast-check";

export type PairType = "TEXT" | "INTEGER";

/** One column besides the `id INTEGER PRIMARY KEY` every table opens with. */
export interface PairColumn {
  name: string;
  type: PairType;
  notNull: boolean;
  unique: boolean;
  indexed: boolean;
  check: boolean;
  references: string | null;
  generated: null | { source: string; stored: boolean };
}

/** A table, with how many rows the before state loads into it. */
export interface PairTable {
  name: string;
  columns: PairColumn[];
  rows: number;
}

/** A view selecting plain columns of one table. */
export interface PairView {
  name: string;
  table: string;
  columns: string[];
}

/** A declared schema, tables in dependency order. */
export interface PairSchema {
  tables: PairTable[];
  views: PairView[];
}

/** A before schema, the after schema the operations derive from it, and the `--rename` flags they need. */
export interface SchemaPair {
  before: PairSchema;
  after: PairSchema;
  renames: string[];
  operations: string[];
}

/** The pool's one identifier that is an SQL keyword, so every statement touching it has to quote it. */
export const KEYWORD_NAME = "select";

const TABLES = ["posts", "tags", "users", "notes", "events", "items", "orders", "pages"] as const;
const COLUMNS = ["title", "body", "score", "rank", "label", "kind", "state", "slug", "note", KEYWORD_NAME] as const;

type Role = "plain" | "references" | "virtual" | "stored";

interface ColumnDraft {
  type: PairType;
  notNull: boolean;
  unique: boolean;
  indexed: boolean;
  check: boolean;
  role: Role;
  parent: number;
}

interface TableDraft {
  names: string[];
  columns: ColumnDraft[];
  rows: number;
}

const columnDraft: fc.Arbitrary<ColumnDraft> = fc.record({
  type: fc.constantFrom<PairType>("TEXT", "INTEGER"),
  notNull: fc.boolean(),
  unique: fc.boolean(),
  indexed: fc.boolean(),
  check: fc.boolean(),
  role: fc.oneof(
    { weight: 4, arbitrary: fc.constant<Role>("plain") },
    { weight: 2, arbitrary: fc.constant<Role>("references") },
    { weight: 2, arbitrary: fc.constant<Role>("virtual") },
    { weight: 1, arbitrary: fc.constant<Role>("stored") },
  ),
  parent: fc.nat(),
});

const tableDraft: fc.Arbitrary<TableDraft> = fc.record({
  names: fc.uniqueArray(fc.constantFrom(...COLUMNS), { minLength: 1, maxLength: 4 }),
  columns: fc.array(columnDraft, { minLength: 4, maxLength: 4 }),
  rows: fc.integer({ min: 3, max: 4 }),
});

const plainColumn = (name: string, type: PairType): PairColumn => ({
  name,
  type,
  notNull: false,
  unique: false,
  indexed: false,
  check: false,
  references: null,
  generated: null,
});

function buildColumns(names: readonly string[], drafts: readonly ColumnDraft[], earlier: readonly string[]): PairColumn[] {
  const columns: PairColumn[] = [];
  for (const [index, name] of names.entries()) {
    const draft = drafts[index] as ColumnDraft;
    const source = columns.findLast((column) => column.generated === null);
    if ((draft.role === "virtual" || draft.role === "stored") && source !== undefined) {
      columns.push({ ...plainColumn(name, source.type), generated: { source: source.name, stored: draft.role === "stored" } });
    } else if (draft.role === "references" && earlier.length > 0) {
      columns.push({ ...plainColumn(name, "INTEGER"), indexed: draft.indexed, references: earlier[draft.parent % earlier.length] as string });
    } else {
      columns.push({
        name,
        type: draft.type,
        notNull: draft.notNull,
        unique: draft.unique,
        indexed: draft.indexed && !draft.unique,
        check: draft.check && draft.type === "INTEGER",
        references: null,
        generated: null,
      });
    }
  }
  return columns;
}

const schemaArbitrary: fc.Arbitrary<PairSchema> = fc
  .record({
    names: fc.uniqueArray(fc.constantFrom(...TABLES), { minLength: 1, maxLength: 3 }),
    drafts: fc.array(tableDraft, { minLength: 3, maxLength: 3 }),
    views: fc.array(fc.record({ table: fc.nat(), mask: fc.nat() }), { maxLength: 2 }),
  })
  .map(({ names, drafts, views }) => {
    const tables = names.map((name, index): PairTable => {
      const draft = drafts[index] as TableDraft;
      return { name, columns: buildColumns(draft.names, draft.columns, names.slice(0, index)), rows: draft.rows };
    });
    return {
      tables,
      views: views.map(({ table: pick, mask }, index): PairView => {
        const table = tables[pick % tables.length] as PairTable;
        const candidates = ["id", ...table.columns.filter((column) => column.generated === null).map((column) => column.name)];
        const chosen = candidates.filter((_, bit) => ((mask >> bit) & 1) === 1);
        return { name: `${table.name}_v${index}`, table: table.name, columns: chosen.length === 0 ? ["id"] : chosen };
      }),
    };
  });

type OperationKind =
  | "keep"
  | "add column"
  | "add index"
  | "drop column"
  | "drop table"
  | "tighten to NOT NULL"
  | "add UNIQUE"
  | "drop view"
  | "drop virtual column"
  | "rename table"
  | "rename table, reuse its name"
  | "rename column"
  | "rename column, reuse its name";

const OPERATION_WEIGHTS: readonly [OperationKind, number][] = [
  ["keep", 1],
  ["add column", 1],
  ["add index", 1],
  ["drop column", 3],
  ["drop table", 2],
  ["tighten to NOT NULL", 3],
  ["add UNIQUE", 1],
  ["drop view", 1],
  ["drop virtual column", 2],
  ["rename table", 1],
  ["rename table, reuse its name", 3],
  ["rename column", 1],
  ["rename column, reuse its name", 3],
];

interface OperationDraft {
  kind: OperationKind;
  a: number;
  b: number;
}

const operationDraft: fc.Arbitrary<OperationDraft> = fc.record({
  kind: fc.oneof(...OPERATION_WEIGHTS.map(([kind, weight]) => ({ weight, arbitrary: fc.constant(kind) }))),
  a: fc.nat(),
  b: fc.nat(),
});

const pick = <T>(items: readonly T[], at: number): T | undefined => items[at % Math.max(items.length, 1)];

function deriveAfter(before: PairSchema, drafts: readonly OperationDraft[]): SchemaPair {
  const after: PairSchema = structuredClone(before);
  const renames: string[] = [];
  const operations: string[] = [];
  const touchedTables = new Set<string>();
  const lockedColumns = new Set<string>();
  const beforeTable = (name: string) => before.tables.find((table) => table.name === name);
  const freeTables = () => after.tables.filter((table) => !touchedTables.has(table.name));
  const freeColumns = (filter: (column: PairColumn, table: PairTable) => boolean) =>
    freeTables().flatMap((table) =>
      table.columns
        .filter((column) => !lockedColumns.has(`${table.name}.${column.name}`) && filter(column, table))
        .map((column) => ({ table, column })),
    );
  const isSource = (table: PairTable, name: string) => table.columns.some((column) => column.generated?.source === name);
  const freshTable = (at: number) => {
    const taken = new Set([...before.tables, ...after.tables].map((table) => table.name));
    return pick(
      TABLES.filter((name) => !taken.has(name)),
      at,
    );
  };
  const freshColumn = (table: PairTable, at: number) => {
    const taken = new Set([...(beforeTable(table.name)?.columns ?? []), ...table.columns].map((column) => column.name));
    return pick(
      COLUMNS.filter((name) => !taken.has(name)),
      at,
    );
  };
  const removeColumn = (table: PairTable, name: string) => {
    table.columns = table.columns.filter((column) => column.name !== name);
    for (const view of after.views.filter((candidate) => candidate.table === table.name)) {
      view.columns = view.columns.filter((column) => column !== name);
      if (view.columns.length === 0) view.columns = ["id"];
    }
  };

  for (const { kind, a, b } of drafts) {
    const applied = ((): string | null => {
      switch (kind) {
        case "keep":
          return "keep";
        case "add column": {
          const table = pick(freeTables(), a);
          const name = table === undefined ? undefined : freshColumn(table, b);
          if (table === undefined || name === undefined) return null;
          table.columns.push(plainColumn(name, "TEXT"));
          lockedColumns.add(`${table.name}.${name}`);
          return `add column ${table.name}.${name}`;
        }
        case "add index": {
          const chosen = pick(
            freeColumns((column) => column.generated === null && !column.indexed && !column.unique),
            a,
          );
          if (chosen === undefined) return null;
          chosen.column.indexed = true;
          return `add index on ${chosen.table.name}.${chosen.column.name}`;
        }
        case "drop column": {
          const chosen = pick(
            freeColumns((column, table) => !isSource(table, column.name)),
            a,
          );
          if (chosen === undefined) return null;
          removeColumn(chosen.table, chosen.column.name);
          return `drop column ${chosen.table.name}.${chosen.column.name}`;
        }
        case "drop virtual column": {
          const chosen = pick(
            freeColumns((column) => column.generated !== null && !column.generated.stored),
            a,
          );
          if (chosen === undefined) return null;
          removeColumn(chosen.table, chosen.column.name);
          return `drop virtual column ${chosen.table.name}.${chosen.column.name}`;
        }
        case "drop table": {
          const referenced = new Set(after.tables.flatMap((table) => table.columns.flatMap((column) => column.references ?? [])));
          const table = pick(
            freeTables().filter((candidate) => !referenced.has(candidate.name)),
            a,
          );
          if (table === undefined) return null;
          after.tables = after.tables.filter((candidate) => candidate !== table);
          after.views = after.views.filter((view) => view.table !== table.name);
          return `drop table ${table.name}`;
        }
        case "tighten to NOT NULL":
        case "add UNIQUE": {
          const tighten = kind === "tighten to NOT NULL";
          const chosen = pick(
            freeColumns((column) => column.generated === null && column.references === null && (tighten ? !column.notNull : !column.unique)),
            a,
          );
          if (chosen === undefined) return null;
          if (tighten) chosen.column.notNull = true;
          else chosen.column.unique = true;
          lockedColumns.add(`${chosen.table.name}.${chosen.column.name}`);
          return `${kind} ${chosen.table.name}.${chosen.column.name}`;
        }
        case "drop view": {
          const view = pick(after.views, a);
          if (view === undefined) return null;
          after.views = after.views.filter((candidate) => candidate !== view);
          return `drop view ${view.name}`;
        }
        case "rename table":
        case "rename table, reuse its name": {
          const table = pick(freeTables(), a);
          const to = freshTable(b);
          if (table === undefined || to === undefined) return null;
          const from = table.name;
          table.name = to;
          for (const column of after.tables.flatMap((candidate) => candidate.columns)) {
            if (column.references === from) column.references = to;
          }
          for (const view of after.views) if (view.table === from) view.table = to;
          renames.push(`${from}:${to}`);
          touchedTables.add(to);
          if (kind === "rename table") return `rename table ${from} to ${to}`;
          after.tables.push({ name: from, columns: [plainColumn(pick(COLUMNS, b) as string, "TEXT")], rows: 0 });
          touchedTables.add(from);
          return `rename table ${from} to ${to}, and create a new ${from}`;
        }
        case "rename column":
        case "rename column, reuse its name": {
          const chosen = pick(
            freeColumns((column) => column.generated === null),
            a,
          );
          const to = chosen === undefined ? undefined : freshColumn(chosen.table, b);
          if (chosen === undefined || to === undefined) return null;
          const { table, column } = chosen;
          const from = column.name;
          column.name = to;
          for (const candidate of table.columns) if (candidate.generated?.source === from) candidate.generated.source = to;
          for (const view of after.views.filter((candidate) => candidate.table === table.name)) {
            view.columns = view.columns.map((name) => (name === from ? to : name));
          }
          renames.push(`${table.name}.${from}:${to}`);
          lockedColumns.add(`${table.name}.${to}`);
          if (kind === "rename column") return `rename column ${table.name}.${from} to ${to}`;
          table.columns.push(plainColumn(from, "TEXT"));
          lockedColumns.add(`${table.name}.${from}`);
          return `rename column ${table.name}.${from} to ${to}, and add a new ${from}`;
        }
      }
    })();
    operations.push(applied ?? `skip ${kind}`);
  }
  return { before, after, renames, operations };
}

/** Pairs a generated schema with the one a few drops, rebuilds and renames derive from it. */
export function schemaPairArbitrary(): fc.Arbitrary<SchemaPair> {
  return fc.tuple(schemaArbitrary, fc.array(operationDraft, { minLength: 1, maxLength: 3 })).map(([before, drafts]) => deriveAfter(before, drafts));
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: unknown) => (typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`);

function renderColumn(column: PairColumn): string {
  const head = `${quote(column.name)} ${column.type}`;
  if (column.generated !== null) {
    const source = quote(column.generated.source);
    const expression = column.type === "TEXT" ? `upper(${source})` : `${source} + 1`;
    return `${head} GENERATED ALWAYS AS (${expression}) ${column.generated.stored ? "STORED" : "VIRTUAL"}`;
  }
  return [
    head,
    ...(column.notNull ? [`NOT NULL DEFAULT ${column.type === "TEXT" ? "'unset'" : "0"}`] : []),
    ...(column.unique ? ["UNIQUE"] : []),
    ...(column.check ? [`CHECK (${quote(column.name)} >= 0)`] : []),
    ...(column.references === null ? [] : [`REFERENCES ${quote(column.references)} ("id")`]),
  ].join(" ");
}

/** The `schema.sql` declaring `schema`: its tables, then their indexes, then its views. */
export function renderSchema(schema: PairSchema): string {
  const tables = schema.tables.map(
    (table) => `CREATE TABLE ${quote(table.name)} (${['"id" INTEGER PRIMARY KEY', ...table.columns.map(renderColumn)].join(", ")});`,
  );
  const indexes = schema.tables.flatMap((table) =>
    table.columns
      .filter((column) => column.indexed)
      .map((column) => `CREATE INDEX ${quote(`${table.name}_${column.name}_idx`)} ON ${quote(table.name)} (${quote(column.name)});`),
  );
  const views = schema.views.map(
    (view) => `CREATE VIEW ${quote(view.name)} AS SELECT ${view.columns.map(quote).join(", ")} FROM ${quote(view.table)};`,
  );
  return `${[...tables, ...indexes, ...views].join("\n")}\n`;
}

/** Each table's rows, `id` 1 to n, every plain value distinct and non-NULL and every reference an existing parent `id`. */
export function rowsFor(schema: PairSchema): Record<string, Record<string, string | number>[]> {
  const counts = new Map(schema.tables.map((table) => [table.name, table.rows]));
  return Object.fromEntries(
    schema.tables.map((table) => [
      table.name,
      Array.from({ length: table.rows }, (_, index) => {
        const id = index + 1;
        const row: Record<string, string | number> = { id };
        for (const [position, column] of table.columns.entries()) {
          if (column.generated !== null) continue;
          if (column.references !== null) row[column.name] = (index % (counts.get(column.references) ?? 1)) + 1;
          else row[column.name] = column.type === "TEXT" ? `${column.name}-${id}` : id * 10 + position;
        }
        return row;
      }),
    ]),
  );
}

/** The `INSERT` statements that load `rowsFor(schema)`, parents first. */
export function renderRows(schema: PairSchema): string {
  return Object.entries(rowsFor(schema))
    .flatMap(([table, rows]) =>
      rows.map((row) => {
        const columns = Object.keys(row);
        return `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map((column) => literal(row[column])).join(", ")});`;
      }),
    )
    .join("\n");
}
