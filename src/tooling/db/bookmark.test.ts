import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../cf/types";
import { timeTravelInfo, timeTravelRestore } from "./bookmark";
import { fakeDbIo } from "./db.fixture";
import type { DbConfig, FakeDbIo, Home, Spawned } from "./types";

function home(over: Partial<Home> = {}): Home {
  return {
    label: "remote",
    database: "app-db",
    dir: "/app",
    configPath: "/app/wrangler.jsonc",
    persistTo: null,
    place: "remote",
    env: null,
    synthesized: false,
    ...over,
  };
}

const LOCAL = home({ label: "local", place: "local", persistTo: "/app/.wrangler/state" });
const PREVIEW = home({ label: "preview", place: "preview" });

const BOOKMARK = "00000085-0000027c-00004f1e-90dbd1f2b0a54cfd";

function ioReplying(reply: Spawned): FakeDbIo {
  const io = fakeDbIo();
  io.rules.push({ match: () => true, reply });
  return io;
}

function infoReplying(bookmark: string): FakeDbIo {
  return ioReplying({ code: 0, stdout: `🌀 Time travelling...\n{"bookmark":"${bookmark}"}\n`, stderr: "" });
}

describe("timeTravelInfo()", () => {
  it("asks the deployed database for its current bookmark", () => {
    const io = infoReplying(BOOKMARK);
    expect(timeTravelInfo(io, home())).toEqual({
      bookmark: BOOKMARK,
      restoreCommand: `forge db bookmark restore --target remote --bookmark ${BOOKMARK}`,
    });
    expect(io.calls[0]).toEqual(["wrangler", "d1", "time-travel", "info", "app-db", "-c", "/app/wrangler.jsonc", "--json"]);
  });

  it("asks the preview database with --preview, and offers a restore that names it", () => {
    const io = infoReplying(BOOKMARK);
    expect(timeTravelInfo(io, PREVIEW).restoreCommand).toBe(`forge db bookmark restore --target preview --bookmark ${BOOKMARK}`);
    expect(io.calls[0]).toEqual(["wrangler", "d1", "time-travel", "info", "app-db", "-c", "/app/wrangler.jsonc", "--preview", "--json"]);
  });

  it("forwards the environment and the timestamp asked for", () => {
    const io = infoReplying(BOOKMARK);
    timeTravelInfo(io, home({ env: "staging" }), "2026-09-01T00:00:00Z");
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "time-travel",
      "info",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "-e",
      "staging",
      "--json",
      "--timestamp",
      "2026-09-01T00:00:00Z",
    ]);
  });

  it("aims the restore command with every flag the run resolved the database by, when given the config", () => {
    const io = infoReplying(BOOKMARK);
    const config: DbConfig = {
      root: "/app",
      configPath: "/app/wrangler.jsonc",
      config: { name: "app", compatibility_date: "2026-01-01" } as WranglerConfig,
      env: "staging",
      entry: { binding: "DB", databaseName: "app-db", databaseId: "0f8c2a5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a", previewDatabaseId: null },
      target: { place: "remote", database: null },
    };
    expect(timeTravelInfo(io, home({ env: "staging" }), undefined, config).restoreCommand).toBe(
      `forge db bookmark restore --target remote --bookmark ${BOOKMARK} --root /app --config /app/wrangler.jsonc --db DB -e staging`,
    );
    expect(timeTravelInfo(io, home(), undefined, { ...config, env: null }).restoreCommand).toBe(
      `forge db bookmark restore --target remote --bookmark ${BOOKMARK} --root /app --config /app/wrangler.jsonc --db DB`,
    );
  });

  it("refuses a local place, naming the local undo instead", () => {
    const io = infoReplying(BOOKMARK);
    expect(() => timeTravelInfo(io, LOCAL)).toThrow(
      "Time Travel is a property of a deployed database — --target local has none. Undo a local change with `forge db reset` and `forge db restore`.",
    );
    expect(io.calls).toEqual([]);
  });

  it("refuses a standby place, which is a second local database", () => {
    expect(() => timeTravelInfo(infoReplying(BOOKMARK), home({ label: "standby", place: "standby" }))).toThrow(
      "Time Travel is a property of a deployed database — --target standby has none. Undo a local change with `forge db reset` and `forge db restore`.",
    );
  });

  it("reports the exit code and stderr when wrangler fails", () => {
    const io = ioReplying({ code: 1, stdout: "", stderr: "✘ [ERROR] Authentication error\n" });
    expect(() => timeTravelInfo(io, home())).toThrow("time-travel info failed (exit 1):\n✘ [ERROR] Authentication error");
  });

  it("refuses a payload with no bookmark in it", () => {
    expect(() => timeTravelInfo(ioReplying({ code: 0, stdout: '{"messages":[]}\n', stderr: "" }), home())).toThrow(
      'time-travel info returned no bookmark:\n{"messages":[]}',
    );
  });

  it("refuses an empty bookmark, which would restore to nothing", () => {
    expect(() => timeTravelInfo(infoReplying(""), home())).toThrow(
      'time-travel info returned no bookmark:\n🌀 Time travelling...\n{"bookmark":""}',
    );
  });

  it("refuses output carrying no JSON object at all", () => {
    expect(() => timeTravelInfo(ioReplying({ code: 0, stdout: "🌀 Time travelling...\n", stderr: "" }), home())).toThrow(
      "time-travel info returned no bookmark:\n🌀 Time travelling...",
    );
  });
});

describe("timeTravelRestore()", () => {
  it("restores to a bookmark and returns what wrangler printed", () => {
    const io = ioReplying({ code: 0, stdout: "⚠️ Restored to bookmark\n", stderr: "" });
    expect(timeTravelRestore(io, home(), { bookmark: BOOKMARK })).toBe("⚠️ Restored to bookmark");
    expect(io.calls[0]).toEqual(["wrangler", "d1", "time-travel", "restore", "app-db", "-c", "/app/wrangler.jsonc", "--bookmark", BOOKMARK]);
  });

  it("restores to a timestamp instead when that is the point given", () => {
    const io = ioReplying({ code: 0, stdout: "", stderr: "" });
    timeTravelRestore(io, PREVIEW, { timestamp: "2026-09-01T00:00:00Z" });
    expect(io.calls[0]).toEqual([
      "wrangler",
      "d1",
      "time-travel",
      "restore",
      "app-db",
      "-c",
      "/app/wrangler.jsonc",
      "--preview",
      "--timestamp",
      "2026-09-01T00:00:00Z",
    ]);
  });

  it("refuses a local place without running anything", () => {
    const io = ioReplying({ code: 0, stdout: "", stderr: "" });
    expect(() => timeTravelRestore(io, LOCAL, { bookmark: BOOKMARK })).toThrow(
      "Time Travel is a property of a deployed database — --target local has none. Undo a local change with `forge db reset` and `forge db restore`.",
    );
    expect(io.calls).toEqual([]);
  });

  it("reports the exit code and stderr when the restore fails", () => {
    const io = ioReplying({ code: 1, stdout: "", stderr: "✘ [ERROR] bookmark is outside the retention window\n" });
    expect(() => timeTravelRestore(io, home(), { bookmark: BOOKMARK })).toThrow(
      "time-travel restore failed (exit 1):\n✘ [ERROR] bookmark is outside the retention window",
    );
  });
});
