import { CliError } from "../cli/errors";
import { executeDeployed, queryDeployed } from "./remote";
import { isRemotePlace } from "./target";
import type { DbIo, Home } from "./types";

function failedInProcess(what: string, home: Home, error: unknown): CliError {
  const detail = (error instanceof Error ? error.message : String(error)).trim().slice(0, 4000);
  return new CliError("external", `${what} against ${home.label} (${home.database}) failed${detail ? `:\n${detail}` : ""}`);
}

/** Statements against a home, wherever it lives: in process for a local one, over the D1 REST API for a deployed one. */
async function runD1(io: DbIo, home: Home, statements: readonly string[], what: string): Promise<Record<string, unknown>[][]> {
  if (statements.length === 0) return [];
  if (isRemotePlace(home.place)) return queryDeployed(io, home, statements, what);
  try {
    return await io.d1(home, statements);
  } catch (error) {
    throw error instanceof CliError && error.kind === "invalid-args" ? error : failedInProcess(what, home, error);
  }
}

/** One statement against a home, as rows. Throws on failure: every caller's next step needs the answer. @internal */
export async function queryRows(io: DbIo, home: Home, statement: string): Promise<Record<string, unknown>[]> {
  return (await runD1(io, home, [statement], `query \`${statement.slice(0, 120)}\``))[0] ?? [];
}

/** Several statements in one round trip, returning each statement's rows in order. @internal */
export async function queryBatches(io: DbIo, home: Home, statements: readonly string[]): Promise<Record<string, unknown>[][]> {
  const rows = await runD1(io, home, statements, `query \`${statements.join("\n").slice(0, 120)}\``);
  // Each element is one statement, and the port splits a multi-statement one: a caller packing two
  // into an element would shift every index after it, and read another statement's rows as its own.
  if (rows.length !== statements.length) {
    const port = isRemotePlace(home.place) ? "the D1 REST API" : "the in-process d1 binding";
    throw new CliError("external", `${port} answered ${rows.length} result set(s) for ${statements.length} statements against ${home.label}`);
  }
  return rows;
}

/** A single-row, single-column read. @internal */
export async function queryOne(io: DbIo, home: Home, statement: string): Promise<Record<string, unknown>> {
  return (await queryRows(io, home, statement))[0] ?? {};
}

/** Whether `statement` fails with `no such table`, which is how an unmigrated database answers. @internal */
export async function queryRowsIfTable(io: DbIo, home: Home, statement: string): Promise<Record<string, unknown>[] | null> {
  try {
    return await queryRows(io, home, statement);
  } catch (error) {
    if (error instanceof CliError && /no such table/i.test(error.message)) return null;
    throw error;
  }
}

/** Runs statements with no result to read. @internal */
export async function executeSql(io: DbIo, home: Home, statement: string): Promise<void> {
  const what = `execute \`${statement.slice(0, 120)}\``;
  if (isRemotePlace(home.place)) {
    await executeDeployed(io, home, statement, what);
    return;
  }
  await runD1(io, home, [statement], what);
}

const COMMIT_REFUSAL = /FOREIGN KEY constraint failed|^internal error; reference = \w+$/m;
const WATCH_END = "SELECT json_extract('{}', 'forge-fk none');";
const WATCH_MARK = /forge-fk (\d+) ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")/;

/** The migration with a foreign-key check after each statement, ending in one that always fails so nothing commits. @internal */
export function foreignKeyWatch(statements: readonly string[]): string {
  const watch = (index: number) =>
    `SELECT json_extract('{}', 'forge-fk ${index} ' || json_quote("table") || ' ' || json_quote("parent")) FROM pragma_foreign_key_check LIMIT 1;`;
  return [...statements.flatMap((statement, index) => [`${statement};`, watch(index)]), WATCH_END].join("\n");
}

/** The line naming the first statement after which a row broke a foreign key, or `null` when the watch saw none. @internal */
export function describeForeignKeyWatch(message: string, statements: readonly string[]): string | null {
  const match = WATCH_MARK.exec(message);
  if (match === null) return null;
  const statement = statements[Number(match[1])];
  if (statement === undefined) return null;
  const child: unknown = JSON.parse((match[2] ?? "").replaceAll("''", "'"));
  const parent: unknown = JSON.parse((match[3] ?? "").replaceAll("''", "'"));
  return `FOREIGN KEY constraint failed: ${String(child)} first held a row with no match in ${String(parent)} after \`${statement.trim().slice(0, 120)}\``;
}

/** Replays a local load whose commit was refused under the watch, answering the line that names the violation. */
async function watchForeignKeys(io: DbIo, home: Home, sql: string): Promise<string | null> {
  const statements = await io.splitD1(home, sql);
  try {
    await io.d1(home, [foreignKeyWatch(statements)]);
    return null;
  } catch (error) {
    return describeForeignKeyWatch(error instanceof Error ? error.message : String(error), statements);
  }
}

/** Loads a `.sql` file; locally it applies in one transaction, all or nothing. @internal */
export async function executeFile(io: DbIo, home: Home, file: string): Promise<void> {
  if (!isRemotePlace(home.place)) {
    const sql = io.readText(file);
    try {
      await io.d1(home, [sql]);
    } catch (error) {
      if (error instanceof CliError && error.kind === "invalid-args") throw error;
      const detail = error instanceof Error ? error.message : String(error);
      const cause = COMMIT_REFUSAL.test(detail) ? await watchForeignKeys(io, home, sql) : null;
      throw failedInProcess(`loading ${file}`, home, cause === null ? error : `${cause}\n${detail}`);
    }
    return;
  }
  await executeDeployed(io, home, io.readText(file), `loading ${file}`);
}
