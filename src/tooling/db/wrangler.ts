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

/** Several statements in one spawn, returning each statement's rows in order — five reads for the price of one process. @internal */
export function queryBatches(io: DbIo, home: Home, statements: readonly string[]): Record<string, unknown>[][] {
  const command = statements.map((statement) => (statement.trim().endsWith(";") ? statement.trim() : `${statement.trim()};`)).join("\n");
  const what = `query \`${command.slice(0, 120)}\``;
  const run = runWrangler(io, home, ["execute", home.database, ...wranglerPlaceFlags(home), "--json", "--command", command]);
  if (run.code !== 0) throw failed(what, home, run);
  const payload = parseJsonOutput(what, home, run.stdout) as { results?: Record<string, unknown>[] }[];
  if (payload.length !== statements.length) {
    throw new CliError(
      "invalid-args",
      `wrangler answered ${payload.length} result set(s) for ${statements.length} statements against ${home.label}`,
    );
  }
  return payload.map((entry) => entry.results ?? []);
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

/** Loads a `.sql` file. A local `--file` is applied in one transaction, all or nothing. @internal */
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
