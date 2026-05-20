import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Form } from "./form";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("Form component", () => {
  it("renders a form element with method=post", async () => {
    const out = await render(<Form><input name="x" /></Form>);
    expect(out).toContain("<form");
    expect(out).toContain('method="post"');
  });

  it("sets id from formId prop", async () => {
    const out = await render(<Form formId="contact-form"><input name="x" /></Form>);
    expect(out).toContain('id="contact-form"');
  });

  it("passes through hx-post and hx-target", async () => {
    const out = await render(
      <Form hx-post="/api/contact" hx-target="#result">
        <input name="x" />
      </Form>,
    );
    expect(out).toContain('hx-post="/api/contact"');
    expect(out).toContain('hx-target="#result"');
  });

  it("sets hx-headers with X-CSRF-Token when csrfToken is provided", async () => {
    const out = await render(
      <Form csrfToken="abc123">
        <input name="x" />
      </Form>,
    );
    expect(out).toContain('hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"');
  });

  it("uses explicit hx-headers when csrfToken is absent", async () => {
    const out = await render(
      <Form hx-headers='{"X-Custom":"val"}'>
        <input name="x" />
      </Form>,
    );
    expect(out).toContain('hx-headers="{&quot;X-Custom&quot;:&quot;val&quot;}"');
  });

  it("renders a hidden CSRF input when csrfToken is provided", async () => {
    const out = await render(
      <Form csrfToken="abc123">
        <input name="x" />
      </Form>,
    );
    expect(out).toContain('type="hidden"');
    expect(out).toContain('name="_csrf"');
    expect(out).toContain('value="abc123"');
  });

  it("does not render a CSRF input when csrfToken is absent", async () => {
    const out = await render(<Form><input name="x" /></Form>);
    expect(out).not.toContain('name="_csrf"');
  });

  it("renders the honeypot field with default name 'surname'", async () => {
    const out = await render(<Form><input name="x" /></Form>);
    expect(out).toContain('name="surname"');
    expect(out).toContain("tabindex");
    expect(out).toContain('autocomplete="off"');
  });

  it("renders the honeypot with a custom field name", async () => {
    const out = await render(<Form honeypotField="website"><input name="x" /></Form>);
    expect(out).toContain('name="website"');
    expect(out).not.toContain('name="surname"');
  });

  it("wraps the honeypot in an aria-hidden container", async () => {
    const out = await render(<Form><input name="x" /></Form>);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("-left-[9999px]");
  });

  it("renders children inside the form", async () => {
    const out = await render(
      <Form>
        <input name="message" id="msg" />
      </Form>,
    );
    expect(out).toContain('name="message"');
    expect(out).toContain('id="msg"');
  });

  it("passes through hx-disabled-elt", async () => {
    const out = await render(
      <Form hx-disabled-elt="find [data-ref='submit']">
        <input name="x" />
      </Form>,
    );
    expect(out).toContain("hx-disabled-elt=\"find [data-ref=&#39;submit&#39;]\"");
  });

  it("passes through hx-indicator", async () => {
    const out = await render(
      <Form hx-indicator="#spinner">
        <input name="x" />
      </Form>,
    );
    expect(out).toContain('hx-indicator="#spinner"');
  });

  it("passes through novalidate when true", async () => {
    const out = await render(
      <Form novalidate={true}>
        <input name="x" />
      </Form>,
    );
    expect(out).toContain("novalidate");
  });
});
