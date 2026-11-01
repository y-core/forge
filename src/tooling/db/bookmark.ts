import { CliError } from "../cli/errors";
import { readDeployedBookmark, restoreDeployedBookmark } from "./remote";
import type { Bookmark, DbConfig, DbIo, Home } from "./types";

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

/** Holds a Time Travel point to its grammar, since a bookmark is printed back into a shell command. */
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

function refuseLocalPlace(home: Home): void {
  if (home.place !== "remote" && home.place !== "preview") {
    throw new CliError(
      "invalid-args",
      `Time Travel is a property of a deployed database — --target ${home.place} has none. Undo a local change with \`forge db reset\` and \`forge db restore\`.`,
    );
  }
}

function restoreCommandFor(home: Home, bookmark: string, config: DbConfig | undefined): string {
  const target = home.place === "preview" ? "preview" : "remote";
  return `forge db bookmark restore --target ${target} --bookmark ${bookmark}${undoFlags(config)}`;
}

/** Captures the bookmark for now or for `--timestamp`, and the command that restores to it — aimed by the run's config when given. @public */
export async function timeTravelInfo(io: DbIo, home: Home, timestamp?: string, config?: DbConfig): Promise<Bookmark> {
  if (timestamp !== undefined) checkPoint({ timestamp });
  refuseLocalPlace(home);
  const bookmark = await readDeployedBookmark(io, home, timestamp);
  if (bookmark === "") throw new CliError("external", "time-travel info returned an empty bookmark");
  checkPoint({ bookmark });
  return { bookmark, restoreCommand: restoreCommandFor(home, bookmark, config) };
}

/** Restores the deployed database to a bookmark or a timestamp, answering the undo that returns it to where it was. The confirmation is the caller's. @public */
export async function timeTravelRestore(
  io: DbIo,
  home: Home,
  point: { bookmark: string } | { timestamp: string },
  config?: DbConfig,
): Promise<Bookmark> {
  checkPoint(point);
  refuseLocalPlace(home);
  const previous = await restoreDeployedBookmark(io, home, point);
  checkPoint({ bookmark: previous });
  return { bookmark: previous, restoreCommand: restoreCommandFor(home, previous, config) };
}
