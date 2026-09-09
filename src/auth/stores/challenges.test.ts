import { describe, expect, it } from "bun:test";

import { fakeKV } from "../../testing/fakes";
import { AuthStoreError } from "../errors";
import type { AuthChallenge } from "../types";
import { createChallengeStore } from "./challenges";

const TTL = 300;
const CHALLENGE: AuthChallenge = { challenge: "Y2hhbGxlbmdl", sessionId: "sess-1" };

describe("createChallengeStore", () => {
  it("round-trips a challenge through put and take", async () => {
    const store = createChallengeStore(fakeKV());
    expect(await store.put("k1", CHALLENGE, TTL)).toEqual({ ok: true, data: undefined });
    expect(await store.take("k1")).toEqual({ ok: true, data: CHALLENGE });
  });

  it("takes read-and-delete, so a second take finds nothing", async () => {
    const store = createChallengeStore(fakeKV());
    await store.put("k1", CHALLENGE, TTL);
    expect(await store.take("k1")).toEqual({ ok: true, data: CHALLENGE });
    expect(await store.take("k1")).toEqual({ ok: true, data: null });
  });

  it("reports an entry that was never written as data: null, not as an error", async () => {
    expect(await createChallengeStore(fakeKV()).take("absent")).toEqual({ ok: true, data: null });
  });

  // `fakeKV` records a TTL and never enforces one, so expiry itself is not observable here. What is
  // observable is the contract this layer owns: the configured lifetime reaches the binding, and an
  // entry the binding no longer holds — which is what an expired one looks like — reads as null.
  it("passes the configured lifetime to the binding as expirationTtl", async () => {
    const writes: { key: string; ttl: number | undefined }[] = [];
    const namespace = fakeKV();
    const recording = {
      ...namespace,
      put: (key: string, value: string, options?: { expirationTtl?: number }) => {
        writes.push({ key, ttl: options?.expirationTtl });
        return namespace.put(key, value, options);
      },
    } as typeof namespace;
    await createChallengeStore(recording, { prefix: "p" }).put("k1", CHALLENGE, TTL);
    expect(writes).toEqual([{ key: "p||k1", ttl: TTL }]);
  });

  it("reports an entry the binding no longer holds as data: null", async () => {
    const namespace = fakeKV();
    const store = createChallengeStore(namespace, { prefix: "p" });
    await store.put("k1", CHALLENGE, TTL);
    await namespace.delete("p||k1");
    expect(await store.take("k1")).toEqual({ ok: true, data: null });
  });

  it("keeps the userId a challenge was issued with", async () => {
    const store = createChallengeStore(fakeKV());
    const bound: AuthChallenge = { ...CHALLENGE, userId: "01920000-0000-7000-8000-000000000000" };
    await store.put("k1", bound, TTL);
    expect(await store.take("k1")).toEqual({ ok: true, data: bound });
  });

  it("namespaces its keys under a prefix, so two stores on one binding cannot collide", async () => {
    const namespace = fakeKV();
    const challenges = createChallengeStore(namespace, { prefix: "auth:challenge" });
    await challenges.put("k1", CHALLENGE, TTL);
    const other = createChallengeStore(namespace, { prefix: "other" });
    expect(await other.take("k1")).toEqual({ ok: true, data: null });
    expect(await challenges.take("k1")).toEqual({ ok: true, data: CHALLENGE });
  });

  it("refuses an empty prefix, which would drop the namespacing the prefix exists for", () => {
    expect(() => createChallengeStore(fakeKV(), { prefix: "" })).toThrow("createChallengeStore: `prefix` must not be an empty string");
  });

  it("refuses a TTL below the 60-second floor KV enforces, rather than quietly extending it", () => {
    const store = createChallengeStore(fakeKV());
    expect(store.put("k1", CHALLENGE, 30)).rejects.toThrow(
      "challenges.put: KV refuses an expiration under 60 seconds — configure a longer challenge lifetime",
    );
    expect(store.put("k1", CHALLENGE, 60.5)).rejects.toThrow("challenges.put: KV refuses an expiration under 60 seconds");
  });

  it("accepts exactly the floor", async () => {
    expect(await createChallengeStore(fakeKV()).put("k1", CHALLENGE, 60)).toEqual({ ok: true, data: undefined });
  });
});

describe("createChallengeStore — failures", () => {
  function brokenKV(failing: "get" | "put" | "delete"): Parameters<typeof createChallengeStore>[0] {
    const namespace = fakeKV();
    return {
      ...namespace,
      get: failing === "get" ? () => Promise.reject(new Error("KV unreachable")) : namespace.get.bind(namespace),
      put: failing === "put" ? () => Promise.reject(new Error("KV unreachable")) : namespace.put.bind(namespace),
      delete: failing === "delete" ? () => Promise.reject(new Error("KV unreachable")) : namespace.delete.bind(namespace),
    } as Parameters<typeof createChallengeStore>[0];
  }

  it("surfaces a write failure as an AuthStoreError, not as a thrown error", async () => {
    const outcome = await createChallengeStore(brokenKV("put")).put("k1", CHALLENGE, TTL);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
    expect(outcome.ok === false && outcome.error.operation).toBe("challenges.put");
  });

  it("surfaces a read failure the same way", async () => {
    const outcome = await createChallengeStore(brokenKV("get")).take("k1");
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
    expect(outcome.ok === false && outcome.error.operation).toBe("challenges.take");
  });

  it("reports a delete that fails after a successful read, rather than returning the value", async () => {
    const namespace = brokenKV("delete");
    await createChallengeStore(namespace).put("k1", CHALLENGE, TTL);
    const outcome = await createChallengeStore(namespace).take("k1");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.operation).toBe("challenges.take");
  });
});
