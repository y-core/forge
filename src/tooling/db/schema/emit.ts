import { quoteSqlIdentifier } from "../sql";
import { readQualifiedObjectName, scanSql, splitCreateTableBody, sqlIdentifierKey } from "./normalize";
import type { SchemaDiff, SchemaModel, SchemaRename, SchemaTable } from "./types";

/** The prefix a rebuild's replacement table carries until it is renamed into place. @internal */
export const REBUILD_TABLE_PREFIX = "_forge_new_";

/** Tables ordered so every table follows the tables it references; a cycle falls back to name order. @internal */
export function orderTablesByForeignKeys(tables: readonly SchemaTable[]): SchemaTable[] {
  const names = new Set(tables.map((table) => sqlIdentifierKey(table.name)));
  const remaining = new Map(tables.map((table) => [sqlIdentifierKey(table.name), table]));
  const ordered: SchemaTable[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((table) =>
        table.foreignKeys.every(
          (fk) =>
            sqlIdentifierKey(fk.table) === sqlIdentifierKey(table.name) ||
            !names.has(sqlIdentifierKey(fk.table)) ||
            !remaining.has(sqlIdentifierKey(fk.table)),
        ),
      )
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    const next = ready[0] ?? [...remaining.values()].sort((a, b) => (a.name < b.name ? -1 : 1))[0];
    if (next === undefined) break;
    ordered.push(next);
    remaining.delete(sqlIdentifierKey(next.name));
  }
  return ordered;
}

/** Every table that has to be rebuilt alongside `roots`: each one, and every table whose FOREIGN KEY points at one of them, transitively. @internal */
export function rebuildClosure(baseline: SchemaModel, roots: readonly string[]): string[] {
  const closure = new Map(roots.map((name) => [sqlIdentifierKey(name), name]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const table of baseline.tables) {
      if (closure.has(sqlIdentifierKey(table.name))) continue;
      if (table.foreignKeys.some((fk) => closure.has(sqlIdentifierKey(fk.table)))) {
        closure.set(sqlIdentifierKey(table.name), table.name);
        grew = true;
      }
    }
  }
  return [...closure.values()];
}

/** `sql` with every `REFERENCES <table>` naming a rebuilt table re-pointed at that table's replacement. */
function repointReferences(sql: string, rebuilt: ReadonlySet<string>): string {
  const tokens = scanSql(sql).filter((token) => token.kind !== "comment" && token.kind !== "space");
  const edits: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const word = tokens[i];
    if (word === undefined || word.kind !== "word" || word.text.toUpperCase() !== "REFERENCES") continue;
    const target = readQualifiedObjectName(tokens, i + 1);
    if (target === null) continue;
    const name = [...rebuilt].find((candidate) => sqlIdentifierKey(candidate) === sqlIdentifierKey(target.name));
    if (name !== undefined) edits.push({ start: target.start, end: target.end, text: quoteSqlIdentifier(`${REBUILD_TABLE_PREFIX}${name}`) });
  }
  let out = sql;
  for (const edit of edits.reverse()) out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
  return out;
}

function createStatement(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function renameStatements(renames: readonly SchemaRename[]): string[] {
  return renames.map((rename) =>
    rename.kind === "table"
      ? `ALTER TABLE ${quoteSqlIdentifier(rename.from)} RENAME TO ${quoteSqlIdentifier(rename.to)};`
      : `ALTER TABLE ${quoteSqlIdentifier(rename.table)} RENAME COLUMN ${quoteSqlIdentifier(rename.from)} TO ${quoteSqlIdentifier(rename.to)};`,
  );
}

/** The SQL that takes the baseline to the desired model, in the one order every step is safe in. @internal */
export function emitMigrationSql(diff: SchemaDiff, baseline: SchemaModel, desired: SchemaModel, renames: readonly SchemaRename[] = []): string {
  // Every name is keyed the way SQLite resolves one, so a baseline and a desired table that differ
  // only in case are the same table here — and a rebuild copies its rows rather than none.
  const desiredTable = new Map(desired.tables.map((table) => [sqlIdentifierKey(table.name), table]));
  const baselineTable = new Map(baseline.tables.map((table) => [sqlIdentifierKey(table.name), table]));
  const rebuiltRoots = [...diff.tables.filter((change) => change.kind === "rebuild").map((change) => change.name), ...diff.dropDependents];
  const dropped = new Map(diff.tables.filter((change) => change.kind === "drop").map((change) => [sqlIdentifierKey(change.name), change.name]));
  const closure = rebuildClosure(baseline, rebuiltRoots).filter(
    (name) => !dropped.has(sqlIdentifierKey(name)) && desiredTable.has(sqlIdentifierKey(name)),
  );
  const rebuilt = new Set(closure.map(sqlIdentifierKey));
  const rebuilding = rebuilt.size > 0;
  const created = new Set(diff.tables.filter((change) => change.kind === "create").map((change) => sqlIdentifierKey(change.name)));

  const out: string[] = [];
  out.push(...renameStatements(renames));

  // A view or trigger that names a rebuilt table makes the rename into place fail, so every one goes and comes back around a rebuild.
  const viewsToDrop = rebuilding ? baseline.views.map((view) => view.name) : [...diff.views.dropped, ...diff.views.changed];
  const triggersToDrop = rebuilding ? baseline.triggers.map((trigger) => trigger.name) : [...diff.triggers.dropped, ...diff.triggers.changed];
  for (const name of viewsToDrop) out.push(`DROP VIEW IF EXISTS ${quoteSqlIdentifier(name)};`);
  for (const name of triggersToDrop) out.push(`DROP TRIGGER IF EXISTS ${quoteSqlIdentifier(name)};`);
  const baselineIndex = new Map(baseline.indexes.map((index) => [sqlIdentifierKey(index.name), index]));
  for (const name of [...diff.indexes.dropped, ...diff.indexes.changed]) {
    if (rebuilt.has(sqlIdentifierKey(baselineIndex.get(sqlIdentifierKey(name))?.table ?? ""))) continue;
    out.push(`DROP INDEX IF EXISTS ${quoteSqlIdentifier(name)};`);
  }

  for (const table of orderTablesByForeignKeys(desired.tables.filter((candidate) => created.has(sqlIdentifierKey(candidate.name)))))
    out.push(createStatement(table.sql));

  for (const change of diff.tables) {
    if (change.kind !== "alter" || rebuilt.has(sqlIdentifierKey(change.name))) continue;
    for (const name of change.dropped) out.push(`ALTER TABLE ${quoteSqlIdentifier(change.name)} DROP COLUMN ${quoteSqlIdentifier(name)};`);
    for (const column of change.added) out.push(`ALTER TABLE ${quoteSqlIdentifier(change.name)} ADD COLUMN ${column.definitionSource};`);
  }

  if (rebuilding) {
    const ordered = orderTablesByForeignKeys(
      closure.map((name) => desiredTable.get(sqlIdentifierKey(name))).filter((found): found is SchemaTable => found !== undefined),
    );
    for (const table of ordered) {
      const parts = splitCreateTableBody(table.sql);
      const replacement = quoteSqlIdentifier(`${REBUILD_TABLE_PREFIX}${table.name}`);
      out.push(createStatement(`CREATE TABLE ${replacement} ${repointReferences(table.sql.slice(parts.open), rebuilt)}`));
      const was = baselineTable.get(sqlIdentifierKey(table.name));
      const before = new Set((was?.columns ?? []).filter((column) => column.hidden === 0).map((column) => sqlIdentifierKey(column.name)));
      const columns = table.columns
        .filter((column) => column.hidden === 0 && before.has(sqlIdentifierKey(column.name)))
        .map((column) => quoteSqlIdentifier(column.name));
      if (columns.length > 0)
        out.push(`INSERT INTO ${replacement} (${columns.join(", ")}) SELECT ${columns.join(", ")} FROM ${quoteSqlIdentifier(table.name)};`);
    }
    // Children first: a table with no remaining referrer is dropped without a FOREIGN KEY action firing into anything.
    for (const table of [...ordered].reverse()) out.push(`DROP TABLE ${quoteSqlIdentifier(table.name)};`);
    for (const table of ordered)
      out.push(`ALTER TABLE ${quoteSqlIdentifier(`${REBUILD_TABLE_PREFIX}${table.name}`)} RENAME TO ${quoteSqlIdentifier(table.name)};`);
  }

  // After the rebuilds, so nothing still references a dropped table when its rows go; children first among the dropped themselves.
  for (const table of orderTablesByForeignKeys(baseline.tables.filter((candidate) => dropped.has(sqlIdentifierKey(candidate.name)))).reverse())
    out.push(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(table.name)};`);

  const wantIndex = new Set([...diff.indexes.created, ...diff.indexes.changed].map(sqlIdentifierKey));
  for (const index of desired.indexes) {
    const want =
      wantIndex.has(sqlIdentifierKey(index.name)) || created.has(sqlIdentifierKey(index.table)) || rebuilt.has(sqlIdentifierKey(index.table));
    if (want) out.push(createStatement(index.sql));
  }
  const wantTrigger = new Set(
    (rebuilding ? desired.triggers.map((trigger) => trigger.name) : [...diff.triggers.created, ...diff.triggers.changed]).map(sqlIdentifierKey),
  );
  for (const trigger of desired.triggers) {
    if (wantTrigger.has(sqlIdentifierKey(trigger.name)) || created.has(sqlIdentifierKey(trigger.table))) out.push(createStatement(trigger.sql));
  }
  const wantView = new Set(
    (rebuilding ? desired.views.map((view) => view.name) : [...diff.views.created, ...diff.views.changed]).map(sqlIdentifierKey),
  );
  for (const view of desired.views) if (wantView.has(sqlIdentifierKey(view.name))) out.push(createStatement(view.sql));

  if (out.length === 0) return "";
  return `PRAGMA defer_foreign_keys = true;\n\n${out.join("\n\n")}\n`;
}
