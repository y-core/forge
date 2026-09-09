import { describe, expect, it } from "bun:test";

import { fakeKV } from "../../testing/fakes";
import { AuthStoreError } from "../errors";
import { createNonceStore } from "./nonces";

const TTL = 900;

describe("createNonceStore", () => {
  it("reports true the first time a key is seen and false after", async () => {
    const store = createNonceStore(fakeKV());
    expect(await store.markConsumed("n1", TTL)).toEqual({ ok: true, data: true });
    expect(await store.markConsumed("n1", TTL)).toEqual({ ok: true, data: false });
    expect(await store.markConsumed("n1", TTL)).toEqual({ ok: true, data: false });
  });

  it("keeps two keys independent", async () => {
    const store = createNonceStore(fakeKV());
    expect(await store.markConsumed("n1", TTL)).toEqual({ ok: true, data: true });
    expect(await store.markConsumed("n2", TTL)).toEqual({ ok: true, data: true });
  });

  // `fakeKV` records a TTL and never enforces one, so expiry itself is not observable here. What is
  // observable is that the configured lifetime reaches the binding, and that a key the binding no
  // longer holds — which is what an expired one looks like — is consumable again.
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
    await createNonceStore(recording, { prefix: "p" }).markConsumed("n1", TTL);
    expect(writes).toEqual([{ key: "p||n1", ttl: TTL }]);
  });

  it("lets a key the binding no longer holds be consumed again", async () => {
    const namespace = fakeKV();
    const store = createNonceStore(namespace, { prefix: "p" });
    await store.markConsumed("n1", TTL);
    await namespace.delete("p||n1");
    expect(await store.markConsumed("n1", TTL)).toEqual({ ok: true, data: true });
  });

  it("namespaces its keys under a prefix", async () => {
    const namespace = fakeKV();
    await createNonceStore(namespace, { prefix: "auth:nonce" }).markConsumed("n1", TTL);
    expect(await createNonceStore(namespace, { prefix: "other" }).markConsumed("n1", TTL)).toEqual({ ok: true, data: true });
  });

  it("refuses an empty prefix, which would drop the namespacing the prefix exists for", () => {
    expect(() => createNonceStore(fakeKV(), { prefix: "" })).toThrow("createNonceStore: `prefix` must not be an empty string");
  });

  it("refuses a TTL below the 60-second floor KV enforces", () => {
    const store = createNonceStore(fakeKV());
    expect(store.markConsumed("n1", 59)).rejects.toThrow(
      "nonces.markConsumed: KV refuses an expiration under 60 seconds — configure a longer nonce lifetime",
    );
  });

  it("accepts exactly the floor", async () => {
    expect(await createNonceStore(fakeKV()).markConsumed("n1", 60)).toEqual({ ok: true, data: true });
  });
});

describe("createNonceStore — failures", () => {
  function brokenKV(failing: "get" | "put"): Parameters<typeof createNonceStore>[0] {
    const namespace = fakeKV();
    return {
      ...namespace,
      get: failing === "get" ? () => Promise.reject(new Error("KV unreachable")) : namespace.get.bind(namespace),
      put: failing === "put" ? () => Promise.reject(new Error("KV unreachable")) : namespace.put.bind(namespace),
    } as Parameters<typeof createNonceStore>[0];
  }

  it("surfaces a write failure as an AuthStoreError, not as a thrown error", async () => {
    const outcome = await createNonceStore(brokenKV("put")).markConsumed("n1", TTL);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(AuthStoreError);
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
    expect(outcome.ok === false && outcome.error.operation).toBe("nonces.markConsumed");
  });

  it("surfaces a read failure the same way, and never reports a nonce fresh because the read failed", async () => {
    const outcome = await createNonceStore(brokenKV("get")).markConsumed("n1", TTL);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.code).toBe("unavailable");
  });
});
