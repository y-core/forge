import { describe, expect, it } from "bun:test";

import fc from "fast-check";

import { textChanges } from "./text-changes";
import type { TextChange } from "./types";

function applied(before: string, changes: readonly TextChange[]): string {
  let text = before;
  for (const change of [...changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}

const TOKENS = ["\n", "\r\n", "a", "b", " ", "# ", "😀", "😁"] as const;
const text = fc.string({ unit: fc.constantFrom(...TOKENS), maxLength: 40 });

describe("textChanges", () => {
  it("turns any text into any other, with changes in order that never overlap", () => {
    fc.assert(
      fc.property(text, text, (before, after) => {
        const changes = textChanges(before, after);
        const ordered = changes.every((change, index) => index === 0 || (changes[index - 1] as TextChange).to <= change.from);
        expect([applied(before, changes), ordered]).toEqual([after, true]);
      }),
      { numRuns: 500 },
    );
  });

  it("answers no change for identical text", () => {
    expect(textChanges("one\ntwo\n", "one\ntwo\n")).toEqual([]);
  });

  it("keeps a line both texts share out of every change, so two edits around it stay two", () => {
    expect(textChanges("one\nkeep\nthree\n", "ONE\nkeep\nthree!\n")).toEqual([
      { from: 0, to: 3, insert: "ONE" },
      { from: 14, to: 14, insert: "!" },
    ]);
  });

  it("matches a moved block of lines rather than replacing everything after the first difference", () => {
    expect(textChanges("a\nb\nc\nd\n", "a\nc\nd\nb\n")).toEqual([
      { from: 2, to: 4, insert: "" },
      { from: 8, to: 8, insert: "b\n" },
    ]);
  });

  it("never splits a surrogate pair the two texts share half of", () => {
    expect(textChanges("a😀b", "a😁b")).toEqual([{ from: 1, to: 3, insert: "😁" }]);
  });

  it("falls back to one change for a rewrite too large to match line by line", () => {
    const before = Array.from({ length: 1500 }, (_, line) => `old ${line}\n`).join("");
    const after = Array.from({ length: 1500 }, (_, line) => `new ${line}\n`).join("");

    const changes = textChanges(before, after);

    expect([changes.length, applied(before, changes)]).toEqual([1, after]);
  });
});
