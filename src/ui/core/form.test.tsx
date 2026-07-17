import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Form } from "./form";

describe("Form component", () => {
  it("renders a form element with method=post by default", async () => {
    expect(
      await render(
        <Form>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("uses the native id prop", async () => {
    expect(
      await render(
        <Form id='contact-form'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" id="contact-form"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("passes through hx-post and hx-target", async () => {
    expect(
      await render(
        <Form hx-post='/api/contact' hx-target='#result'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-post="/api/contact" hx-target="#result"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("sets hx-headers with X-CSRF-Token when csrfToken is provided", async () => {
    expect(
      await render(
        <Form csrfToken='abc123'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("merges csrf headers with existing hx-headers JSON", async () => {
    expect(
      await render(
        <Form csrfToken='abc123' hx-headers='{"X-Custom":"val"}'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-Custom&quot;:&quot;val&quot;,&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("preserves non-JSON hx-headers strings", async () => {
    expect(
      await render(
        <Form csrfToken='abc123' hx-headers='js:window.headers'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="js:window.headers"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("renders a hidden CSRF input when csrfToken is provided", async () => {
    expect(
      await render(
        <Form csrfToken='abc123'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("renders the honeypot field with the default name", async () => {
    expect(
      await render(
        <Form>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("renders the honeypot with a custom field name", async () => {
    expect(
      await render(
        <Form honeypotField='website'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="website" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });

  it("renders children inside the form", async () => {
    expect(
      await render(
        <Form>
          <input name='message' id='msg' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="message" id="msg"></form>',
    );
  });

  it("passes through hx-disabled-elt and novalidate", async () => {
    expect(
      await render(
        <Form hx-disabled-elt="find [data-ref='submit']" novalidate={true}>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-disabled-elt="find [data-ref=&#39;submit&#39;]" novalidate><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });
});
