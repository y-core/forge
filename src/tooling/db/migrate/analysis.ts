import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { wranglerHistoryTable } from "../config";
import { diffSchemaModels } from "../schema/diff";
import { parseMigrationHeader } from "../schema/header";
import { readSchemaModel } from "../schema/introspect";
import { scanSql, sqlIdentifierEquals, sqlIdentifierKey, unquoteSqlIdentifier } from "../schema/normalize";
import { composeScratchHome } from "../schema/scratch";
import type { SchemaModel, SchemaRename, SchemaTable, ScratchSide } from "../schema/types";
import { quoteSqlIdentifier } from "../sql";
import type { DbRunContext, Home, Migration, SchemaObject } from "../types";
import { executeFile } from "../wrangler";
import { applyMigrations } from "./applier";
import { isManagedObject } from "./fingerprint";
import type { MigrationChange, MigrationFinding } from "./types";

const COPY_ORDER = ["table", "index", "view", "trigger"];
const APPROVAL_LINE = /^-- forge:(drops|renames)(?:\s|$)/;
const VIRTUAL_TABLE = /^\s*CREATE\s+VIRTUAL\s+TABLE\b/i;

const errorDetail = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function describeTarget(run: DbRunContext): string {
  return `${run.home.database} (${run.config.target.place})`;
}

function copiedStatements(run: DbRunContext, inventory: readonly SchemaObject[]): string[] {
  const history = sqlIdentifierKey(wranglerHistoryTable(run.config));
  const owned = (name: string) => !isManagedObject(name) && sqlIdentifierKey(name) !== history;
  return inventory
    .filter((row) => row.sql !== null && COPY_ORDER.includes(row.type) && owned(row.name) && owned(row.tblName))
    .toSorted((a, b) => COPY_ORDER.indexOf(a.type) - COPY_ORDER.indexOf(b.type))
    .map((row) => (row.sql ?? "").trim().replace(/;?$/, ";"));
}

/** A fresh local scratch database holding the target's own schema, rebuilt from the sqlite_master inventory the caller read from it. @internal */
export async function copyTargetSchema(
  run: DbRunContext,
  inventory: readonly SchemaObject[],
  side: Extract<ScratchSide, "analysis" | "seed">,
): Promise<Home> {
  const virtual = inventory.find((row) => row.type === "table" && VIRTUAL_TABLE.test(row.sql ?? ""));
  if (virtual !== undefined) {
    throw new CliError(
      "invalid-args",
      `${virtual.name} in ${describeTarget(run)} is a virtual table, which no schema model describes — the migration analysis cannot judge a migration against it`,
    );
  }
  const statements = copiedStatements(run, inventory);
  const home = await composeScratchHome(run, side);
  if (statements.length === 0) return home;
  const file = join(home.dir, "target.sql");
  run.io.writeText(file, statements.join("\n\n"));
  try {
    await executeFile(run.io, home, file);
  } catch (error) {
    throw new CliError(
      "invalid-args",
      `the schema of ${describeTarget(run)} does not rebuild on a scratch database, so the migration analysis cannot start:\n${errorDetail(error)}`,
    );
  }
  return home;
}

function parseApprovalLine(migration: Migration, line: string): MigrationChange {
  const action = APPROVAL_LINE.exec(line)?.[1] === "drops" ? "drops" : "renames";
  const tokens = scanSql(line.slice(`-- forge:${action}`.length)).filter((token) => token.kind !== "space");
  const refuse = () =>
    new CliError("invalid-args", `${migration.name}: \`${line}\` is not a forge:${action} line compose writes — compose the migration again`);
  const names = tokens.filter((token) => token.kind === "identifier");
  if (!names.every((token) => token.text.startsWith('"'))) throw refuse();
  const [kind, first, second, third, fourth] = tokens;
  const name = (token: typeof first) => (token?.kind === "identifier" ? unquoteSqlIdentifier(token.text) : null);
  const word = kind?.kind === "word" ? kind.text.toLowerCase() : null;
  const dotted = second?.kind === "punct" && second.text === ".";
  if (action === "drops") {
    if ((word === "table" || word === "view") && tokens.length === 2) {
      const dropped = name(first);
      if (dropped !== null) return { action, object: { type: word, name: dropped } };
    }
    if (word === "column" && tokens.length === 4 && dotted) {
      const [table, dropped] = [name(first), name(third)];
      if (table !== null && dropped !== null) return { action, object: { type: "column", table, name: dropped } };
    }
    throw refuse();
  }
  if (word === "table" && tokens.length === 3) {
    const [from, to] = [name(first), name(second)];
    if (from !== null && to !== null) return { action, rename: { kind: "table", from, to } };
  }
  if (word === "column" && tokens.length === 5 && dotted) {
    const [table, from, to] = [name(first), name(third), name(fourth)];
    if (table !== null && from !== null && to !== null) return { action, rename: { kind: "column", table, from, to } };
  }
  throw refuse();
}

/** The drops and renames a migration's forge:drops and forge:renames lines approve, read from the comments directly under its header. @internal */
export function readApprovalLines(migration: Migration): MigrationChange[] {
  const { body } = parseMigrationHeader(migration.sql);
  const tokens = scanSql(body);
  const end = tokens.findIndex((token) => token.kind !== "space" && token.kind !== "comment");
  return (end === -1 ? tokens : tokens.slice(0, end))
    .filter((token) => token.kind === "comment" && APPROVAL_LINE.test(token.text))
    .map((token) => parseApprovalLine(migration, token.text.trimEnd()));
}

/** A drop or a rename in the words of its approval line, without the line's prefix. @internal */
export function formatMigrationChange(change: MigrationChange): string {
  if (change.action === "renames") {
    const { rename } = change;
    return rename.kind === "table"
      ? `renames table ${quoteSqlIdentifier(rename.from)} ${quoteSqlIdentifier(rename.to)}`
      : `renames column ${quoteSqlIdentifier(rename.table)}.${quoteSqlIdentifier(rename.from)} ${quoteSqlIdentifier(rename.to)}`;
  }
  const { object } = change;
  return object.type === "column"
    ? `drops column ${quoteSqlIdentifier(object.table)}.${quoteSqlIdentifier(object.name)}`
    : `drops ${object.type} ${quoteSqlIdentifier(object.name)}`;
}

/** The forge:drops or forge:renames line compose writes to approve one drop or rename. @internal */
export function formatApprovalLine(change: MigrationChange): string {
  return `-- forge:${formatMigrationChange(change)}`;
}

function approvalKey(change: MigrationChange): string {
  const parts =
    change.action === "renames"
      ? [change.rename.kind, ...(change.rename.kind === "column" ? [change.rename.table] : []), change.rename.from, change.rename.to]
      : [change.object.type, ...(change.object.type === "column" ? [change.object.table] : []), change.object.name];
  return [change.action, ...parts.map(sqlIdentifierKey)].join("\0");
}

/** Refuses a migration unless its findings and its approval lines pair one to one, naming every finding no line approves and every line no finding matches. @internal */
export function refuseUnapprovedFindings(
  run: DbRunContext,
  migration: string,
  findings: readonly MigrationFinding[],
  approvals: readonly MigrationChange[],
): void {
  const unmatched = [...approvals];
  const unapproved = findings.filter((finding) => {
    const index = unmatched.findIndex((change) => approvalKey(change) === approvalKey(finding.change));
    if (index === -1) return true;
    unmatched.splice(index, 1);
    return false;
  });
  if (unapproved.length === 0 && unmatched.length === 0) return;
  const lines = [
    ...unapproved.map((finding) => `${formatMigrationChange(finding.change)} — no \`${formatApprovalLine(finding.change)}\` line approves it`),
    ...unmatched.map((change) => `\`${formatApprovalLine(change)}\` — the file makes no such change here`),
  ];
  throw new CliError(
    "invalid-args",
    `${migration} does not match the lines compose wrote for it on ${describeTarget(run)}, so nothing was applied:\n  ${lines.join("\n  ")}\nThe target's schema is not the one the file was composed against: restore it to the schema its migrations describe, or compose again and approve the change with --allow-destructive.`,
  );
}

function describeRenamed(rename: SchemaRename): string {
  return rename.kind === "table"
    ? `table ${quoteSqlIdentifier(rename.from)}`
    : `column ${quoteSqlIdentifier(rename.table)}.${quoteSqlIdentifier(rename.from)}`;
}

function applyRenameLine(model: SchemaModel, rename: SchemaRename, migration: string): SchemaModel {
  const table = model.tables.find((candidate) => sqlIdentifierEquals(candidate.name, rename.kind === "table" ? rename.from : rename.table));
  const refuse = (problem: string) =>
    new CliError("invalid-args", `${migration}: its forge:renames line names ${describeRenamed(rename)}, ${problem} — compose the migration again`);
  if (table === undefined) throw refuse("which is not in the schema before it");
  const replace = (next: SchemaTable) => ({ ...model, tables: model.tables.map((candidate) => (candidate === table ? next : candidate)) });
  if (rename.kind === "table") {
    const taken = [...model.tables, ...model.views, ...model.indexes].some(
      (object) => object !== table && sqlIdentifierEquals(object.name, rename.to),
    );
    if (taken) throw refuse(`whose new name ${quoteSqlIdentifier(rename.to)} the schema before it already holds`);
    return replace({ ...table, name: rename.to });
  }
  const column = table.columns.find((candidate) => sqlIdentifierEquals(candidate.name, rename.from));
  if (column === undefined) throw refuse("which is not in the schema before it");
  if (table.columns.some((candidate) => candidate !== column && sqlIdentifierEquals(candidate.name, rename.to))) {
    throw refuse(`whose new name ${quoteSqlIdentifier(rename.to)} the schema before it already holds`);
  }
  return replace({ ...table, columns: table.columns.map((candidate) => (candidate === column ? { ...column, name: rename.to } : candidate)) });
}

function applyRenameLines(
  before: SchemaModel,
  renames: readonly SchemaRename[],
  migration: string,
): { renamed: SchemaModel; preFile: (name: string) => string } {
  const origins = new Map<string, string>();
  let renamed = before;
  for (const rename of renames) {
    const current = renamed.tables.find((table) => rename.kind === "table" && sqlIdentifierEquals(table.name, rename.from))?.name;
    renamed = applyRenameLine(renamed, rename, migration);
    if (rename.kind !== "table" || current === undefined) continue;
    origins.set(sqlIdentifierKey(rename.to), origins.get(sqlIdentifierKey(current)) ?? current);
    if (!sqlIdentifierEquals(current, rename.to)) origins.delete(sqlIdentifierKey(current));
  }
  return { renamed, preFile: (name) => origins.get(sqlIdentifierKey(name)) ?? name };
}

/** The drops and renames one migration makes, from the schema before it, with its renames applied, diffed against the schema after it. @internal */
export function migrationFindings(
  before: SchemaModel,
  after: SchemaModel,
  renames: readonly SchemaRename[],
  migration: string,
): MigrationFinding[] {
  const { renamed, preFile } = applyRenameLines(before, renames, migration);
  const diff = diffSchemaModels(renamed, after);
  const tables = new Map(renamed.tables.map((table) => [sqlIdentifierKey(table.name), table]));
  const finding = (severity: MigrationFinding["severity"], change: MigrationChange): MigrationFinding => ({ migration, severity, change });
  const droppedTables = diff.tables.flatMap((change) =>
    change.kind === "drop" ? [finding("destructive", { action: "drops", object: { type: "table", name: preFile(change.name) } })] : [],
  );
  const droppedColumns = diff.tables.flatMap((change) => {
    if (change.kind !== "alter" && change.kind !== "rebuild") return [];
    const columns = tables.get(sqlIdentifierKey(change.name))?.columns ?? [];
    return change.dropped.map((name) => {
      const hidden = columns.find((column) => sqlIdentifierEquals(column.name, name))?.hidden;
      return finding(hidden === 2 ? "incompatible" : "destructive", {
        action: "drops",
        object: { type: "column", table: preFile(change.name), name },
      });
    });
  });
  const droppedViews = diff.views.dropped.map((name) => finding("incompatible", { action: "drops", object: { type: "view", name } }));
  const renamedObjects = renames.map((rename) => finding("incompatible", { action: "renames", rename }));
  return [...droppedTables, ...droppedColumns, ...droppedViews, ...renamedObjects];
}

/** Applies each pending migration in order to a scratch copy of the target's schema, from the inventory the caller read, and reports every drop and rename, refusing one its lines do not approve. @internal */
export async function analyseMigrations(
  run: DbRunContext,
  pending: readonly Migration[],
  inventory: readonly SchemaObject[],
): Promise<MigrationFinding[]> {
  if (pending.length === 0) return [];
  const home = await copyTargetSchema(run, inventory, "analysis");
  const findings: MigrationFinding[] = [];
  let before = await readSchemaModel(run.io, home);
  for (const migration of pending) {
    const approvals = readApprovalLines(migration);
    const renames = approvals.flatMap((change) => (change.action === "renames" ? [change.rename] : []));
    try {
      await applyMigrations(run, home, [migration], { label: join("compose", "analysis"), record: false });
    } catch (error) {
      const target = describeTarget(run);
      throw new CliError(
        "invalid-args",
        `${migration.name} does not apply to a copy of ${target}'s schema, so it would fail there too — nothing was applied to ${run.home.database}:\n${errorDetail(error)}`,
      );
    }
    const after = await readSchemaModel(run.io, home);
    const found = migrationFindings(before, after, renames, migration.name);
    refuseUnapprovedFindings(run, migration.name, found, approvals);
    findings.push(...found);
    before = after;
  }
  return findings;
}
