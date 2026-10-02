import { describe, expect, it } from "bun:test";

import { renderError, renderSuccess, renderValidationErrors } from "./fragment";

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
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Something went wrong.</p></div>',
    );
  });

  it("HTML-encodes the message", () => {
    expect(String(renderError("<b>Bad</b> input"))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>&lt;b&gt;Bad&lt;/b&gt; input</p></div>',
    );
  });

  it("accepts a custom class", () => {
    const html = String(renderError("Oops", { class: "error-box" }));
    expect(html).toBe('<div class="error-box"><p>Oops</p></div>');
  });
});

describe("renderValidationErrors", () => {
  it("renders a list of errors", () => {
    expect(String(renderValidationErrors(["Name is required.", "Email is invalid."]))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>Name is required.</li><li>Email is invalid.</li></ul></div>',
    );
  });

  it("HTML-encodes each error message", () => {
    expect(String(renderValidationErrors(['Field <b>x</b> is "bad"']))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>Field &lt;b&gt;x&lt;/b&gt; is &quot;bad&quot;</li></ul></div>',
    );
  });

  it("renders an empty list when no errors are passed", () => {
    const html = String(renderValidationErrors([]));
    expect(html).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"></ul></div>',
    );
  });

  it("accepts a custom class", () => {
    expect(String(renderValidationErrors(["Required."], { class: "val-box" }))).toBe(
      '<div class="val-box"><p>Please correct the following fields.</p><ul class="mt-2 list-disc ps-5"><li>Required.</li></ul></div>',
    );
  });
});

describe("fragment option escaping", () => {
  // Each option value below closes the `class` attribute and opens a tag, the injection the escaping exists to stop.
  it("escapes a malicious class value in renderError", () => {
    expect(String(renderError("oops", { class: '"><script>alert(1)</script>' }))).toBe(
      '<div class="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"><p>oops</p></div>',
    );
  });

  it("escapes a malicious class value in renderSuccess", () => {
    expect(String(renderSuccess("ok", { class: '"><img src=x onerror=alert(1)>' }))).toBe(
      '<div class="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;" data-success><p>ok</p></div>',
    );
  });

  it("escapes a malicious ulClass value in renderValidationErrors", () => {
    expect(String(renderValidationErrors(["bad"], { ulClass: '"><script>x</script>' }))).toBe(
      '<div class="rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground"><p>Please correct the following fields.</p><ul class="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"><li>bad</li></ul></div>',
    );
  });
});
