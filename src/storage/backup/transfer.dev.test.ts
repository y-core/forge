import { describe, expect, it } from "bun:test";

import { fakeDatabase, stubDatabase } from "./backup.fixture";
import { D1BackupError } from "./errors";
import { restTransfer } from "./export";
import { d1Transfer, localTransfer } from "./transfer.dev";
import type { BackupDatabase, D1BackupOptions, D1RestoreOptions } from "./types";

function options(dump: unknown[][]): D1BackupOptions {
  return {
    accountId: "",
    databaseId: "local",
    apiToken: "",
    bucket: {} as D1BackupOptions["bucket"],
    database: stubDatabase([], dump),
    at: new Date("2026-11-02T03:00:00Z"),
  };
}

describe("localTransfer", () => {
  it("needs no Cloudflare credentials", () => {
    expect(localTransfer.credentials).toEqual([]);
  });

  it("names the dump by the run's instant, so a retried step names the same object", async () => {
    expect(await localTransfer.startExport(options([]))).toBe(`local-${Date.parse("2026-11-02T03:00:00Z")}`);
  });

  it("streams the dumper's statements joined by newlines, announcing their byte length", async () => {
    const opened = await localTransfer.openExport(options([["PRAGMA defer_foreign_keys=TRUE;", 'INSERT INTO "t" ("a") VALUES(\'é\');']]), "B");
    const text = await new Response(opened.body).text();
    expect([text, opened.length]).toEqual([
      'PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "t" ("a") VALUES(\'é\');',
      new TextEncoder().encode(text).byteLength,
    ]);
  });

  it("refuses a binding that does not answer miniflare's export, naming `forge cf dev`", async () => {
    for (const dump of [[], [[1, 2]], [["ok", 3]]]) {
      const error = (await localTransfer.openExport(options(dump), "B").catch((thrown: unknown) => thrown)) as D1BackupError;
      expect([error.kind, error.message.includes("forge cf dev")]).toEqual(["malformed", true]);
    }
  });
});

function restoreInto(database: BackupDatabase | undefined, fresh = false): D1RestoreOptions {
  return {
    accountId: "",
    apiToken: "",
    bucket: {} as D1RestoreOptions["bucket"],
    key: "k.sql",
    into: fresh ? { fresh: "new" } : database === undefined ? { standby: "STANDBY" } : { standby: "STANDBY", database },
  };
}

describe("localTransfer's import", () => {
  it("loads every statement of the dump into the standby in one batch, answering their count", async () => {
    const standby = fakeDatabase();
    const restore = restoreInto(standby);
    const dump = 'CREATE TABLE "t" (a TEXT);\nINSERT INTO "t" ("a") VALUES(\'x;y\');\nINSERT INTO "t" ("a") VALUES(\'z\');';
    const target = await localTransfer.openTarget(restore);
    const state = await localTransfer.startImport(restore, target, { body: new Response(dump).body ?? new ReadableStream(), size: 0, md5: "" });

    expect([target, state, standby.batches]).toEqual([
      { databaseId: "STANDBY", name: "STANDBY" },
      { status: "complete", bookmark: null, queries: 3 },
      [3],
    ]);
    expect(await localTransfer.query(restore, target, "SELECT a FROM t ORDER BY a")).toEqual([{ a: "x;y" }, { a: "z" }]);
  });

  it("refuses a fresh target, which a dev session cannot create, and a standby without its binding", async () => {
    const fresh = (await localTransfer.openTarget(restoreInto(undefined, true)).catch((thrown: unknown) => thrown)) as D1BackupError;
    const unbound = (await localTransfer.openTarget(restoreInto(undefined)).catch((thrown: unknown) => thrown)) as D1BackupError;
    expect([fresh.kind, unbound.kind]).toEqual(["unsupported", "options"]);
  });
});

describe("d1Transfer", () => {
  it("reaches the export over REST in a run that does not arm the development build", () => {
    expect(d1Transfer()).toBe(restTransfer);
  });
});
