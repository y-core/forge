import { describe, expect, it } from "bun:test";

import { mergeIdRefs } from "./id-refs";

const NBSP = "\u00a0";

describe("mergeIdRefs — one IDREF list, the caller's ids first and each id once", () => {
  const cases = [
    { existing: "hint", added: ["field-email-description"], expected: "hint field-email-description" },
    { existing: "a a b", added: ["b", "c", "a"], expected: "a b c" },
    { existing: "\t a \n\f\r b ", added: [" c  d "], expected: "a b c d" },
    { existing: `a${NBSP}b`, added: ["c"], expected: `a${NBSP}b c` },
    { existing: undefined, added: [undefined, "", "  "], expected: undefined },
    { existing: "", added: [], expected: undefined },
    { existing: " hint  help ", added: [], expected: "hint help" },
    { existing: undefined, added: ["tip"], expected: "tip" },
  ];

  it("merges each pair into the list a reader resolves", () => {
    expect(cases.map(({ existing, added }) => mergeIdRefs(existing, added))).toEqual(cases.map(({ expected }) => expected));
  });
});
