import { isD1Bookmark } from "../../storage/backup/bookmark";
import { CliError } from "../cli/errors";
import { readDeployedBookmark, restoreDeployedBookmark } from "./remote";
import type { Bookmark, BookmarkUndo, DbConfig, DbIo, Home } from "./types";

/** Quotes a value for a POSIX shell, so a path holding a space survives being pasted back. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function undoFlags(config: DbConfig | undefined): string {
  if (config === undefined) return "";
  const env = config.env === null ? "" : ` -e ${shellQuote(config.env)}`;
  return ` --root ${shellQuote(config.root)} --config ${shellQuote(config.configPath)} --db ${shellQuote(config.entry.binding)}${env}`;
}

const TIMESTAMP = /^(\d{1,10}|\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)$/;

/** Holds a Time Travel point to its grammar, since a bookmark is printed back into a shell command. */
function checkPoint(point: { bookmark: string } | { timestamp: string }): void {
  if ("bookmark" in point) {
    if (!isD1Bookmark(point.bookmark)) {
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

const PRE_READ_CAVEAT = "that bookmark was read just before the restore, so an undo to it loses any write that landed in between";

async function readBookmarkBeforeRestore(io: DbIo, home: Home, config: DbConfig | undefined): Promise<Bookmark> {
  try {
    return await timeTravelInfo(io, home, undefined, config);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    throw new CliError(error.kind, `time-travel restore not sent — the bookmark to undo it with could not be read first: ${error.message}`, {
      cause: error,
    });
  }
}

/** Restores the deployed database to a bookmark or a timestamp, answering the undo that returns it to where it was. The confirmation is the caller's. @public */
export async function timeTravelRestore(
  io: DbIo,
  home: Home,
  point: { bookmark: string } | { timestamp: string },
  config?: DbConfig,
): Promise<BookmarkUndo> {
  checkPoint(point);
  refuseLocalPlace(home);
  const before = await readBookmarkBeforeRestore(io, home, config);
  const answer = await restoreDeployedBookmark(io, home, point);
  if (answer.kind === "unknown") {
    throw new CliError(
      "external",
      `time-travel restore against ${home.label} (${home.database}) may have restored: ${answer.reason}. Undo with: ${before.restoreCommand} — ${PRE_READ_CAVEAT}`,
    );
  }
  const previous = answer.kind === "restored" ? answer.previousBookmark : null;
  if (previous !== null && isD1Bookmark(previous)) {
    return { bookmark: previous, restoreCommand: restoreCommandFor(home, previous, config), from: "restore", replyReadable: true };
  }
  return { ...before, from: "pre-read", replyReadable: answer.kind === "restored" && previous === null };
}

/** The lines a restore prints for its undo, saying where the undo's bookmark came from when it is not D1's own. @internal */
export function describeBookmarkUndo(undo: BookmarkUndo): string {
  if (undo.from === "restore") return `restored\nundo with: ${undo.restoreCommand}`;
  const headline = undo.replyReadable ? "restored, but D1's reply named no bookmark it restored from" : "restored, but the reply was unreadable";
  return `${headline}\nundo with: ${undo.restoreCommand}\n${PRE_READ_CAVEAT}`;
}
