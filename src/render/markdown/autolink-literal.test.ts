import { describe, expect, test } from "bun:test";

import { createAutolinkLiteralScanner, mayStartAutolinkLiteral } from "./autolink-literal";

function scanned(content: string, at = 0) {
  return createAutolinkLiteralScanner(content).scan(at);
}

describe("createAutolinkLiteralScanner", () => {
  test("links a www. domain over http and an http(s):// URL as written", () => {
    expect([scanned("www.example.com"), scanned("https://example.com/a")]).toEqual([
      { end: 15, url: "http://www.example.com" },
      { end: 21, url: "https://example.com/a" },
    ]);
  });

  test("links an email address over mailto", () => {
    expect(scanned("a.b@example.com")).toEqual({ end: 15, url: "mailto:a.b@example.com" });
  });

  test("stops before trailing punctuation and an unbalanced closing paren", () => {
    expect([scanned("www.a.com."), scanned("www.a.com/b)")]).toEqual([
      { end: 9, url: "http://www.a.com" },
      { end: 11, url: "http://www.a.com/b" },
    ]);
  });

  test("stops before a trailing entity-like run", () => {
    expect(scanned("www.a.com/b&amp;")).toEqual({ end: 11, url: "http://www.a.com/b" });
  });

  test("answers null for a domain with an underscore in its last two labels, or no dot after www", () => {
    expect([scanned("www.a_b.com"), scanned("www")]).toEqual([null, null]);
  });

  test("leaves ftp:// to CommonMark, as micromark does", () => {
    expect(scanned("ftp://a.com")).toBeNull();
  });
});

describe("mayStartAutolinkLiteral", () => {
  test("answers true where a literal could start and false mid-word", () => {
    expect([
      mayStartAutolinkLiteral("www.a", 0),
      mayStartAutolinkLiteral(" www.a", 1),
      mayStartAutolinkLiteral("awww.a", 1),
      mayStartAutolinkLiteral("xhttps://a", 1),
      mayStartAutolinkLiteral("a@b.c", 0),
      mayStartAutolinkLiteral("/a@b.c", 1),
    ]).toEqual([true, true, false, false, true, false]);
  });
});
