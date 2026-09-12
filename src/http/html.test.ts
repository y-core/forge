import { describe, expect, it } from "bun:test";

import { html, isSafeHtml, rawHtml, SafeHtml } from "./html";

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
