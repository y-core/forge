import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import { purgeAuthEphemera } from "./ephemera";

const AT = 1_700_000_000_000;

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(() => [], options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

describe("purgeAuthEphemera", () => {
  it("deletes the dead rows of both ephemeral tables in one batch", async () => {
    const [client, db] = clientOf();
    expect(await purgeAuthEphemera(client, AT)).toEqual({ ok: true, data: undefined });
    expect(db.calls.map((call) => normalized(call.sql))).toEqual([
      "DELETE FROM auth_challenges WHERE expires_at <= ?",
      "DELETE FROM auth_nonces WHERE expires_at <= ?",
    ]);
    expect(db.calls.map((call) => call.params)).toEqual([[AT], [AT]]);
  });

  it("surfaces a failure as an AuthStoreError rather than throwing into a scheduled handler", async () => {
    const [client] = clientOf({ failOn: () => new Error("D1_ERROR: database unreachable") });
    const outcome = await purgeAuthEphemera(client, AT);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "ephemera.purge"]);
  });
});
