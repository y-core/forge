import { CliError } from "../../cli/errors";
import { sha256 } from "../digest";
import { mentionsSqlIdentifier, sqlIdentifierEquals, sqlIdentifierKey } from "./normalize";
import type { NamedChanges, RebuildReason, SchemaColumn, SchemaDiff, SchemaModel, SchemaRename, SchemaTable, TableChange } from "./types";

const RENAME = /^([^.:]+)(?:\.([^.:]+))?:([^.:]+)$/;

/** Parses one `--rename`: `old:new` for a table, `table.old:new` for a column. @internal */
export function parseSchemaRename(spec: string): SchemaRename {
  const match = RENAME.exec(spec.trim());
  if (match === null) throw new CliError("invalid-args", `--rename ${spec} is not \`table:new\` or \`table.column:new\``);
  const [, first, column, to] = match;
  if (column === undefined) return { kind: "table", from: first ?? "", to: to ?? "" };
  return { kind: "column", table: first ?? "", from: column, to: to ?? "" };
}

/** Why the renames cannot apply to this baseline — a `from` that is not there — or nothing. @internal */
export function checkSchemaRenames(baseline: SchemaModel, renames: readonly SchemaRename[]): string[] {
  const problems: string[] = [];
  for (const rename of renames) {
    if (rename.kind === "table") {
      if (!baseline.tables.some((table) => sqlIdentifierEquals(table.name, rename.from))) {
        problems.push(`--rename ${rename.from}:${rename.to} names no table \`${rename.from}\` in the baseline — already renamed, so drop the flag`);
      }
      continue;
    }
    const table = baseline.tables.find((candidate) => sqlIdentifierEquals(candidate.name, rename.table));
    if (table === undefined) {
      problems.push(`--rename ${rename.table}.${rename.from}:${rename.to} names no table \`${rename.table}\` in the baseline`);
    } else if (!table.columns.some((column) => sqlIdentifierEquals(column.name, rename.from))) {
      problems.push(
        `--rename ${rename.table}.${rename.from}:${rename.to} names no column \`${rename.from}\` on \`${rename.table}\` — already renamed, so drop the flag`,
      );
    }
  }
  return problems;
}

/** Why SQLite would refuse `ALTER TABLE … ADD COLUMN` for this column, or null when it would accept it. @internal */
export function refuseAddColumn(column: SchemaColumn): string | null {
  const d = column.definition;
  if (/\bPRIMARY KEY\b/.test(d)) return "a PRIMARY KEY column cannot be added";
  if (/\bUNIQUE\b/.test(d)) return "a UNIQUE column cannot be added";
  if (/\bNOT NULL\b/.test(d) && !/\bDEFAULT\b/.test(d)) return "a NOT NULL column with no DEFAULT cannot be added";
  if (/\bNOT NULL\b/.test(d) && /\bDEFAULT\s+NULL\b/.test(d)) return "a NOT NULL column whose DEFAULT is NULL cannot be added";
  if (/\bDEFAULT\s*\(/.test(d) || /\bDEFAULT\s+CURRENT_(TIME|DATE|TIMESTAMP)\b/.test(d))
    return "a column whose DEFAULT is not a constant cannot be added";
  if (/\bREFERENCES\b/.test(d) && /\bDEFAULT\b/.test(d) && !/\bDEFAULT\s+NULL\b/.test(d))
    return "a REFERENCES column whose DEFAULT is not NULL cannot be added";
  if (/\bSTORED\b/.test(d) && /\bAS\s*\(/.test(d)) return "a STORED generated column cannot be added";
  return null;
}

/** Why SQLite would refuse `ALTER TABLE … DROP COLUMN` for this column, or null when it would accept it. @internal */
export function refuseDropColumn(table: SchemaTable, name: string, model: SchemaModel): string | null {
  const column = table.columns.find((candidate) => sqlIdentifierEquals(candidate.name, name));
  if (column === undefined) return null;
  if (column.pk > 0) return "a PRIMARY KEY column cannot be dropped";
  if (column.hidden !== 0) return "a generated column cannot be dropped";
  if (/\bUNIQUE\b/.test(column.definition)) return "a UNIQUE column cannot be dropped";
  const index = model.indexes.find(
    (candidate) =>
      sqlIdentifierEquals(candidate.table, table.name) &&
      (candidate.columns.some((covered) => sqlIdentifierEquals(covered, name)) || mentionsSqlIdentifier(candidate.normalized, name)),
  );
  if (index !== undefined) return `index ${index.name} covers it`;
  if (table.foreignKeys.some((fk) => fk.from.some((from) => sqlIdentifierEquals(from, name)))) return "a FOREIGN KEY column cannot be dropped";
  const constraint = table.constraints.find((text) => mentionsSqlIdentifier(text, name));
  if (constraint !== undefined) return `a table constraint names it: ${constraint}`;
  const trigger = model.triggers.find((candidate) => mentionsSqlIdentifier(candidate.normalized, name));
  if (trigger !== undefined) return `trigger ${trigger.name} names it`;
  const view = model.views.find((candidate) => mentionsSqlIdentifier(candidate.normalized, name));
  if (view !== undefined) return `view ${view.name} names it`;
  return null;
}

// Every name is keyed the way SQLite resolves one, so a schema file that only changes an
// identifier's case matches the object already there rather than reading as a drop and a create.
function namedChanges<T extends { name: string; normalized: string }>(baseline: readonly T[], desired: readonly T[]): NamedChanges {
  const before = new Map(baseline.map((item) => [sqlIdentifierKey(item.name), item]));
  const after = new Map(desired.map((item) => [sqlIdentifierKey(item.name), item]));
  const key = (item: T) => sqlIdentifierKey(item.name);
  return {
    created: desired.filter((item) => !before.has(key(item))).map((item) => item.name),
    dropped: baseline.filter((item) => !after.has(key(item))).map((item) => item.name),
    changed: desired.filter((item) => before.has(key(item)) && before.get(key(item))?.normalized !== item.normalized).map((item) => item.name),
  };
}

const REHEARSE = "rehearse it on `standby` first";
const TABLE_CHECK = /^(CONSTRAINT \S+ )?CHECK\s*\(/i;

/** Each column-level CHECK clause in a normalized column definition, to its balanced close paren. */
function checksOf(definition: string): string[] {
  const out: string[] = [];
  const pattern = /\bCHECK\s*\(/gi;
  for (let match = pattern.exec(definition); match !== null; match = pattern.exec(definition)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < definition.length; i += 1) {
      if (definition[i] === "(") depth += 1;
      else if (definition[i] === ")" && (depth -= 1) === 0) {
        out.push(definition.slice(match.index, i + 1));
        pattern.lastIndex = i + 1;
        break;
      }
    }
  }
  return out;
}

const typeKey = (type: string) => type.toUpperCase().replace(/\s+/g, " ").trim();

/** What a rebuild of this table asks of the rows already in it, which the proof on an empty replay cannot see. */
function dataDependentLines(baseline: SchemaTable, desired: SchemaTable, common: readonly string[]): string[] {
  const before = new Map(baseline.columns.map((column) => [sqlIdentifierKey(column.name), column]));
  const after = new Map(desired.columns.map((column) => [sqlIdentifierKey(column.name), column]));
  const table = desired.name;
  const lines: string[] = [];
  for (const key of common) {
    const b = before.get(key);
    const a = after.get(key);
    if (b === undefined || a === undefined || a.hidden !== 0) continue;
    if (!b.notnull && a.notnull) {
      const filled = a.defaultExpr === null ? "" : " (the DEFAULT does not fill it in)";
      lines.push(
        `${table}.${a.name} becomes NOT NULL — the rebuild copies existing rows as they are, so one holding NULL fails it${filled}; ${REHEARSE}`,
      );
    }
    const had = checksOf(b.definition);
    for (const check of checksOf(a.definition)) {
      if (!had.includes(check)) lines.push(`${table}.${a.name} gains ${check} — every existing value must already satisfy it; ${REHEARSE}`);
    }
    if (desired.strict && typeKey(b.type) !== typeKey(a.type)) {
      lines.push(
        `${table}.${a.name} changes type from ${b.type} to ${a.type} on a STRICT table — every existing value must already be ${a.type}; ${REHEARSE}`,
      );
    }
  }
  for (const check of desired.constraints.filter((c) => TABLE_CHECK.test(c) && !baseline.constraints.includes(c))) {
    lines.push(`${table} gains ${check} — every existing row must already satisfy it; ${REHEARSE}`);
  }
  if (!baseline.strict && desired.strict) {
    lines.push(`${table} becomes STRICT — every existing value must already match its column's declared type; ${REHEARSE}`);
  }
  return lines;
}

function compareTable(
  baseline: SchemaTable,
  desired: SchemaTable,
  baselineModel: SchemaModel,
  refusals: string[],
  dataDependent: string[],
): TableChange | null {
  const before = new Map(baseline.columns.map((column) => [sqlIdentifierKey(column.name), column]));
  const after = new Map(desired.columns.map((column) => [sqlIdentifierKey(column.name), column]));
  const added = desired.columns.filter((column) => !before.has(sqlIdentifierKey(column.name)));
  const dropped = baseline.columns.filter((column) => !after.has(sqlIdentifierKey(column.name))).map((column) => column.name);
  const common = baseline.columns.filter((column) => after.has(sqlIdentifierKey(column.name))).map((column) => sqlIdentifierKey(column.name));
  const commonAfter = desired.columns.filter((column) => before.has(sqlIdentifierKey(column.name))).map((column) => sqlIdentifierKey(column.name));

  const reasons: RebuildReason[] = [];
  if (common.some((key) => before.get(key)?.definition !== after.get(key)?.definition)) reasons.push("column-changed");
  const lastCommon =
    commonAfter.length === 0 ? -1 : desired.columns.findIndex((column) => sqlIdentifierKey(column.name) === commonAfter[commonAfter.length - 1]);
  if (common.join("\0") !== commonAfter.join("\0") || added.some((column) => desired.columns.indexOf(column) < lastCommon))
    reasons.push("reordered");
  if (baseline.constraints.join("\0") !== desired.constraints.join("\0")) reasons.push("constraints-changed");
  if (baseline.strict !== desired.strict || baseline.withoutRowid !== desired.withoutRowid) reasons.push("options-changed");
  if (added.some((column) => refuseAddColumn(column) !== null)) reasons.push("add-column-unsupported");
  if (dropped.some((name) => refuseDropColumn(baseline, name, baselineModel) !== null)) reasons.push("drop-column-unsupported");

  for (const column of added) {
    if (/\bNOT NULL\b/.test(column.definition) && !/\bDEFAULT\b/.test(column.definition) && column.hidden === 0) {
      refusals.push(
        `${desired.name}.${column.name} is NOT NULL with no DEFAULT on a table that already exists — give it a DEFAULT, or add it in a \`--custom\` migration that fills it`,
      );
    }
  }

  if (reasons.length === 0 && added.length === 0 && dropped.length === 0) return null;
  if (reasons.length === 0) return { kind: "alter", name: desired.name, added, dropped };
  dataDependent.push(...dataDependentLines(baseline, desired, common));
  return { kind: "rebuild", name: desired.name, reasons, dropped };
}

/** Everything that separates the baseline from the desired model, table by table and object by object. @internal */
export function diffSchemaModels(baseline: SchemaModel, desired: SchemaModel): SchemaDiff {
  const before = new Map(baseline.tables.map((table) => [sqlIdentifierKey(table.name), table]));
  const after = new Map(desired.tables.map((table) => [sqlIdentifierKey(table.name), table]));
  const tables: TableChange[] = [];
  const refusals: string[] = [];
  const destructive: string[] = [];
  const dataDependent: string[] = [];

  for (const table of desired.tables) {
    const was = before.get(sqlIdentifierKey(table.name));
    if (was === undefined) {
      tables.push({ kind: "create", name: table.name });
      continue;
    }
    const change = compareTable(was, table, baseline, refusals, dataDependent);
    if (change === null) continue;
    tables.push(change);
    if ((change.kind === "alter" || change.kind === "rebuild") && change.dropped.length > 0) {
      destructive.push(`${table.name}: drops column${change.dropped.length === 1 ? "" : "s"} ${change.dropped.join(", ")}`);
    }
  }
  const dropDependents = new Map<string, string>();
  for (const table of baseline.tables) {
    const key = sqlIdentifierKey(table.name);
    if (after.has(key)) continue;
    tables.push({ kind: "drop", name: table.name });
    // A DROP TABLE under FOREIGN KEY enforcement deletes the rows first, and ON DELETE fires into
    // every table still referencing it — so each child is rebuilt without the reference before the drop.
    const children = baseline.tables.filter(
      (child) =>
        sqlIdentifierKey(child.name) !== key &&
        after.has(sqlIdentifierKey(child.name)) &&
        child.foreignKeys.some((fk) => sqlIdentifierKey(fk.table) === key),
    );
    const dangling = children.filter((child) =>
      after.get(sqlIdentifierKey(child.name))?.foreignKeys.some((fk) => sqlIdentifierKey(fk.table) === key),
    );
    for (const child of dangling) refusals.push(`${child.name} references ${table.name}, which is dropped — remove the REFERENCES first`);
    for (const child of children) dropDependents.set(sqlIdentifierKey(child.name), child.name);
    const names = children.map((child) => child.name);
    const rebuilt =
      names.length === 0 ? "" : `; ${names.join(", ")} ${names.length === 1 ? "references it and is" : "reference it and are"} rebuilt first`;
    destructive.push(`${table.name}: drops the table${rebuilt}`);
  }

  return {
    tables,
    indexes: namedChanges(baseline.indexes, desired.indexes),
    triggers: namedChanges(baseline.triggers, desired.triggers),
    views: namedChanges(baseline.views, desired.views),
    destructive,
    refusals,
    dataDependent,
    dropDependents: [...dropDependents.values()],
  };
}

/** True when the diff would emit nothing. @internal */
export function schemaDiffIsEmpty(diff: SchemaDiff): boolean {
  const named = (changes: NamedChanges) => changes.created.length + changes.dropped.length + changes.changed.length;
  return diff.tables.length === 0 && named(diff.indexes) + named(diff.triggers) + named(diff.views) === 0;
}

/** Twelve hex characters naming one whole plan, so an approval is for exactly that plan and no other. @internal */
export function destructivePlanDigest(diff: SchemaDiff): string {
  return sha256(describeSchemaDiff(diff).join("\n")).slice(0, 12);
}

/** The diff as the lines a plan prints, one per change. @internal */
export function describeSchemaDiff(diff: SchemaDiff): string[] {
  const lines: string[] = [];
  for (const change of diff.tables) {
    if (change.kind === "create") lines.push(`create table ${change.name}`);
    else if (change.kind === "drop") lines.push(`drop table ${change.name}`);
    else if (change.kind === "alter") {
      for (const column of change.added) lines.push(`add column ${change.name}.${column.name}`);
      for (const name of change.dropped) lines.push(`drop column ${change.name}.${name}`);
    } else lines.push(`rebuild table ${change.name} (${change.reasons.join(", ")})`);
  }
  const named = (type: string, changes: NamedChanges) => {
    for (const name of changes.created) lines.push(`create ${type} ${name}`);
    for (const name of changes.changed) lines.push(`replace ${type} ${name}`);
    for (const name of changes.dropped) lines.push(`drop ${type} ${name}`);
  };
  named("index", diff.indexes);
  named("trigger", diff.triggers);
  named("view", diff.views);
  return lines;
}
