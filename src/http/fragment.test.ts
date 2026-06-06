import { describe, expect, it } from "bun:test";
import { renderError, renderSuccess, renderValidationErrors } from "./fragment";

describe("renderSuccess", () => {
  it("produces the expected default HTML", () => {
    expect(String(renderSuccess("Thanks for reaching out."))).toBe(
      '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-success><p>Thanks for reaching out.</p></div>',
    );
  });

  it("HTML-encodes the message", () => {
    expect(String(renderSuccess("It's done & <verified>"))).toBe(
      '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-success><p>It&#39;s done &amp; &lt;verified&gt;</p></div>',
    );
  });

  it("accepts a custom class", () => {
    const html = String(renderSuccess("OK", { class: "my-class" }));
    expect(html).toBe('<div class="my-class" data-success><p>OK</p></div>');
  });

  it("accepts a custom successAttr", () => {
    const html = String(renderSuccess("OK", { successAttr: 'data-status="success"' }));
    expect(html).toBe(
      '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-status="success"><p>OK</p></div>',
    );
  });

  it("matches exact output consumed by worker tests", () => {
    expect(String(renderSuccess("Thanks. We'll review your note and get back to you soon."))).toBe(
      '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-success><p>Thanks. We&#39;ll review your note and get back to you soon.</p></div>',
    );
  });
});

describe("renderError", () => {
  it("produces the expected default HTML", () => {
    expect(String(renderError("Something went wrong."))).toBe(
      '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>Something went wrong.</p></div>',
    );
  });

  it("HTML-encodes the message", () => {
    expect(String(renderError("<b>Bad</b> input"))).toBe(
      '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>&lt;b&gt;Bad&lt;/b&gt; input</p></div>',
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
      '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5"><li>Name is required.</li><li>Email is invalid.</li></ul></div>',
    );
  });

  it("HTML-encodes each error message", () => {
    const html = String(renderValidationErrors(['Field <b>x</b> is "bad"']));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&quot;bad&quot;");
    expect(html).not.toContain("<b>");
  });

  it("renders an empty list when no errors are passed", () => {
    const html = String(renderValidationErrors([]));
    expect(html).toBe(
      '<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5"></ul></div>',
    );
  });

  it("accepts a custom class", () => {
    const html = String(renderValidationErrors(["Required."], { class: "val-box" }));
    expect(html).toContain('class="val-box"');
  });
});

describe("fragment option escaping", () => {
  it("escapes a malicious class value in renderError", () => {
    const html = String(renderError("oops", { class: '"><script>alert(1)</script>' }));
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("escapes a malicious class value in renderSuccess", () => {
    const html = String(renderSuccess("ok", { class: '"><img src=x onerror=alert(1)>' }));
    expect(html).toContain("&quot;&gt;&lt;img");
    expect(html).not.toContain("<img");
  });

  it("escapes a malicious ulClass value in renderValidationErrors", () => {
    const html = String(renderValidationErrors(["bad"], { ulClass: '"><script>x</script>' }));
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).not.toContain("<script>x");
  });
});
