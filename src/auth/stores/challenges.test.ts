import { describe, expect, it } from "bun:test";

import { createD1Client } from "../../storage/db/client";
import type { D1Client, D1Database } from "../../storage/db/types";
import { nullLogger } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import type { FakeD1Options } from "../../testing/types";
import { AuthStoreError } from "../errors";
import type { AuthChallenge } from "../types";
import { createChallengeStore } from "./challenges";

const TTL = 300;
const CHALLENGE: AuthChallenge = { challenge: "Y2hhbGxlbmdl", sessionId: "sess-1" };

type FakeDb = ReturnType<typeof fakeD1>;

function clientOf(rows: (sql: string, params: unknown[]) => unknown[] = () => [], options?: FakeD1Options): [D1Client, FakeDb] {
  const db = fakeD1(rows, options);
  return [createD1Client(db as unknown as D1Database, { logger: nullLogger }), db];
}

function normalized(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

describe("createChallengeStore — put", () => {
  it("upserts, so a second ceremony on one session replaces the challenge rather than conflicting", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    expect(await createChallengeStore(client).put("k1", CHALLENGE, TTL)).toEqual({ ok: true, data: undefined });
    expect(normalized(db.calls[0]?.sql)).toBe(
      "INSERT INTO auth_challenges (key, value, expires_at) VALUES (?, ?, ?) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
    );
  });

  it("stores the challenge as JSON under the prefixed key, expiring the configured lifetime from now", async () => {
    const [client, db] = clientOf(() => [], { rowsWritten: () => 1 });
    const before = Date.now();
    await createChallengeStore(client, { prefix: "p" }).put("k1", CHALLENGE, TTL);
    const [key, value, expiresAt] = db.calls[0]?.params ?? [];
    expect(key).toBe("p||k1");
    expect(value).toBe(JSON.stringify(CHALLENGE));
    expect(expiresAt as number).toBeGreaterThanOrEqual(before + TTL * 1000);
    expect(expiresAt as number).toBeLessThanOrEqual(Date.now() + TTL * 1000);
  });

  it("keeps the userId a challenge was issued with", async () => {
    const bound: AuthChallenge = { ...CHALLENGE, userId: "01920000-0000-7000-8000-000000000000" };
    const [client] = clientOf(() => [{ value: JSON.stringify(bound) }], { rowsWritten: () => 1 });
    const store = createChallengeStore(client);
    await store.put("k1", bound, TTL);
    expect(await store.take("k1")).toEqual({ ok: true, data: bound });
  });
});

describe("createChallengeStore — take", () => {
  // The whole reason this store left KV: a read then a delete lets two requests be handed one
  // challenge. `tests/workerd/auth-schema.test.ts` proves the statement itself admits only one.
  it("reads and spends in the one statement, holding the row against the clock", async () => {
    const [client, db] = clientOf(() => [{ value: JSON.stringify(CHALLENGE) }]);
    expect(await createChallengeStore(client, { prefix: "p" }).take("k1")).toEqual({ ok: true, data: CHALLENGE });
    expect(db.calls).toHaveLength(1);
    expect(normalized(db.calls[0]?.sql)).toBe("DELETE FROM auth_challenges WHERE key = ? AND expires_at > ? RETURNING value");
    expect(db.calls[0]?.params[0]).toBe("p||k1");
    expect(db.calls[0]?.params[1] as number).toBeLessThanOrEqual(Date.now());
  });

  it("reports a row the statement did not match — absent or expired — as data: null, not as an error", async () => {
    const [client] = clientOf(() => []);
    expect(await createChallengeStore(client).take("absent")).toEqual({ ok: true, data: null });
  });

  it("namespaces its keys under a prefix, so two stores on one table cannot collide", async () => {
    const [client, db] = clientOf(() => []);
    await createChallengeStore(client, { prefix: "auth:challenge" }).take("k1");
    await createChallengeStore(client, { prefix: "other" }).take("k1");
    expect(db.calls.map((call) => call.params[0])).toEqual(["auth:challenge||k1", "other||k1"]);
  });

  it("refuses an empty prefix, which would drop the namespacing the prefix exists for", () => {
    const [client] = clientOf();
    expect(() => createChallengeStore(client, { prefix: "" })).toThrow("createChallengeStore: `prefix` must not be an empty string");
  });
});

describe("createChallengeStore — failures", () => {
  it("surfaces a write failure as an AuthStoreError, not as a thrown error", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: database unreachable") });
    const outcome = await createChallengeStore(client).put("k1", CHALLENGE, TTL);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "challenges.put"]);
  });

  it("surfaces a read failure the same way", async () => {
    const [client] = clientOf(() => [], { failOn: () => new Error("D1_ERROR: database unreachable") });
    const outcome = await createChallengeStore(client).take("k1");
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "challenges.take"]);
  });

  it("reports a value that will not decode as unavailable rather than throwing out of the store", async () => {
    const [client] = clientOf(() => [{ value: "{not json" }]);
    const outcome = await createChallengeStore(client).take("k1");
    expect(outcome.ok === false && [outcome.error.code, outcome.error.operation]).toEqual(["unavailable", "challenges.take"]);
  });
});
