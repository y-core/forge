import { CliError } from "../cli/errors";
import type { Bookmark, DbConfig, DbIo, Home } from "./types";
import { runWrangler } from "./wrangler";

function undoFlags(config: DbConfig | undefined): string {
  if (config === undefined) return "";
  const env = config.env === null ? "" : ` -e ${config.env}`;
  return ` --root ${config.root} --config ${config.configPath} --db ${config.entry.binding}${env}`;
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
  const target = home.place === "preview" ? "preview" : "remote";
  return {
    bookmark: parsed.bookmark,
    restoreCommand: `forge db bookmark restore --target ${target} --bookmark ${parsed.bookmark}${undoFlags(config)}`,
  };
}

/** Restores the deployed database to a bookmark or a timestamp. The confirmation is the caller's. @public */
export function timeTravelRestore(io: DbIo, home: Home, point: { bookmark: string } | { timestamp: string }): string {
  const at = "bookmark" in point ? ["--bookmark", point.bookmark] : ["--timestamp", point.timestamp];
  const run = runWrangler(io, home, ["time-travel", "restore", home.database, ...remoteFlags(home), ...at]);
  if (run.code !== 0) throw new CliError("external", `time-travel restore failed (exit ${run.code}):\n${run.stderr.trim().slice(0, 2000)}`);
  return run.stdout.trim();
}
