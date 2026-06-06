/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { Form } from "./form";

async function render(element: unknown): Promise<string> {
  return String(await renderToString(element));
}

describe("Form component", () => {
  it("renders a form element with method=post by default", async () => {
    const out = await render(
      <Form>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain("<form");
    expect(out).toContain('data-slot="form"');
    expect(out).toContain('method="post"');
  });

  it("uses the native id prop", async () => {
    const out = await render(
      <Form id='contact-form'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('id="contact-form"');
  });

  it("passes through hx-post and hx-target", async () => {
    const out = await render(
      <Form hx-post='/api/contact' hx-target='#result'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('hx-post="/api/contact"');
    expect(out).toContain('hx-target="#result"');
  });

  it("sets hx-headers with X-CSRF-Token when csrfToken is provided", async () => {
    const out = await render(
      <Form csrfToken='abc123'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"');
  });

  it("merges csrf headers with existing hx-headers JSON", async () => {
    const out = await render(
      <Form csrfToken='abc123' hx-headers='{"X-Custom":"val"}'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain("&quot;X-Custom&quot;:&quot;val&quot;");
    expect(out).toContain("&quot;X-CSRF-Token&quot;:&quot;abc123&quot;");
  });

  it("preserves non-JSON hx-headers strings", async () => {
    const out = await render(
      <Form csrfToken='abc123' hx-headers='js:window.headers'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('hx-headers="js:window.headers"');
  });

  it("renders a hidden CSRF input when csrfToken is provided", async () => {
    const out = await render(
      <Form csrfToken='abc123'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('data-slot="form-csrf"');
    expect(out).toContain('type="hidden"');
    expect(out).toContain('name="_csrf"');
    expect(out).toContain('value="abc123"');
  });

  it("renders the honeypot field with the default name", async () => {
    const out = await render(
      <Form>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('data-slot="form-honeypot"');
    expect(out).toContain('name="surname"');
    expect(out).toContain("tabindex");
    expect(out).toContain('autocomplete="off"');
  });

  it("renders the honeypot with a custom field name", async () => {
    const out = await render(
      <Form honeypotField='website'>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('name="website"');
    expect(out).not.toContain('name="surname"');
  });

  it("renders children inside the form", async () => {
    const out = await render(
      <Form>
        <input name='message' id='msg' />
      </Form>,
    );
    expect(out).toContain('name="message"');
    expect(out).toContain('id="msg"');
  });

  it("passes through hx-disabled-elt and novalidate", async () => {
    const out = await render(
      <Form hx-disabled-elt="find [data-ref='submit']" novalidate={true}>
        <input name='x' />
      </Form>,
    );
    expect(out).toContain('hx-disabled-elt="find [data-ref=&#39;submit&#39;]"');
    expect(out).toContain("novalidate");
  });
});
