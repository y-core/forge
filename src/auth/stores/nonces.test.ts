import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import { createNonceStore } from "./nonces";

const TTL = 900;

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rowsWritten: (sql: string, params: unknown[]) => number = () => 1, options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(() => [], { rowsWritten, ...options });
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

describe("createNonceStore", () => {
  // The whole reason this store left KV: a read then a write lets two verifications each be told
  // the nonce was theirs to spend. Here the primary key decides, and no read precedes it.
  it("claims the key in one insert, with no prior read to race", async () => {
    const [client, db] = clientOf();
    expect(await createNonceStore(client).markConsumed("n1", TTL)).toEqual({ ok: true, data: true });
    expect(db.calls).toHaveLength(1);
    expect(normalized(db.calls[0]?.sql)).toBe("INSERT INTO auth_nonces (key, expires_at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING");
  });

  it("reports false when the row was already there, which is the conflict doing nothing", async () => {
    const [client] = clientOf(() => 0);
    expect(await createNonceStore(client).markConsumed("n1", TTL)).toEqual({ ok: true, data: false });
  });

  it("writes the prefixed key and an expiry the configured lifetime from now", async () => {
    const [client, db] = clientOf();
    const before = Date.now();
    await createNonceStore(client, { prefix: "p" }).markConsumed("n1", TTL);
    const [key, expiresAt] = db.calls[0]?.params ?? [];
    expect(key).toBe("p||n1");
    expect(expiresAt as number).toBeGreaterThanOrEqual(before + TTL * 1000);
    expect(expiresAt as number).toBeLessThanOrEqual(Date.now() + TTL * 1000);
  });

  it("namespaces its keys under a prefix", async () => {
    const [client, db] = clientOf();
    await createNonceStore(client, { prefix: "auth:nonce" }).markConsumed("n1", TTL);
    await createNonceStore(client, { prefix: "other" }).markConsumed("n1", TTL);
    expect(db.calls.map((call) => call.params[0])).toEqual(["auth:nonce||n1", "other||n1"]);
  });

  it("refuses an empty prefix, which would drop the namespacing the prefix exists for", () => {
    const [client] = clientOf();
    expect(() => createNonceStore(client, { prefix: "" })).toThrow("createNonceStore: `prefix` must not be an empty string");
  });

  it("accepts a lifetime under a minute, which the KV floor used to refuse", async () => {
    const [client] = clientOf();
    expect(await createNonceStore(client).markConsumed("n1", 30)).toEqual({ ok: true, data: true });
  });
});

describe("createNonceStore — failures", () => {
  it("surfaces a write failure as an AuthStoreError, and never reports a nonce fresh because the write failed", async () => {
    const [client] = clientOf(() => 1, { failOn: () => new Error("D1_ERROR: database unreachable") });
    const outcome = await createNonceStore(client).markConsumed("n1", TTL);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "nonces.markConsumed"]);
  });
});
