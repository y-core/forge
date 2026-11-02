import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../cf/types";
import { CliError } from "../cli/errors";
import { describeBookmarkUndo, timeTravelInfo, timeTravelRestore } from "./bookmark";
import { cfEnvelope, cfRefusal, fakeDbIo, REMOTE_AUTH } from "./db.fixture";
import type { DbConfig, FakeDbIo, Home } from "./types";

const DB_ID = "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";

function home(over: Partial<Home> = {}): Home {
  return {
    label: "remote",
    database: "app-db",
    binding: "DB",
    dir: "/app",
    configPath: "/app/wrangler.jsonc",
    persistTo: null,
    place: "remote",
    env: null,
    databaseId: DB_ID,
    auth: REMOTE_AUTH,
    synthesized: false,
    ...over,
  };
}

const LOCAL = home({ label: "local", place: "local", persistTo: "/app/.wrangler/state", databaseId: null });
const PREVIEW = home({ label: "preview", place: "preview", databaseId: "1a2b3c4d-1b2c-4d3e-8f9a-0b1c2d3e4f5a" });

const BASE = `https://api.cloudflare.com/client/v4/accounts/acct/d1/database/${DB_ID}`;
const BOOKMARK = "00000085-0000027c-00004f1e-90dbd1f2b0a54cfd";
const PREVIOUS = "00000084-0000027b-00004f1d-80dbd1f2b0a54cfd";
const BEFORE = "00000084-0000027a-00004f1c-70dbd1f2b0a54cfd";

const CONFIG: DbConfig = {
  root: "/app",
  configPath: "/app/wrangler.jsonc",
  config: { name: "app", compatibility_date: "2026-01-01" } as WranglerConfig,
  env: "staging",
  entry: { binding: "DB", databaseName: "app-db", databaseId: DB_ID, previewDatabaseId: null },
  target: { place: "remote", database: null },
};

function ioAnswering(reply: Response): FakeDbIo {
  const io = fakeDbIo({});
  io.restRules.push({ match: () => true, reply: () => reply.clone() });
  return io;
}

const infoReplying = (bookmark: string) => ioAnswering(cfEnvelope({ bookmark }));

/** Splits a printed command the way a POSIX shell would, honouring single quotes. */
function splitArgs(command: string): string[] {
  return [...command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((match) => (match[1] ?? match[2] ?? "").replaceAll("'\\''", "'"));
}

async function capture(run: () => Promise<unknown>): Promise<CliError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("timeTravelInfo()", () => {
  it("asks the deployed database for its current bookmark", async () => {
    const io = infoReplying(BOOKMARK);
    expect(await timeTravelInfo(io, home())).toEqual({
      bookmark: BOOKMARK,
      restoreCommand: `forge db bookmark restore --target remote --bookmark ${BOOKMARK}`,
    });
    expect(io.restCalls.map((call) => [call.method, call.url])).toEqual([["GET", `${BASE}/time_travel/bookmark`]]);
  });

  it("asks the preview database by its own id, and offers a restore that names it", async () => {
    const io = infoReplying(BOOKMARK);
    expect((await timeTravelInfo(io, PREVIEW)).restoreCommand).toBe(`forge db bookmark restore --target preview --bookmark ${BOOKMARK}`);
    expect(io.restCalls[0]?.url).toContain("/d1/database/1a2b3c4d-1b2c-4d3e-8f9a-0b1c2d3e4f5a/time_travel/bookmark");
  });

  it("sends the timestamp asked for as an ISO 8601 instant", async () => {
    const io = infoReplying(BOOKMARK);
    await timeTravelInfo(io, home({ env: "staging" }), "2026-09-01T00:00:00Z");
    expect(io.restCalls[0]?.url).toBe(`${BASE}/time_travel/bookmark?timestamp=2026-09-01T00%3A00%3A00.000Z`);
  });

  it("aims the restore command with every flag the run resolved the database by, when given the config", async () => {
    const io = infoReplying(BOOKMARK);
    expect((await timeTravelInfo(io, home({ env: "staging" }), undefined, CONFIG)).restoreCommand).toBe(
      `forge db bookmark restore --target remote --bookmark ${BOOKMARK} --root '/app' --config '/app/wrangler.jsonc' --db 'DB' -e 'staging'`,
    );
    expect((await timeTravelInfo(io, home(), undefined, { ...CONFIG, env: null })).restoreCommand).toBe(
      `forge db bookmark restore --target remote --bookmark ${BOOKMARK} --root '/app' --config '/app/wrangler.jsonc' --db 'DB'`,
    );
  });

  it("quotes the paths it aims the undo with, so a project under a path with a space still runs it", async () => {
    const root = "/Users/dev/My Projects/app";
    const config: DbConfig = { ...CONFIG, root, configPath: `${root}/wrangler.jsonc`, env: null };
    const command = (await timeTravelInfo(infoReplying(BOOKMARK), home(), undefined, config)).restoreCommand;
    expect(splitArgs(command)).toEqual([
      "forge",
      "db",
      "bookmark",
      "restore",
      "--target",
      "remote",
      "--bookmark",
      BOOKMARK,
      "--root",
      root,
      "--config",
      `${root}/wrangler.jsonc`,
      "--db",
      "DB",
    ]);
  });

  it("refuses a local place, naming the local undo instead, before any request", async () => {
    const io = infoReplying(BOOKMARK);
    expect((await capture(() => timeTravelInfo(io, LOCAL))).message).toBe(
      "Time Travel is a property of a deployed database — --target local has none. Undo a local change with `forge db reset` and `forge db restore`.",
    );
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a standby place, which is a second local database", async () => {
    const io = infoReplying(BOOKMARK);
    expect((await capture(() => timeTravelInfo(io, home({ label: "standby", place: "standby", databaseId: null })))).message).toContain(
      "--target standby has none",
    );
    expect(io.restCalls).toEqual([]);
  });

  it("restates an auth refusal as the token and the permission it lacks", async () => {
    const { message } = await capture(() => timeTravelInfo(ioAnswering(cfRefusal(10000, "Authentication error")), home()));
    expect(message).toBe(
      "time-travel info against remote (app-db) failed: Cloudflare refused the --api-token — it is invalid, or lacks Account → D1 → Edit · code 10000",
    );
  });

  it("refuses an empty bookmark, which would restore to nothing", async () => {
    const error = await capture(() => timeTravelInfo(infoReplying(""), home()));
    expect(error.kind).toBe("external");
    expect(error.message).toBe("time-travel info returned an empty bookmark");
  });

  it("refuses an answer carrying no bookmark as a schema refusal", async () => {
    expect((await capture(() => timeTravelInfo(ioAnswering(cfEnvelope({})), home()))).message).toContain("unexpected response shape at bookmark");
  });

  it("refuses a bookmark D1 answers that is not one, since it is printed into a shell command", async () => {
    expect((await capture(() => timeTravelInfo(infoReplying("$(rm -rf /)"), home()))).message).toContain(
      '--bookmark "$(rm -rf /)" is not a bookmark',
    );
  });
});

const AFTER_GAP = "that bookmark was read just before the restore, so an undo to it loses any write that landed in between";

/** Answers the pre-read with `before` and the restore with `restore`, routed by path. */
function restoreIo(restore: () => Response, before: () => Response = () => cfEnvelope({ bookmark: BEFORE })): FakeDbIo {
  const io = fakeDbIo({});
  io.restRules.push({ match: (url) => new URL(url).pathname.endsWith("/time_travel/bookmark"), reply: before });
  io.restRules.push({ match: (url) => new URL(url).pathname.endsWith("/time_travel/restore"), reply: restore });
  return io;
}

const restoreReplying = (previous: string) => restoreIo(() => cfEnvelope({ bookmark: BOOKMARK, previous_bookmark: previous, message: "Restored" }));

const restoreCalls = (io: FakeDbIo) => io.restCalls.filter((call) => call.url.includes("/time_travel/restore"));

describe("timeTravelRestore()", () => {
  it("reads the bookmark first, restores, and returns the undo built from the bookmark D1 says it left", async () => {
    const io = restoreReplying(PREVIOUS);
    expect(await timeTravelRestore(io, home(), { bookmark: BOOKMARK })).toEqual({
      bookmark: PREVIOUS,
      restoreCommand: `forge db bookmark restore --target remote --bookmark ${PREVIOUS}`,
      from: "restore",
      replyReadable: true,
    });
    expect(io.restCalls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["GET", `${BASE}/time_travel/bookmark`, null],
      ["POST", `${BASE}/time_travel/restore?bookmark=${BOOKMARK}`, null],
    ]);
  });

  it("aims the undo with the run's config", async () => {
    expect((await timeTravelRestore(restoreReplying(PREVIOUS), home(), { bookmark: BOOKMARK }, CONFIG)).restoreCommand).toBe(
      `forge db bookmark restore --target remote --bookmark ${PREVIOUS} --root '/app' --config '/app/wrangler.jsonc' --db 'DB' -e 'staging'`,
    );
  });

  it("restores to a timestamp instead when that is the point given", async () => {
    const io = restoreReplying(PREVIOUS);
    const undo = await timeTravelRestore(io, PREVIEW, { timestamp: "2026-09-01T00:00:00Z" });
    expect(undo.restoreCommand).toBe(`forge db bookmark restore --target preview --bookmark ${PREVIOUS}`);
    expect(restoreCalls(io)[0]?.url).toEndWith("/time_travel/restore?timestamp=2026-09-01T00%3A00%3A00.000Z");
  });

  it("falls back to the bookmark read first when D1's reply names none", async () => {
    const io = restoreIo(() => cfEnvelope({}));
    expect(await timeTravelRestore(io, home(), { bookmark: BOOKMARK }, CONFIG)).toEqual({
      bookmark: BEFORE,
      restoreCommand: `forge db bookmark restore --target remote --bookmark ${BEFORE} --root '/app' --config '/app/wrangler.jsonc' --db 'DB' -e 'staging'`,
      from: "pre-read",
      replyReadable: true,
    });
  });

  it("answers an accepted restore whose reply is unreadable as restored, with the undo to the bookmark read first", async () => {
    for (const reply of [
      () => cfEnvelope({ bookmark: BOOKMARK, previous_bookmark: "$(rm -rf /)" }),
      () => cfEnvelope({ previous_bookmark: 42 }),
      () => new Response("<html>ok</html>", { status: 200 }),
    ]) {
      const undo = await timeTravelRestore(restoreIo(reply), home(), { bookmark: BOOKMARK });
      expect(undo).toEqual({
        bookmark: BEFORE,
        restoreCommand: `forge db bookmark restore --target remote --bookmark ${BEFORE}`,
        from: "pre-read",
        replyReadable: false,
      });
    }
  });

  it("reports a restore whose transport failed after sending as one that may have restored, naming the undo read first", async () => {
    const io = restoreIo(() => {
      throw new Error("connection reset");
    });
    const error = await capture(() => timeTravelRestore(io, home(), { bookmark: BOOKMARK }));
    expect([error.kind, error.message]).toEqual([
      "external",
      `time-travel restore against remote (app-db) may have restored: Network error: connection reset. Undo with: forge db bookmark restore --target remote --bookmark ${BEFORE} — ${AFTER_GAP}`,
    ]);
    expect(restoreCalls(io)).toHaveLength(1);
  });

  it("reports a restore answered by a 5xx as one that may have restored, and a 4xx as not restored", async () => {
    const gateway = restoreIo(() => cfRefusal(10001, "Bad gateway", 502));
    const failed = await capture(() => timeTravelRestore(gateway, home(), { bookmark: BOOKMARK }));
    expect(failed.message).toBe(
      `time-travel restore against remote (app-db) may have restored: D1 answered HTTP 502. Undo with: forge db bookmark restore --target remote --bookmark ${BEFORE} — ${AFTER_GAP}`,
    );
    expect(restoreCalls(gateway)).toHaveLength(1);

    const refused = await capture(() =>
      timeTravelRestore(
        restoreIo(() => cfRefusal(7400, "Invalid bookmark", 400)),
        home(),
        { bookmark: BOOKMARK },
      ),
    );
    expect(refused.message).toBe("time-travel restore against remote (app-db) failed: Invalid bookmark (Cloudflare error 7400)");
  });

  it("reports an accepted restore answered with a failure envelope as one that may have restored, naming the undo read first", async () => {
    const io = restoreIo(() => Response.json({ success: false, errors: [], result: null }, { status: 200 }));
    expect((await capture(() => timeTravelRestore(io, home(), { bookmark: BOOKMARK }))).message).toBe(
      `time-travel restore against remote (app-db) may have restored: D1 answered HTTP 200 with a failure envelope. Undo with: forge db bookmark restore --target remote --bookmark ${BEFORE} — ${AFTER_GAP}`,
    );
  });

  it("sends the restore once, whatever D1 answers", async () => {
    for (const reply of [
      () => cfEnvelope({ bookmark: BOOKMARK, previous_bookmark: PREVIOUS }),
      () => cfEnvelope({}),
      () => new Response("<html>ok</html>", { status: 200 }),
      () => {
        throw new Error("connection reset");
      },
      () => cfRefusal(10001, "Service unavailable", 503),
      () => Response.json({ success: false, errors: [], result: null }, { status: 200 }),
      () => cfRefusal(971, "Too many requests", 429),
      () => cfRefusal(7400, "Invalid bookmark", 400),
    ]) {
      const io = restoreIo(reply);
      await timeTravelRestore(io, home(), { bookmark: BOOKMARK }).catch(() => undefined);
      expect(restoreCalls(io)).toHaveLength(1);
    }
  });

  it("reports a rate-limited restore as not restored", async () => {
    const io = restoreIo(() => cfRefusal(971, "Too many requests", 429));
    const error = await capture(() => timeTravelRestore(io, home(), { bookmark: BOOKMARK }));
    expect([error.kind, error.message]).toEqual([
      "external",
      "time-travel restore against remote (app-db) failed: not restored — D1 rate-limited the restore; try again in a few minutes",
    ]);
  });

  it("sends no restore when the bookmark to undo it with cannot be read first", async () => {
    for (const before of [
      () => cfRefusal(10000, "Authentication error"),
      () => cfEnvelope({ bookmark: "" }),
      () => cfEnvelope({ bookmark: "$(x)" }),
    ]) {
      const io = restoreReplying(PREVIOUS);
      io.restRules.unshift({ match: (url) => url.includes("/time_travel/bookmark"), reply: before });
      const error = await capture(() => timeTravelRestore(io, home(), { bookmark: BOOKMARK }));
      expect(error.message).toStartWith("time-travel restore not sent — the bookmark to undo it with could not be read first: ");
      expect(restoreCalls(io)).toEqual([]);
    }
  });

  it("refuses a local place before any request", async () => {
    const io = restoreReplying(PREVIOUS);
    expect((await capture(() => timeTravelRestore(io, LOCAL, { bookmark: BOOKMARK }))).message).toBe(
      "Time Travel is a property of a deployed database — --target local has none. Undo a local change with `forge db reset` and `forge db restore`.",
    );
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a malformed bookmark before any request", async () => {
    const io = restoreReplying(PREVIOUS);
    for (const bookmark of ["; rm -rf /", "--preview", "book mark", "", "x".repeat(129)]) {
      expect((await capture(() => timeTravelRestore(io, home(), { bookmark }))).message).toBe(
        `--bookmark ${JSON.stringify(bookmark)} is not a bookmark — 1 to 128 characters of letters, digits, underscore and hyphen, starting with a letter or a digit`,
      );
    }
    expect(io.restCalls).toEqual([]);
  });

  it("refuses a malformed timestamp before any request, on the restore and on the info read alike", async () => {
    const io = restoreReplying(PREVIOUS);
    for (const timestamp of ["yesterday", "2026-09-01 --preview", "-1"]) {
      expect((await capture(() => timeTravelRestore(io, home(), { timestamp }))).message).toContain(
        `--timestamp ${JSON.stringify(timestamp)} is not a timestamp`,
      );
      expect((await capture(() => timeTravelInfo(io, home(), timestamp))).message).toContain(
        `--timestamp ${JSON.stringify(timestamp)} is not a timestamp`,
      );
    }
    expect(io.restCalls).toEqual([]);
  });

  it("accepts the ISO 8601 and Unix timestamp notations", async () => {
    for (const timestamp of ["2026-09-01", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00.500+02:00", "1757980800"]) {
      expect((await timeTravelRestore(restoreReplying(PREVIOUS), home(), { timestamp })).bookmark).toBe(PREVIOUS);
    }
  });

  it("refuses before any request when the home carries no credentials", async () => {
    const io = fakeDbIo({});
    const bare = home({ auth: null });
    expect((await capture(() => timeTravelRestore(io, bare, { bookmark: BOOKMARK }))).message).toContain(
      "--account-id and --api-token are not given.",
    );
    expect((await capture(() => timeTravelInfo(io, bare))).message).toStartWith("--account-id and --api-token are not given.");
    expect(io.restCalls).toEqual([]);
  });

  it("passes D1's refusal of the restore through", async () => {
    const io = restoreIo(() => cfRefusal(7500, "bookmark is outside the retention window"));
    expect((await capture(() => timeTravelRestore(io, home(), { bookmark: BOOKMARK }))).message).toBe(
      "time-travel restore against remote (app-db) failed: bookmark is outside the retention window (Cloudflare error 7500)",
    );
  });
});

describe("describeBookmarkUndo()", () => {
  const command = `forge db bookmark restore --target remote --bookmark ${BEFORE}`;

  it("prints the undo alone when D1 named the bookmark it left", () => {
    expect(describeBookmarkUndo({ bookmark: BEFORE, restoreCommand: command, from: "restore", replyReadable: true })).toBe(
      `restored\nundo with: ${command}`,
    );
  });

  it("says a pre-read undo may miss writes, and why D1's own was not used", () => {
    expect(describeBookmarkUndo({ bookmark: BEFORE, restoreCommand: command, from: "pre-read", replyReadable: true })).toBe(
      `restored, but D1's reply named no bookmark it restored from\nundo with: ${command}\n${AFTER_GAP}`,
    );
    expect(describeBookmarkUndo({ bookmark: BEFORE, restoreCommand: command, from: "pre-read", replyReadable: false })).toBe(
      `restored, but the reply was unreadable\nundo with: ${command}\n${AFTER_GAP}`,
    );
  });
});
