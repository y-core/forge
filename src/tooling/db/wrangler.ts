import { CliError } from "../cli/errors";
import { wranglerPlaceFlags } from "./target";
import type { DbIo, Home, Spawned } from "./types";

/** Runs `wrangler d1 <args>` against a home, returning both streams and the exit code. @internal */
export function runWrangler(io: DbIo, home: Home, args: readonly string[]): Spawned {
  return io.spawn("wrangler", ["d1", ...args], { cwd: home.dir });
}

function failed(what: string, home: Home, run: Spawned): CliError {
  const detail = `${run.stderr.trim()}\n${run.stdout.trim()}`.trim().slice(0, 4000);
  return new CliError("external", `${what} against ${home.label} (${home.database}) failed (exit ${run.code})${detail ? `:\n${detail}` : ""}`);
}

/** The JSON payload wrangler wrote, skipping any banner it printed ahead of it. */
function parseJsonOutput(what: string, home: Home, stdout: string): unknown {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => /^\s*[[{]/.test(line));
  const shown = stdout.trim().slice(0, 2000);
  if (start === -1) throw new CliError("external", `${what} against ${home.label} (${home.database}) printed no JSON:\n${shown}`);
  try {
    return JSON.parse(lines.slice(start).join("\n"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError("external", `${what} against ${home.label} (${home.database}) printed JSON this tool cannot read (${detail}):\n${shown}`);
  }
}

/** One statement against a home, as rows. Throws on failure: every caller's next step needs the answer. @internal */
export function queryRows(io: DbIo, home: Home, statement: string): Record<string, unknown>[] {
  const what = `query \`${statement.slice(0, 120)}\``;
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--json", "--command", statement]);
  if (run.code !== 0) throw failed(what, home, run);
  const payload = parseJsonOutput(what, home, run.stdout) as { results?: Record<string, unknown>[] }[];
  return payload[0]?.results ?? [];
}

// The cap is on one argv string, not on the query: a single `--command` over the kernel's
// MAX_ARG_STRLEN — measured at 131,072 bytes here — fails at spawn with E2BIG, before wrangler sees a
// byte of it. Half of that leaves room for the longest single statement a chunk may carry alongside
// others.
const COMMAND_BUDGET = 65_536;

/** Several statements in one spawn, returning each statement's rows in order — five reads for the price of one process. @internal */
export function queryBatches(io: DbIo, home: Home, statements: readonly string[], budget: number = COMMAND_BUDGET): Record<string, unknown>[][] {
  const rows: Record<string, unknown>[][] = [];
  for (const chunk of commandChunks(statements, budget)) {
    const command = chunk.join("\n");
    const what = `query \`${command.slice(0, 120)}\``;
    const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--json", "--command", command]);
    if (run.code !== 0) throw failed(what, home, run);
    const payload = parseJsonOutput(what, home, run.stdout) as { results?: Record<string, unknown>[] }[];
    if (payload.length !== chunk.length) {
      throw new CliError("invalid-args", `wrangler answered ${payload.length} result set(s) for ${chunk.length} statements against ${home.label}`);
    }
    rows.push(...payload.map((entry) => entry.results ?? []));
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
export function queryOne(io: DbIo, home: Home, statement: string): Record<string, unknown> {
  return queryRows(io, home, statement)[0] ?? {};
}

/** Whether `statement` fails with `no such table`, which is how an unmigrated database answers. @internal */
export function queryRowsIfTable(io: DbIo, home: Home, statement: string): Record<string, unknown>[] | null {
  const what = `query \`${statement.slice(0, 120)}\``;
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--json", "--command", statement]);
  if (run.code !== 0) {
    if (/no such table/i.test(`${run.stderr}\n${run.stdout}`)) return null;
    throw failed(what, home, run);
  }
  const payload = parseJsonOutput(what, home, run.stdout) as { results?: Record<string, unknown>[] }[];
  return payload[0]?.results ?? [];
}

/** Runs statements with no result to read. @internal */
export function executeSql(io: DbIo, home: Home, statement: string): void {
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--yes", "--command", statement]);
  if (run.code !== 0) throw failed(`execute \`${statement.slice(0, 120)}\``, home, run);
}

/**
 * Loads a `.sql` file. A local `--file` is applied in one transaction, all or nothing.
 *
 * **A file declaring schema is bounded where one carrying only rows is not, which is why a backup
 * artifact is two files rather than one.** Wrangler cannot prepare a payload that declares schema
 * statement by statement, so it hands the whole file to miniflare's `exec`, which refuses anything over
 * 102,400 bytes with `SQLITE_TOOBIG` — measured against wrangler 4.118 and 4.131, and again at 4.131.2
 * on a 4.2 MB dump. A data-only file takes the prepared path and has loaded the same 4.2 MB in one spawn
 * all along, so route `full` loads `schema.sql` and then `data.sql`.
 * @internal
 */
export function executeFile(io: DbIo, home: Home, file: string): void {
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--yes", "--file", file]);
  if (run.code !== 0) throw failed(`loading ${file}`, home, run);
}

/** `wrangler d1 export` against any place, the one command with no `--persist-to`: it resolves local state from the config's directory, so it is run there. @internal */
export function exportSql(io: DbIo, home: Home, output: string, extra: readonly string[]): void {
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
