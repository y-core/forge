import { describe, expect, it } from "bun:test";

import { D1BackupError } from "./errors";
import { createRestoreDatabase, readImportState } from "./import";
import type { CloudflareAccess } from "./types";

const reply = (over: Record<string, unknown>) => ({ success: true, errors: [], ...over });

describe("readImportState()", () => {
  it("reads a running import by its bookmark, and a finished one by its final bookmark and query count", () => {
    expect(readImportState(reply({ status: "active", at_bookmark: "B1" }))).toEqual({ status: "active", bookmark: "B1" });
    expect(readImportState(reply({ status: "complete", result: { num_queries: 4, final_bookmark: "B2" } }))).toEqual({
      status: "complete",
      bookmark: "B2",
      queries: 4,
    });
  });

  it("reads a refused or failed import as an error, with D1's own words", () => {
    expect(readImportState(reply({ success: false, error: "too big" }))).toEqual({ status: "error", error: "too big" });
    expect(readImportState(reply({ status: "error", errors: ["a", "b"] }))).toEqual({ status: "error", error: "a; b" });
  });

  it("refuses a running import with no bookmark, or one outside D1's grammar", () => {
    for (const bad of [reply({ status: "active" }), reply({ status: "active", at_bookmark: "../x" })]) {
      const error = (() => {
        try {
          readImportState(bad);
        } catch (thrown) {
          return thrown;
        }
        return null;
      })();
      expect([error instanceof D1BackupError, (error as D1BackupError).kind]).toEqual([true, "malformed"]);
    }
  });
});

describe("createRestoreDatabase()", () => {
  const LISTED = Response.json({ success: true, errors: [], result: [{ uuid: "uuid-existing", name: "app-db-restore" }] });

  function access(create: () => Response | Promise<Response>, calls: string[]): CloudflareAccess {
    return {
      accountId: "acct",
      apiToken: "tok",
      fetch: async (url, init) => {
        calls.push(init?.method ?? "GET");
        return init?.method === "POST" ? create() : LISTED.clone();
      },
    };
  }

  it("rethrows a 4xx create without listing, even where one database of that name exists", async () => {
    const calls: string[] = [];
    const error = await createRestoreDatabase(
      access(() => new Response("{}", { status: 409 }), calls),
      "app-db-restore",
    ).catch((thrown: unknown) => thrown);

    expect([error instanceof D1BackupError, (error as D1BackupError).status, calls]).toEqual([true, 409, ["POST"]]);
  });

  it("adopts the one database of that name a create whose reply was lost already made", async () => {
    for (const create of [() => Promise.reject(new Error("reset")), () => new Response("{}", { status: 502 })]) {
      const calls: string[] = [];
      expect(await createRestoreDatabase(access(create, calls), "app-db-restore")).toEqual({ databaseId: "uuid-existing", name: "app-db-restore" });
      expect(calls).toEqual(["POST", "GET"]);
    }
  });
});
