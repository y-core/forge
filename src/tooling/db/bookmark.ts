import { CliError } from "../cli/errors";
import type { Bookmark, DbConfig, DbIo, Home } from "./types";
import { runWrangler } from "./wrangler";

/** Quotes a value for a POSIX shell, so a path holding a space survives being pasted back. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function undoFlags(config: DbConfig | undefined): string {
  if (config === undefined) return "";
  const env = config.env === null ? "" : ` -e ${shellQuote(config.env)}`;
  return ` --root ${shellQuote(config.root)} --config ${shellQuote(config.configPath)} --db ${shellQuote(config.entry.binding)}${env}`;
}

const BOOKMARK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const TIMESTAMP = /^(\d{1,10}|\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)$/;

/** Holds a Time Travel point to its grammar, since both reach `wrangler` as an argv value. */
function checkPoint(point: { bookmark: string } | { timestamp: string }): void {
  if ("bookmark" in point) {
    if (!BOOKMARK.test(point.bookmark)) {
      throw new CliError(
        "invalid-args",
        `--bookmark ${JSON.stringify(point.bookmark)} is not a bookmark — 1 to 128 characters of letters, digits, underscore and hyphen, starting with a letter or a digit`,
      );
    }
    return;
  }
  if (!TIMESTAMP.test(point.timestamp)) {
    throw new CliError(
      "invalid-args",
      `--timestamp ${JSON.stringify(point.timestamp)} is not a timestamp — an ISO 8601 date-time, or seconds since the epoch`,
    );
  }
}

function remoteFlags(home: Home): string[] {
  if (home.place !== "remote" && home.place !== "preview") {
    throw new CliError(
      "invalid-args",
      `Time Travel is a property of a deployed database — --target ${home.place} has none. Undo a local change with \`forge db reset\` and \`forge db restore\`.`,
    );
  }
  return ["-c", home.configPath, ...(home.env === null ? [] : ["-e", home.env]), ...(home.place === "preview" ? ["--preview"] : [])];
}

/** Captures the bookmark for now or for `--timestamp`, and the command that restores to it — aimed by the run's config when given. @public */
export function timeTravelInfo(io: DbIo, home: Home, timestamp?: string, config?: DbConfig): Bookmark {
  if (timestamp !== undefined) checkPoint({ timestamp });
  const args = [
    "time-travel",
    "info",
    home.database,
    ...remoteFlags(home),
    "--json",
    ...(timestamp === undefined ? [] : ["--timestamp", timestamp]),
  ];
  const run = runWrangler(io, home, args);
  if (run.code !== 0) throw new CliError("external", `time-travel info failed (exit ${run.code}):\n${run.stderr.trim().slice(0, 2000)}`);
  const start = run.stdout.indexOf("{");
  const parsed = start === -1 ? {} : (JSON.parse(run.stdout.slice(start)) as { bookmark?: unknown });
  if (typeof parsed.bookmark !== "string" || parsed.bookmark === "") {
    throw new CliError("invalid-args", `time-travel info returned no bookmark:\n${run.stdout.trim().slice(0, 2000)}`);
  }
  checkPoint({ bookmark: parsed.bookmark });
  const target = home.place === "preview" ? "preview" : "remote";
  return {
    bookmark: parsed.bookmark,
    restoreCommand: `forge db bookmark restore --target ${target} --bookmark ${parsed.bookmark}${undoFlags(config)}`,
  };
}

/** Restores the deployed database to a bookmark or a timestamp. The confirmation is the caller's. @public */
export function timeTravelRestore(io: DbIo, home: Home, point: { bookmark: string } | { timestamp: string }): string {
  checkPoint(point);
  const at = "bookmark" in point ? ["--bookmark", point.bookmark] : ["--timestamp", point.timestamp];
  const run = runWrangler(io, home, ["time-travel", "restore", home.database, ...remoteFlags(home), ...at]);
  if (run.code !== 0) throw new CliError("external", `time-travel restore failed (exit ${run.code}):\n${run.stderr.trim().slice(0, 2000)}`);
  return run.stdout.trim();
}
