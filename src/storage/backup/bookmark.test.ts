import { describe, expect, it } from "bun:test";

import { isD1Bookmark } from "./bookmark";

describe("isD1Bookmark()", () => {
  it("accepts D1's bookmark shape and the local stand-in", () => {
    expect(["00000085-0000024c-00004c6d-8e61117bf38d7adb", "local-1793584800000", "A"].map(isD1Bookmark)).toEqual([true, true, true]);
  });

  it("accepts a bookmark of 128 characters, the longest D1's grammar allows", () => {
    expect(isD1Bookmark("x".repeat(128))).toBe(true);
  });

  it("refuses anything that could escape an object key or a URL path", () => {
    expect(["", "../escape", "-leading", "a/b", "a.b", "x".repeat(129)].map(isD1Bookmark)).toEqual([false, false, false, false, false, false]);
  });
});
