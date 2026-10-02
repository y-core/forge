import { describe, expect, test } from "bun:test";

import { MAX_DESTINATION_PARENS, MAX_LABEL_LENGTH, scanDefinition } from "./definition";

describe("scanDefinition caps", () => {
  test("accepts a label of 999 characters and refuses one of 1000, as the spec bounds it", () => {
    expect(MAX_LABEL_LENGTH).toBe(999);
    expect(scanDefinition(`[${"a".repeat(999)}]: /u`, 0)?.url).toBe("/u");
    expect(scanDefinition(`[${"a".repeat(1000)}]: /u`, 0)).toBeNull();
  });

  test("counts a backslash escape inside a label as two of its characters", () => {
    expect(scanDefinition(`[${"a".repeat(997)}\\]]: /u`, 0)?.url).toBe("/u");
    expect(scanDefinition(`[${"a".repeat(998)}\\]]: /u`, 0)).toBeNull();
  });

  test("accepts 32 nested parentheses in a bare destination and refuses 33", () => {
    expect(MAX_DESTINATION_PARENS).toBe(32);
    const nested = (depth: number) => "(".repeat(depth) + "x" + ")".repeat(depth);
    expect(scanDefinition(`[a]: ${nested(32)}`, 0)?.url).toBe(nested(32));
    expect(scanDefinition(`[a]: ${nested(33)}`, 0)).toBeNull();
  });

  test("refuses a label holding only whitespace", () => {
    expect(scanDefinition("[ \t]: /u", 0)).toBeNull();
  });
});
