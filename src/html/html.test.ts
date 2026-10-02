import { describe, expect, it } from "bun:test";

import { html, isSafeHtml, rawHtml, SafeHtml, scriptJson, styleText } from "./html";

describe("rawHtml", () => {
  it("marks a string as SafeHtml so the html tag interpolates it unescaped", () => {
    const safe = rawHtml("<b>bold</b>");
    expect(String(html`<div>${safe}</div>`)).toBe("<div><b>bold</b></div>");
  });

  it("plain strings remain escaped by contrast", () => {
    expect(String(html`<div>${"<b>bold</b>"}</div>`)).toBe("<div>&lt;b&gt;bold&lt;/b&gt;</div>");
  });
});

describe("html — escaping", () => {
  it("escapes an ampersand", () => {
    expect(String(html`${"a&b"}`)).toBe("a&amp;b");
  });

  it("escapes a less-than sign", () => {
    expect(String(html`${"a<b"}`)).toBe("a&lt;b");
  });

  it("escapes a greater-than sign", () => {
    expect(String(html`${"a>b"}`)).toBe("a&gt;b");
  });

  it("escapes a double quote", () => {
    expect(String(html`${'a"b'}`)).toBe("a&quot;b");
  });

  it("escapes a single quote", () => {
    expect(String(html`${"a'b"}`)).toBe("a&#39;b");
  });

  it("escapes every special character in one value", () => {
    expect(String(html`${"&<>\"'"}`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("leaves the literal template text untouched", () => {
    expect(String(html`<p class="x">${"&"}</p>`)).toBe('<p class="x">&amp;</p>');
  });
});

describe("html — interpolated value kinds", () => {
  it("renders null as an empty string", () => {
    expect(String(html`<i>${null}</i>`)).toBe("<i></i>");
  });

  it("renders undefined as an empty string", () => {
    expect(String(html`<i>${undefined}</i>`)).toBe("<i></i>");
  });

  it("renders the number 0 rather than dropping it", () => {
    expect(String(html`<i>${0}</i>`)).toBe("<i>0</i>");
  });

  it("renders the boolean false rather than dropping it", () => {
    expect(String(html`<i>${false}</i>`)).toBe("<i>false</i>");
  });

  it("joins an array with no separator", () => {
    expect(String(html`${["a", "b", "c"]}`)).toBe("abc");
  });

  it("escapes each array member", () => {
    expect(String(html`${["<a>", "&"]}`)).toBe("&lt;a&gt;&amp;");
  });

  it("flattens nested arrays", () => {
    expect(String(html`${["a", ["b", ["c"]]]}`)).toBe("abc");
  });

  it("mixes SafeHtml and plain strings within one array", () => {
    expect(String(html`${[rawHtml("<b>x</b>"), "<i>y</i>"]}`)).toBe("<b>x</b>&lt;i&gt;y&lt;/i&gt;");
  });

  it("inlines a nested html result verbatim without double-escaping", () => {
    const cell = html`<td>${"a&b"}</td>`;
    expect(String(html`${cell}`)).toBe("<td>a&amp;b</td>");
  });
});

describe("html — misuse guard", () => {
  it("throws when called as a plain function", () => {
    expect(() => (html as unknown as (v: unknown) => unknown)("<script>x</script>")).toThrow(new TypeError("html must be used as a template tag"));
  });

  it("throws when handed a plain array without a raw member", () => {
    expect(() => (html as unknown as (v: unknown) => unknown)(["<script>"])).toThrow(new TypeError("html must be used as a template tag"));
  });

  it("no longer exposes a raw member on the tag", () => {
    expect((html as unknown as { raw?: unknown }).raw).toBeUndefined();
  });
});

describe("SafeHtml", () => {
  it("yields the same primitive through String, interpolation and valueOf", () => {
    const safe = rawHtml("<b>x</b>");
    expect(String(safe)).toBe("<b>x</b>");
    expect(`${safe}`).toBe("<b>x</b>");
    expect(safe.valueOf()).toBe("<b>x</b>");
  });

  it("is the class the html tag produces", () => {
    expect(html`<i>x</i>`).toBeInstanceOf(SafeHtml);
  });
});

/** U+2028 and U+2029, built by code point so the source carries no invisible line terminator. */
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

describe("scriptJson", () => {
  it("round-trips an ordinary value", () => {
    const out = String(scriptJson({ "@type": "Organization", name: "Acme" }));
    expect(out).toBe('{"@type":"Organization","name":"Acme"}');
    expect(JSON.parse(out)).toEqual({ "@type": "Organization", name: "Acme" });
  });

  it("leaves no < for a payload closing the script element to use", () => {
    const payload = "</script><script>alert(1)</script>";
    const out = String(scriptJson({ name: payload }));
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: payload });
  });

  it("leaves no < for a payload opening an HTML comment to use", () => {
    const out = String(scriptJson({ name: "<!--" }));
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: "<!--" });
  });

  it("escapes the two JSON-legal characters a script parser reads as line terminators", () => {
    const payload = `a${LINE_SEP}b${PARA_SEP}c`;
    const out = String(scriptJson({ s: payload }));
    expect(out).not.toContain(LINE_SEP);
    expect(out).not.toContain(PARA_SEP);
    expect(JSON.parse(out)).toEqual({ s: payload });
  });

  it("throws on a value with no JSON representation, rather than emitting a broken element", () => {
    expect(() => scriptJson(() => {})).toThrow(/no JSON representation/);
    expect(() => scriptJson(undefined)).toThrow(/no JSON representation/);
  });

  it("produces SafeHtml, so the renderer emits it without re-escaping", () => {
    expect(scriptJson({ a: 1 })).toBeInstanceOf(SafeHtml);
  });
});

describe("styleText", () => {
  it("leaves ordinary CSS unchanged", () => {
    expect(String(styleText(".a{color:red}"))).toBe(".a{color:red}");
  });

  it("leaves no < for a payload closing the style element to use", () => {
    expect(String(styleText("a{}</style><script>alert(1)</script>"))).not.toContain("<");
  });

  it("leaves no < for a payload opening an HTML comment to use", () => {
    expect(String(styleText('a{content:"<!--"}'))).not.toContain("<");
  });

  it("emits a CSS hex escape whose trailing space stops the next character joining it", () => {
    const backslash = String.fromCharCode(92);
    expect(String(styleText("<a"))).toBe(`${backslash}3c a`);
  });

  it("produces SafeHtml, so the renderer emits it without re-escaping", () => {
    expect(styleText(".a{}")).toBeInstanceOf(SafeHtml);
  });
});

describe("isSafeHtml", () => {
  it("recognizes rawHtml and html-tag output, rejects plain strings", () => {
    expect(isSafeHtml(rawHtml("<i>x</i>"))).toBe(true);
    expect(isSafeHtml(html`<i>x</i>`)).toBe(true);
    expect(isSafeHtml("<i>x</i>")).toBe(false);
  });

  it("rejects null, a plain object and a SafeHtml-shaped impostor", () => {
    expect(isSafeHtml(null)).toBe(false);
    expect(isSafeHtml({})).toBe(false);
    expect(isSafeHtml({ html: "<b>x</b>", toString: () => "<b>x</b>" })).toBe(false);
  });
});
