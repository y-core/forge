import { describe, expect, it } from "bun:test";

import { PRECACHE_URLS, PRECACHE_VERSION } from "./precache";

describe("PRECACHE_URLS", () => {
  it("is empty outside the service-worker build, so a test of a worker precaches nothing", () => {
    expect(PRECACHE_URLS).toEqual([]);
  });
});

describe("PRECACHE_VERSION", () => {
  it("is empty outside the service-worker build, so a worker under test names no cache of its own", () => {
    expect(PRECACHE_VERSION).toBe("");
  });
});
