import { describe, expect, it } from "bun:test";

import { admitsMissingFetchMetadata } from "./cop.strict";

describe("admitsMissingFetchMetadata", () => {
  it("refuses a request without Fetch Metadata headers", () => {
    expect(admitsMissingFetchMetadata()).toBe(false);
  });
});
