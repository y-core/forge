import { describe, expect, it } from "bun:test";
import { html, isSafeHtml, rawHtml } from "./html";

describe("rawHtml", () => {
  it("marks a string as SafeHtml so the html tag interpolates it unescaped", () => {
    const safe = rawHtml("<b>bold</b>");
    expect(String(html`<div>${safe}</div>`)).toBe("<div><b>bold</b></div>");
  });

  it("plain strings remain escaped by contrast", () => {
    expect(String(html`<div>${"<b>bold</b>"}</div>`)).toBe("<div>&lt;b&gt;bold&lt;/b&gt;</div>");
  });
});

describe("isSafeHtml", () => {
  it("recognizes rawHtml and html-tag output, rejects plain strings", () => {
    expect(isSafeHtml(rawHtml("<i>x</i>"))).toBe(true);
    expect(isSafeHtml(html`<i>x</i>`)).toBe(true);
    expect(isSafeHtml("<i>x</i>")).toBe(false);
  });
});
