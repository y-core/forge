import { describe, expect, it } from "bun:test";
import { escapeHtml, safeUrl } from "./escape";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes less-than", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes greater-than", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes a combined XSS payload", () => {
    expect(escapeHtml('"><script>alert(1)</script>')).toBe("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("returns a safe string unchanged", () => {
    expect(escapeHtml("Hello, world!")).toBe("Hello, world!");
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("safeUrl", () => {
  it("passes through http and https URLs unchanged", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("http://example.com")).toBe("http://example.com");
  });

  it("passes through mailto and tel URLs unchanged", () => {
    expect(safeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeUrl("tel:+15551234")).toBe("tel:+15551234");
  });

  it("passes through relative, fragment, and query URLs unchanged", () => {
    expect(safeUrl("/path/to/page")).toBe("/path/to/page");
    expect(safeUrl("../up")).toBe("../up");
    expect(safeUrl("#section")).toBe("#section");
    expect(safeUrl("?q=1")).toBe("?q=1");
  });

  it("neutralizes the javascript: scheme", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
  });

  it("neutralizes mixed-case, whitespace-padded, and control-char-obscured javascript:", () => {
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBe("#");
    expect(safeUrl("  javascript:alert(1)")).toBe("#");
    expect(safeUrl("java\tscript:alert(1)")).toBe("#");
    expect(safeUrl("\njavascript:alert(1)")).toBe("#");
  });

  it("neutralizes data: and vbscript: schemes", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeUrl("vbscript:msgbox(1)")).toBe("#");
  });
});
