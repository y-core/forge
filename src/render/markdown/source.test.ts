import { describe, expect, test } from "bun:test";

import {
  codePointAt,
  codePointBefore,
  createLineIndex,
  isAsciiPunctuation,
  isUnicodePunctuation,
  isUnicodeWhitespace,
  lineAtOffset,
  normalizeLabel,
} from "./source";

const ASCII_PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

describe("createLineIndex and lineAtOffset", () => {
  test("start a line after each of \\n, \\r\\n and a lone \\r", () => {
    expect([...createLineIndex("a\nb\r\nc\rd")]).toEqual([0, 2, 5, 7]);
  });

  test("count a trailing line ending as starting an empty last line", () => {
    expect([...createLineIndex("a\n")]).toEqual([0, 2]);
    expect([...createLineIndex("")]).toEqual([0]);
  });

  test("place each offset on its 1-based line, a line ending on the line it ends", () => {
    const starts = createLineIndex("ab\ncd\r\n\nef");
    expect([0, 1, 2, 3, 5, 6, 7, 8, 9].map((offset) => lineAtOffset(starts, offset))).toEqual([1, 1, 1, 2, 2, 2, 3, 4, 4]);
  });
});

describe("character classes", () => {
  test("ASCII punctuation is exactly the spec's 32 characters", () => {
    const found = Array.from({ length: 128 }, (_, code) => code).filter(isAsciiPunctuation);
    expect(String.fromCharCode(...found)).toBe(ASCII_PUNCTUATION);
  });

  test("whitespace is what JavaScript's \\s matches, as micromark classifies it", () => {
    const candidates = [
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x200b, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, 0x41,
    ];
    expect(candidates.map(isUnicodeWhitespace)).toEqual(candidates.map((code) => /\s/.test(String.fromCodePoint(code))));
  });

  test("Unicode punctuation takes the P and S categories, astral ones included", () => {
    expect(["!", "¡", "€", "—", "«", "\u{1d11e}", "\u{1f600}"].map((char) => isUnicodePunctuation(char.codePointAt(0) ?? 0))).toEqual(
      Array(7).fill(true),
    );
    expect(["a", "é", " ", "\u00a0", "1", "\u{1d400}"].map((char) => isUnicodePunctuation(char.codePointAt(0) ?? 0))).toEqual(Array(6).fill(false));
  });
});

describe("codePointBefore and codePointAt", () => {
  test("read a surrogate pair whole from either side", () => {
    const source = "a\u{1f600}b";
    expect([codePointBefore(source, 3), codePointAt(source, 1)]).toEqual([0x1f600, 0x1f600]);
  });

  test("read the edges of the source as line feeds, as the flanking rules treat them", () => {
    expect([codePointBefore("ab", 0), codePointAt("ab", 2)]).toEqual([0x0a, 0x0a]);
  });
});

describe("normalizeLabel", () => {
  test("case-folds, so ẞ matches SS as the spec's example requires", () => {
    expect(normalizeLabel("ẞ")).toBe(normalizeLabel("SS"));
    expect(normalizeLabel("Foo")).toBe(normalizeLabel("fOO"));
  });

  test("trims spaces, tabs and line endings and collapses runs of them to one space", () => {
    expect(normalizeLabel(" \tFoo \n\r\n bar\t")).toBe(normalizeLabel("foo bar"));
  });

  test("keeps a no-break space, which is not label whitespace", () => {
    expect(normalizeLabel("a\u00a0b")).not.toBe(normalizeLabel("a b"));
    expect(normalizeLabel("\u00a0a")).not.toBe(normalizeLabel("a"));
  });
});
