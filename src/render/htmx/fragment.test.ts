import { describe, expect, it } from "bun:test";

import { html as safeHtml } from "../../html/html";
import { attrOf, elementOf, innerOf } from "../../testing/markup";
import { renderError, renderSuccess, renderValidationErrors } from "./fragment";

const PREDEFINED_REFERENCES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes character references the way an HTML parser does before `getAttribute` or `textContent` answers, in one pass. */
function decoded(value: string): string {
  return value.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z]+));/g, (whole, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return String.fromCodePoint(Number.parseInt(dec, 10));
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    return PREDEFINED_REFERENCES[name ?? ""] ?? whole;
  });
}

/** What a browser reads back from a banner: the marker the announcer speaks, and the lead paragraph a sighted user sees. */
function readBack(banner: string): { announced: string; shown: string } {
  return { announced: decoded(attrOf(banner, "data-announce-failure")), shown: decoded(innerOf(elementOf(banner, "p"))) };
}

describe("renderSuccess", () => {
  it("produces the expected default HTML", () => {
    expect(String(renderSuccess("Thanks for reaching out."))).toBe(
      '<div class="rounded-2xl border border-status-success-border bg-status-success-subtle px-4 py-3 text-sm text-status-success-subtle-foreground" data-success><p>Thanks for reaching out.</p></div>',
    );
  });

  it("HTML-encodes the message", () => {
    expect(String(renderSuccess("It's done & <verified>"))).toBe(
      '<div class="rounded-2xl border border-status-success-border bg-status-success-subtle px-4 py-3 text-sm text-status-success-subtle-foreground" data-success><p>It&#39;s done &amp; &lt;verified&gt;</p></div>',
    );
  });

  it("accepts a custom class", () => {
    const html = String(renderSuccess("OK", { class: "my-class" }));
    expect(html).toBe('<div class="my-class" data-success><p>OK</p></div>');
  });

  it("accepts a custom successAttr", () => {
    const html = String(renderSuccess("OK", { successAttr: "data-status" }));
    expect(html).toBe(
      '<div class="rounded-2xl border border-status-success-border bg-status-success-subtle px-4 py-3 text-sm text-status-success-subtle-foreground" data-status><p>OK</p></div>',
    );
  });

  it("throws on an invalid successAttr containing special characters", () => {
    expect(() => renderSuccess("OK", { successAttr: 'data-status="success"' })).toThrow("Invalid successAttr");
  });

  it("does not throw for a valid successAttr like 'data-status'", () => {
    expect(() => renderSuccess("OK", { successAttr: "data-status" })).not.toThrow();
  });

  it("throws when successAttr contains a space (e.g. 'on click')", () => {
    expect(() => renderSuccess("OK", { successAttr: "on click" })).toThrow("Invalid successAttr");
  });

  it("throws when successAttr starts with a digit (e.g. '123bad')", () => {
    expect(() => renderSuccess("OK", { successAttr: "123bad" })).toThrow("Invalid successAttr");
  });

  it("matches exact output consumed by worker tests", () => {
    expect(String(renderSuccess("Thanks. We'll review your note and get back to you soon."))).toBe(
      '<div class="rounded-2xl border border-status-success-border bg-status-success-subtle px-4 py-3 text-sm text-status-success-subtle-foreground" data-success><p>Thanks. We&#39;ll review your note and get back to you soon.</p></div>',
    );
  });
});

describe("renderError", () => {
  it("produces the expected default HTML", () => {
    expect(String(renderError("Something went wrong."))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Something went wrong."><p>Something went wrong.</p></div>',
    );
  });

  it("HTML-encodes the message", () => {
    expect(String(renderError("<b>Bad</b> input"))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="&lt;b&gt;Bad&lt;/b&gt; input"><p>&lt;b&gt;Bad&lt;/b&gt; input</p></div>',
    );
  });

  it("escapes the announced message, so a quote cannot close the marker attribute", () => {
    expect(String(renderError('Say "hi" & <go>', { class: "error-box" }))).toBe(
      '<div class="error-box" data-announce-failure="Say &quot;hi&quot; &amp; &lt;go&gt;"><p>Say &quot;hi&quot; &amp; &lt;go&gt;</p></div>',
    );
  });

  it("accepts a custom class", () => {
    const html = String(renderError("Oops", { class: "error-box" }));
    expect(html).toBe('<div class="error-box" data-announce-failure="Oops"><p>Oops</p></div>');
  });
});

describe("renderError — the announced message", () => {
  const cases = [
    { name: "double quotes", message: 'Say "hi" to the team' },
    { name: "apostrophes", message: "It's 'quoted'" },
    { name: "an ampersand", message: "Fish & chips" },
    { name: "angle brackets", message: "Use <name> & not <id>" },
    { name: "a script element", message: "<script>alert(1)</script>" },
    { name: "text that already looks escaped", message: "&amp; &lt;b&gt; &#39;" },
    { name: "accented, CJK and astral characters", message: "Café — 日本語 🙂" },
    { name: "right-to-left text", message: "שגיאה בשמירה" },
    { name: "surrounding whitespace", message: "  padded  " },
    { name: "the empty string", message: "" },
  ];

  for (const { name, message } of cases) {
    it(`reads back as the raw message, equal to the shown text, for ${name}`, () => {
      expect(readBack(String(renderError(message)))).toEqual({ announced: message, shown: message });
    });
  }

  it("announces markup in the message as text, emitting no element of its own", () => {
    const banner = String(renderError("<b>Bad</b> input"));

    expect({ announced: readBack(banner).announced, bold: elementOf(banner, "b") }).toEqual({ announced: "<b>Bad</b> input", bold: "" });
  });

  it("refuses a SafeHtml message cast past the string signature, rather than splicing its markup into the marker", () => {
    const trusted = safeHtml`<b>${"Bad"}</b> input`;

    expect(() => renderError(trusted as unknown as string)).toThrow(TypeError);
  });

  it("keeps the marker on a banner given a custom class", () => {
    expect(readBack(String(renderError("Oops", { class: "error-box" })))).toEqual({ announced: "Oops", shown: "Oops" });
  });
});

describe("renderValidationErrors", () => {
  it("renders a list of errors", () => {
    expect(String(renderValidationErrors(["Name is required.", "Email is invalid."]))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>Name is required.</li><li>Email is invalid.</li></ul></div>',
    );
  });

  it("HTML-encodes each error message", () => {
    expect(String(renderValidationErrors(['Field <b>x</b> is "bad"']))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>Field &lt;b&gt;x&lt;/b&gt; is &quot;bad&quot;</li></ul></div>',
    );
  });

  it("renders an empty list when no errors are passed", () => {
    const html = String(renderValidationErrors([]));
    expect(html).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"></ul></div>',
    );
  });

  it("accepts a custom class", () => {
    expect(String(renderValidationErrors(["Required."], { class: "val-box" }))).toBe(
      '<div class="val-box" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>Required.</li></ul></div>',
    );
  });
});

describe("renderValidationErrors — the announced lead", () => {
  const cases = [
    { name: "one plain error", errors: ["Name is required."] },
    { name: "several errors", errors: ["Name is required.", "Email is invalid."] },
    { name: "an error that tries to close the marker attribute", errors: ['" data-announce-failure="pwned'] },
    { name: "an error holding markup and non-ASCII", errors: ["<b>Ünïcode</b> & 'quotes'"] },
    { name: "no errors at all", errors: [] },
  ];

  for (const { name, errors } of cases) {
    it(`announces the lead and only the lead for ${name}`, () => {
      const banner = String(renderValidationErrors(errors));

      expect(readBack(banner)).toEqual({ announced: "Please correct the following fields.", shown: "Please correct the following fields." });
    });
  }

  it("keeps each error item as text beneath the announced lead", () => {
    const banner = String(renderValidationErrors(['" data-announce-failure="pwned', "<b>Ünïcode</b> & 'quotes'"]));
    const items = [...banner.matchAll(/<li>(.*?)<\/li>/g)].map((match) => decoded(match[1] ?? ""));

    expect(items).toEqual(['" data-announce-failure="pwned', "<b>Ünïcode</b> & 'quotes'"]);
  });
});

describe("fragment option escaping", () => {
  // Each option value below closes the `class` attribute and opens a tag, the injection the escaping exists to stop.
  it("escapes a malicious class value in renderError", () => {
    expect(String(renderError("oops", { class: '"><script>alert(1)</script>' }))).toBe(
      '<div class="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" data-announce-failure="oops"><p>oops</p></div>',
    );
  });

  it("escapes a malicious class value in renderSuccess", () => {
    expect(String(renderSuccess("ok", { class: '"><img src=x onerror=alert(1)>' }))).toBe(
      '<div class="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-success><p>ok</p></div>',
    );
  });

  it("escapes a malicious ulClass value in renderValidationErrors", () => {
    expect(String(renderValidationErrors(["bad"], { ulClass: '"><script>x</script>' }))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground" data-announce-failure="Please correct the following fields."><p>Please correct the following fields.</p><ul class="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"><li>bad</li></ul></div>',
    );
  });
});
