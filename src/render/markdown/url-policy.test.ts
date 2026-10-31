import { describe, expect, it } from "bun:test";

import { parseMarkdown, renderMarkdownHtml } from "./mod";
import type { HtmlSchema } from "./mod";
import { createUrlPolicy, isSafeUrl } from "./url-policy";

describe("isSafeUrl", () => {
  it("keeps a relative, fragment or query URL on any attribute", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "/p/1" }),
      isSafeUrl({ attribute: "href", value: "#md-fn-1" }),
      isSafeUrl({ attribute: "src", value: "a.png" }),
      isSafeUrl({ attribute: "href", value: "?q=a:b" }),
    ]).toEqual([true, true, true, true]);
  });

  it("keeps https and mailto on a link, and only https on an image source", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "https://example.com" }),
      isSafeUrl({ attribute: "href", value: "mailto:a@example.com" }),
      isSafeUrl({ attribute: "xlink:href", value: "https://example.com" }),
      isSafeUrl({ attribute: "src", value: "https://example.com/a.png" }),
      isSafeUrl({ attribute: "src", value: "mailto:a@example.com" }),
    ]).toEqual([true, true, true, true, false]);
  });

  it("refuses every other scheme, in any case", () => {
    expect(
      ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:msgbox(1)", "http://x.com"].map((url) =>
        isSafeUrl({ attribute: "href", value: url }),
      ),
    ).toEqual([false, false, false, false, false]);
  });

  it("refuses a scheme hidden behind leading controls, spaces or an embedded tab", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "   javascript:alert(1)" }),
      isSafeUrl({ attribute: "href", value: "\u0001javascript:x" }),
      isSafeUrl({ attribute: "href", value: "java\tscript:x" }),
    ]).toEqual([false, false, false]);
  });

  it("refuses a protocol-relative URL, with either slash", () => {
    expect([
      isSafeUrl({ attribute: "href", value: "//evil.test" }),
      isSafeUrl({ attribute: "href", value: "\\\\evil.test" }),
      isSafeUrl({ attribute: "href", value: "/\\evil.test" }),
      isSafeUrl({ attribute: "src", value: " //evil.test" }),
    ]).toEqual([false, false, false, false]);
  });

  it("refuses every scheme on an attribute it lists no protocols for", () => {
    expect([isSafeUrl({ attribute: "title", value: "https://example.com" }), isSafeUrl({ attribute: "title", value: "/relative" })]).toEqual([
      false,
      true,
    ]);
  });
});

describe("createUrlPolicy", () => {
  const ATTRIBUTES = ["href", "xlink:href", "src", "title"];
  const VALUES = [
    "/p/1",
    "#md-fn-1",
    "?q=a:b",
    "a.png",
    "https://x.test",
    "mailto:a@x.test",
    "http://x.test",
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.test",
    "\\\\evil.test",
    "/\\evil.test",
    "   javascript:x",
    "\u0001javascript:x",
    "java\tscript:x",
  ];
  const RELATIVE_ONLY = [true, true, true, true, false, false, false, false, false, false, false, false, false, false, false];
  const CRUCIBLE_EXPECTED: Record<string, boolean[]> = {
    href: [true, true, true, true, true, true, false, false, false, false, false, false, false, false, false],
    "xlink:href": [true, true, true, true, true, true, false, false, false, false, false, false, false, false, false],
    src: [true, true, true, true, true, false, false, false, false, false, false, false, false, false, false],
    title: RELATIVE_ONLY,
  };

  it("rebuilds crucible's policy, https and mailto on a link and https on a source, and isSafeUrl answers exactly as it does", () => {
    const crucible = createUrlPolicy({ linkProtocols: ["https", "mailto"], srcProtocols: ["https"] });
    for (const attribute of ATTRIBUTES) {
      expect(VALUES.map((value) => crucible({ attribute, value }))).toEqual(CRUCIBLE_EXPECTED[attribute] as boolean[]);
      expect(VALUES.map((value) => isSafeUrl({ attribute, value }))).toEqual(CRUCIBLE_EXPECTED[attribute] as boolean[]);
    }
  });

  it("rebuilds task-forge's policy, http, https and rooted paths on a link, refusing protocol-relative paths and hidden schemes", () => {
    const taskForge = createUrlPolicy({ linkProtocols: ["http", "https"], srcProtocols: [] });
    const href = (value: string) => taskForge({ attribute: "href", value });
    expect(["http://x.test", "https://x.test", "/tasks/1", "/tasks/1#a"].map(href)).toEqual([true, true, true, true]);
    expect(
      [
        "//evil.test",
        "/\\evil.test",
        "\\\\evil.test",
        " //evil.test",
        "/\t/evil.test",
        "\u0001//evil.test",
        "java\tscript:x",
        "\u0001javascript:x",
        "javascript:x",
        "mailto:a@x.test",
        "data:text/html,x",
      ].map(href),
    ).toEqual([false, false, false, false, false, false, false, false, false, false, false]);
    expect([taskForge({ attribute: "src", value: "https://x.test/a.png" }), taskForge({ attribute: "src", value: "/a.png" })]).toEqual([
      false,
      true,
    ]);
  });

  it("keeps an http link and a rooted path and drops a protocol-relative one when renderMarkdownHtml uses task-forge's policy", () => {
    const allowsUrl = createUrlPolicy({ linkProtocols: ["http", "https"], srcProtocols: [] });
    const schema: HtmlSchema = {
      elements: { p: {}, a: { attributes: ["href"], urls: ["href"], requires: ["href"] } },
      url: (candidate) => (allowsUrl(candidate) ? candidate.value : null),
    };
    expect(renderMarkdownHtml(parseMarkdown("[a](http://x.test) [b](//evil.test) [c](/tasks/1)"), { schema })).toBe(
      '<p><a href="http://x.test">a</a> b <a href="/tasks/1">c</a></p>',
    );
  });

  it("refuses a listed scheme written in uppercase", () => {
    expect(isSafeUrl({ attribute: "href", value: "HTTPS://x.test" })).toBe(false);
  });

  it("treats an attribute named after an Object.prototype member as one with no protocols, without throwing", () => {
    const policy = createUrlPolicy({ linkProtocols: ["https"], srcProtocols: ["https"] });
    expect(
      ["constructor", "toString"].flatMap((attribute) => [policy({ attribute, value: "/x" }), policy({ attribute, value: "https://x.test" })]),
    ).toEqual([true, false, true, false]);
  });

  it("throws on a protocol written with its colon, in uppercase, empty or padded, in either list", () => {
    for (const protocol of ["https:", "HTTPS", "", " https"]) {
      expect(() => createUrlPolicy({ linkProtocols: [protocol], srcProtocols: [] })).toThrow(/createUrlPolicy/);
      expect(() => createUrlPolicy({ linkProtocols: [], srcProtocols: [protocol] })).toThrow(/createUrlPolicy/);
    }
  });

  it("ignores a change to the protocol list made after the policy was created", () => {
    const linkProtocols = ["https"];
    const policy = createUrlPolicy({ linkProtocols, srcProtocols: [] });
    linkProtocols.push("javascript");
    expect(policy({ attribute: "href", value: "javascript:x" })).toBe(false);
  });

  it("keeps a bare relative path and a fragment (task-forge: keeps only rooted paths)", () => {
    const taskForge = createUrlPolicy({ linkProtocols: ["http", "https"], srcProtocols: [] });
    expect([taskForge({ attribute: "href", value: "foo" }), taskForge({ attribute: "href", value: "#a" })]).toEqual([true, true]);
  });

  it("refuses an uppercase http scheme (task-forge: keeps it)", () => {
    const taskForge = createUrlPolicy({ linkProtocols: ["http", "https"], srcProtocols: [] });
    expect(taskForge({ attribute: "href", value: "HTTP://x" })).toBe(false);
  });
});
