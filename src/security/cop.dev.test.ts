import { describe, expect, it } from "bun:test";

import { waiveFetchMetadata, admitsMissingFetchMetadata } from "./cop.dev";

describe("waiveFetchMetadata", () => {
  it("admits a request without Fetch Metadata headers", () => {
    expect(waiveFetchMetadata()).toBe(true);
  });
});

describe("admitsMissingFetchMetadata", () => {
  it("refuses in a run that does not arm the development build", () => {
    expect(admitsMissingFetchMetadata()).toBe(false);
  });
});
