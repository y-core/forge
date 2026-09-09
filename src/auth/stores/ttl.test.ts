import { describe, expect, it } from "bun:test";

import { AUTH_KV_MIN_TTL_SECONDS } from "../config";
import { assertKvTtl } from "./ttl";

describe("assertKvTtl", () => {
  it("accepts the floor itself and anything above it", () => {
    expect(() => assertKvTtl("challenges.put", AUTH_KV_MIN_TTL_SECONDS, "challenge")).not.toThrow();
    expect(() => assertKvTtl("challenges.put", 86_400, "challenge")).not.toThrow();
  });

  it("names the operation and the subject in the refusal", () => {
    expect(() => assertKvTtl("nonces.markConsumed", AUTH_KV_MIN_TTL_SECONDS - 1, "nonce")).toThrow(
      `nonces.markConsumed: KV refuses an expiration under ${AUTH_KV_MIN_TTL_SECONDS} seconds — configure a longer nonce lifetime`,
    );
  });

  it("refuses zero and a negative lifetime", () => {
    expect(() => assertKvTtl("challenges.put", 0, "challenge")).toThrow("KV refuses an expiration");
    expect(() => assertKvTtl("challenges.put", -1, "challenge")).toThrow("KV refuses an expiration");
  });

  it("refuses a lifetime that is not an integer, including NaN and Infinity", () => {
    expect(() => assertKvTtl("challenges.put", 90.5, "challenge")).toThrow("KV refuses an expiration");
    expect(() => assertKvTtl("challenges.put", Number.NaN, "challenge")).toThrow("KV refuses an expiration");
    expect(() => assertKvTtl("challenges.put", Number.POSITIVE_INFINITY, "challenge")).toThrow("KV refuses an expiration");
  });
});
