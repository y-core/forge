import { CliError } from "../cli/errors";
import { isRemotePlace, wranglerPlaceFlags } from "./target";
import type { DbIo, Home, Spawned } from "./types";

/** Runs `wrangler d1 <args>` against a home, returning both streams and the exit code. @internal */
export function runWrangler(io: DbIo, home: Home, args: readonly string[]): Spawned {
  return io.spawn("wrangler", ["d1", ...args], { cwd: home.dir });
}

function failed(what: string, home: Home, run: Spawned): CliError {
  const detail = `${run.stderr.trim()}\n${run.stdout.trim()}`.trim().slice(0, 4000);
  return new CliError("external", `${what} against ${home.label} (${home.database}) failed (exit ${run.code})${detail ? `:\n${detail}` : ""}`);
}

function failedInProcess(what: string, home: Home, error: unknown): CliError {
  const detail = (error instanceof Error ? error.message : String(error)).trim().slice(0, 4000);
  return new CliError("external", `${what} against ${home.label} (${home.database}) failed${detail ? `:\n${detail}` : ""}`);
}

/** The JSON payload wrangler wrote, skipping a banner ahead of it and anything — an update notice, say — printed after it. */
function parseJsonOutput(what: string, home: Home, stdout: string): unknown {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => /^\s*[[{]/.test(line));
  const shown = stdout.trim().slice(0, 2000);
  if (start === -1) throw new CliError("external", `${what} against ${home.label} (${home.database}) printed no JSON:\n${shown}`);
  let detail = "";
  for (let end = lines.length; end > start; end--) {
    try {
      return JSON.parse(lines.slice(start, end).join("\n"));
    } catch (error) {
      detail ||= error instanceof Error ? error.message : String(error);
    }
  }
  throw new CliError("external", `${what} against ${home.label} (${home.database}) printed JSON this tool cannot read (${detail}):\n${shown}`);
}

/** Statements against a deployed database, chunked so no `--command` exceeds one argv string. */
function queryDeployed(io: DbIo, home: Home, statements: readonly string[], budget: number): Record<string, unknown>[][] {
  const rows: Record<string, unknown>[][] = [];
  for (const chunk of commandChunks(statements, budget)) {
    const command = chunk.join("\n");
    const what = `query \`${command.slice(0, 120)}\``;
    const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--json", "--command", command]);
    if (run.code !== 0) throw failed(what, home, run);
    const payload = parseJsonOutput(what, home, run.stdout) as { results?: Record<string, unknown>[] }[];
    if (payload.length !== chunk.length) {
      throw new CliError("external", `wrangler answered ${payload.length} result set(s) for ${chunk.length} statements against ${home.label}`);
    }
    rows.push(...payload.map((entry) => entry.results ?? []));
  }
  return rows;
}

/** Statements against a home, wherever it lives: in process for a local one, through the CLI for a deployed one. */
async function runD1(
  io: DbIo,
  home: Home,
  statements: readonly string[],
  what: string,
  budget: number = COMMAND_BUDGET,
): Promise<Record<string, unknown>[][]> {
  if (statements.length === 0) return [];
  if (isRemotePlace(home.place)) return queryDeployed(io, home, statements, budget);
  try {
    return await io.d1(home, statements);
  } catch (error) {
    throw error instanceof CliError && error.kind === "invalid-args" ? error : failedInProcess(what, home, error);
  }
}

// The cap is on one argv string, not on the query: a `--command` over the kernel's MAX_ARG_STRLEN —
// 131,072 bytes here — fails at spawn with E2BIG. It bounds the deployed path alone: locally there is no argv.
const COMMAND_BUDGET = 65_536;

/** One statement against a home, as rows. Throws on failure: every caller's next step needs the answer. @internal */
export async function queryRows(io: DbIo, home: Home, statement: string): Promise<Record<string, unknown>[]> {
  const what = `query \`${statement.slice(0, 120)}\``;
  // One statement goes to a deployed database as it was written, never through `commandChunks`,
  // which terminates it: the statement is the whole `--command`, so there is nothing to separate.
  if (isRemotePlace(home.place)) {
    const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--json", "--command", statement]);
    if (run.code !== 0) throw failed(what, home, run);
    const payload = parseJsonOutput(what, home, run.stdout) as { results?: Record<string, unknown>[] }[];
    return payload[0]?.results ?? [];
  }
  return (await runD1(io, home, [statement], what))[0] ?? [];
}

/** Several statements in one round trip, returning each statement's rows in order. @internal */
export async function queryBatches(
  io: DbIo,
  home: Home,
  statements: readonly string[],
  budget: number = COMMAND_BUDGET,
): Promise<Record<string, unknown>[][]> {
  const rows = await runD1(io, home, statements, `query \`${statements.join("\n").slice(0, 120)}\``, budget);
  // Each element is one statement, and the port splits a multi-statement one: a caller packing two
  // into an element would shift every index after it, and read another statement's rows as its own.
  if (rows.length !== statements.length) {
    const port = isRemotePlace(home.place) ? "wrangler" : "the in-process d1 binding";
    throw new CliError("external", `${port} answered ${rows.length} result set(s) for ${statements.length} statements against ${home.label}`);
  }
  return rows;
}

/** Terminated statements packed into `--command`-sized groups; one longer than the budget rides alone rather than being split. */
function commandChunks(statements: readonly string[], budget: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const statement of statements) {
    const text = statement.trim().endsWith(";") ? statement.trim() : `${statement.trim()};`;
    if (current.length > 0 && length + text.length + 1 > budget) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(text);
    length += text.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
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
  if (!isRemotePlace(home.place)) {
    await runD1(io, home, [statement], `execute \`${statement.slice(0, 120)}\``);
    return;
  }
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--yes", "--command", statement]);
  if (run.code !== 0) throw failed(`execute \`${statement.slice(0, 120)}\``, home, run);
}

/** Loads a `.sql` file, applying in one transaction, all or nothing. @internal */
export async function executeFile(io: DbIo, home: Home, file: string): Promise<void> {
  if (!isRemotePlace(home.place)) {
    await runD1(io, home, [io.readText(file)], `loading ${file}`);
    return;
  }
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--yes", "--file", file]);
  if (run.code !== 0) throw failed(`loading ${file}`, home, run);
}

/** `wrangler d1 export` against any place, the one command with no `--persist-to`: it resolves local state from the config's directory, so it is run there. @internal */
export async function exportSql(io: DbIo, home: Home, output: string, extra: readonly string[]): Promise<void> {
  // The handle is released first: it may hold committed state a separate wrangler process cannot see.
  if (home.persistTo !== null) await io.closeD1(home);
  const placeFlags = home.place === "remote" ? ["--remote"] : home.place === "preview" ? ["--remote", "--preview"] : ["--local"];
  const envFlags = home.env === null ? [] : ["-e", home.env];
  const run = runWrangler(io, home, ["export", home.database, "-c", home.configPath, ...envFlags, ...placeFlags, "--output", output, ...extra]);
  if (run.code !== 0) throw failed("export", home, run);
}

/** The installed wrangler's version, recorded in a backup manifest because its escaping is part of the artifact. @internal */
export function wranglerVersion(io: DbIo, home: Home): string {
  const run = io.spawn("wrangler", ["--version"], { cwd: home.dir });
  return run.code === 0 ? (run.stdout.trim().split("\n").pop() ?? "unknown") : "unknown";
}
