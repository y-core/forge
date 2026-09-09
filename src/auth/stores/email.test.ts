import { describe, expect, it } from "bun:test";

import { normalizeEmail } from "./email";

const CASES: readonly { name: string; input: string; expected: string }[] = [
  { name: "an already-normal address", input: "aurora@example.test", expected: "aurora@example.test" },
  { name: "mixed case in both parts", input: "Aurora@Example.Test", expected: "aurora@example.test" },
  { name: "surrounding whitespace", input: "  aurora@example.test\n", expected: "aurora@example.test" },
  { name: "a fullwidth domain, which NFKC folds", input: "aurora@ｅｘａｍｐｌｅ.test", expected: "aurora@example.test" },
  { name: "a ligature, which NFKC decomposes", input: "oﬀice@example.test", expected: "office@example.test" },
  { name: "a Turkish dotted capital I, which ASCII folding misses", input: "İSMAIL@example.test", expected: "i̇smail@example.test" },
  { name: "a plus tag, which is a distinct mailbox and stays", input: "aurora+news@example.test", expected: "aurora+news@example.test" },
  { name: "a dot in the local part, which stays", input: "au.rora@example.test", expected: "au.rora@example.test" },
];

describe("normalizeEmail", () => {
  it("returns the exact normalized form for every case", () => {
    for (const { name, input, expected } of CASES) {
      expect(`${name}: ${normalizeEmail(input)}`).toBe(`${name}: ${expected}`);
    }
  });

  it("maps two spellings of one mailbox to the same key", () => {
    expect(normalizeEmail("Aurora@Example.Test")).toBe(normalizeEmail(" aurora@example.test "));
    expect(normalizeEmail("aurora@ｅｘａｍｐｌｅ.test")).toBe(normalizeEmail("aurora@example.test"));
  });

  it("keeps two different mailboxes apart", () => {
    expect(normalizeEmail("aurora@example.test")).not.toBe(normalizeEmail("aurora+news@example.test"));
    expect(normalizeEmail("aurora@example.test")).not.toBe(normalizeEmail("au.rora@example.test"));
  });

  it("is idempotent", () => {
    for (const { input } of CASES) {
      expect(normalizeEmail(normalizeEmail(input))).toBe(normalizeEmail(input));
    }
  });
});
