import { describe, expect, it } from "bun:test";

import { checkedBookmark, isD1Bookmark } from "./bookmark";
import { D1BackupError } from "./errors";

describe("isD1Bookmark()", () => {
  it("accepts D1's bookmark shape and the local stand-in", () => {
    expect(["00000085-0000024c-00004c6d-8e61117bf38d7adb", "local-1793584800000", "A"].map(isD1Bookmark)).toEqual([true, true, true]);
  });

  it("refuses anything that could escape an object key or a URL path", () => {
    expect(["", "../escape", "-leading", "a/b", "a.b", "x".repeat(129)].map(isD1Bookmark)).toEqual([false, false, false, false, false, false]);
  });
});

describe("checkedBookmark()", () => {
  it("answers a bookmark in the grammar, and refuses one outside it as malformed", () => {
    expect(checkedBookmark("B1")).toBe("B1");
    expect(() => checkedBookmark("../x")).toThrow(D1BackupError);
  });
});
