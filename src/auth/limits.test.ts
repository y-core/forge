import { describe, expect, it } from "bun:test";

import { authLimit } from "./limits";
import type { AuthLimit } from "./types";

const TTL: AuthLimit = {
  fallback: 300,
  min: 60,
  max: 600,
  unit: "second",
  floor: "the shortest expiration the challenge store accepts",
  ceiling: "a replayable challenge must not outlive an emailed code",
};

describe("authLimit — resolving the default", () => {
  it("answers the fallback when nothing was configured", () => {
    expect(authLimit("createThing", "ttlSeconds", undefined, TTL)).toBe(300);
  });

  it("answers the configured value when one was given", () => {
    expect(authLimit("createThing", "ttlSeconds", 120, TTL)).toBe(120);
  });
});

describe("authLimit — the range it refuses outside", () => {
  it("names the floor and the reason it exists", () => {
    expect(() => authLimit("createThing", "ttlSeconds", 1, TTL)).toThrow(
      "createThing: ttlSeconds is 1, below the 60-second floor — the shortest expiration the challenge store accepts.",
    );
  });

  it("names the ceiling and the reason it exists", () => {
    expect(() => authLimit("createThing", "ttlSeconds", 86_400, TTL)).toThrow(
      "createThing: ttlSeconds is 86400, above the 600-second ceiling — a replayable challenge must not outlive an emailed code.",
    );
  });

  it("accepts both bounds themselves, so the comparison is `<` and `>` and not `<=` and `>=`", () => {
    expect(authLimit("createThing", "ttlSeconds", 60, TTL)).toBe(60);
    expect(authLimit("createThing", "ttlSeconds", 600, TTL)).toBe(600);
  });

  it("accepts any value above the floor when no ceiling was stated", () => {
    const open: AuthLimit = { fallback: 20, min: 16, unit: "byte", floor: "the floor RFC 4226 states for a shared secret" };
    expect(authLimit("createThing", "secretBytes", 4096, open)).toBe(4096);
    expect(() => authLimit("createThing", "secretBytes", 4, open)).toThrow(
      "createThing: secretBytes is 4, below the 16-byte floor — the floor RFC 4226 states for a shared secret.",
    );
  });

  it("states the bare number when the knob counts nothing a unit names", () => {
    const bare: AuthLimit = { fallback: 3, min: 1, max: 10, floor: "a factor allowing no guess is permanently broken", ceiling: "ten is enough" };
    expect(() => authLimit("createThing", "maxAttempts", 0, bare)).toThrow(
      "createThing: maxAttempts is 0, below the 1 floor — a factor allowing no guess is permanently broken.",
    );
    expect(() => authLimit("createThing", "maxAttempts", 11, bare)).toThrow(
      "createThing: maxAttempts is 11, above the 10 ceiling — ten is enough.",
    );
  });
});

describe("authLimit — whole numbers only", () => {
  it("refuses a fraction inside the range, which a TTL store would refuse later and elsewhere", () => {
    expect(() => authLimit("createThing", "ttlSeconds", 120.5, TTL)).toThrow("createThing: ttlSeconds is 120.5, which is not a whole number.");
  });

  it("refuses a value that is not a number at all", () => {
    expect(() => authLimit("createThing", "ttlSeconds", Number.NaN, TTL)).toThrow("createThing: ttlSeconds is NaN, which is not a whole number.");
    expect(() => authLimit("createThing", "ttlSeconds", Number.POSITIVE_INFINITY, TTL)).toThrow(
      "createThing: ttlSeconds is Infinity, which is not a whole number.",
    );
  });
});
