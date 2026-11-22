import { describe, expect, it } from "bun:test";

import { assertKVSessionTtl, KV_MIN_TTL_SECONDS } from "../session/kv-storage";
import { AUTH_KV_MIN_TTL_SECONDS } from "./config";

describe("AUTH_KV_MIN_TTL_SECONDS", () => {
  it("is session storage's KV floor, not a second copy of it", () => {
    expect(AUTH_KV_MIN_TTL_SECONDS).toBe(KV_MIN_TTL_SECONDS);
  });

  it("sits exactly on the 60-second minimum expirationTtl Workers KV accepts, as session storage enforces it", () => {
    expect(() => assertKVSessionTtl("op", "ttl", AUTH_KV_MIN_TTL_SECONDS)).not.toThrow();
    expect(() => assertKVSessionTtl("op", "ttl", AUTH_KV_MIN_TTL_SECONDS - 1)).toThrow(
      "op: ttl is 59, below the 60-second floor — the shortest expirationTtl Workers KV accepts, so every save would throw.",
    );
  });
});
