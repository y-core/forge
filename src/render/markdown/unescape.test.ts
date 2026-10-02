import { describe, expect, test } from "bun:test";

import { readCharacterReference, unescapeSpan } from "./unescape";

function unescaped(source: string): string {
  return unescapeSpan(source, 0, source.length);
}

describe("readCharacterReference", () => {
  test("reads a named, a decimal and a hexadecimal reference, ending past the semicolon", () => {
    expect([readCharacterReference("&amp;x", 0, 6), readCharacterReference("&#35;", 0, 5), readCharacterReference("&#X22;", 0, 6)]).toEqual([
      { text: "&", end: 5 },
      { text: "#", end: 5 },
      { text: '"', end: 6 },
    ]);
  });

  test("answers null for a name HTML does not define, a missing semicolon, or a reference past the limit", () => {
    expect([readCharacterReference("&nope;", 0, 6), readCharacterReference("&amp", 0, 4), readCharacterReference("&amp;", 0, 4)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("answers null for a numeric reference of more than seven decimal or six hexadecimal digits", () => {
    expect([readCharacterReference("&#12345678;", 0, 11), readCharacterReference("&#x1234567;", 0, 11)]).toEqual([null, null]);
  });

  test("replaces NUL, a surrogate, a noncharacter and a code point past Unicode with U+FFFD", () => {
    expect(["&#0;", "&#xD800;", "&#xFFFE;", "&#x110000;"].map((source) => readCharacterReference(source, 0, source.length)?.text)).toEqual([
      "\u{fffd}",
      "\u{fffd}",
      "\u{fffd}",
      "\u{fffd}",
    ]);
  });
});

describe("unescapeSpan", () => {
  test("drops the backslash before ASCII punctuation and keeps it before anything else", () => {
    expect([unescaped("\\*a\\_"), unescaped("\\a\\ ")]).toEqual(["*a_", "\\a\\ "]);
  });

  test("decodes references and leaves a malformed one as written", () => {
    expect(unescaped("&copy; &#169; &bogus; &")).toBe("© © &bogus; &");
  });

  test("keeps an escaped ampersand from starting a reference", () => {
    expect(unescaped("\\&amp;")).toBe("&amp;");
  });

  test("replaces NUL with U+FFFD", () => {
    expect(unescaped("a\u0000b")).toBe("a\u{fffd}b");
  });

  test("reads only the span it is given", () => {
    expect(unescapeSpan("xx\\*yy", 2, 4)).toBe("*");
  });
});
