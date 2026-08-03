import { describe, expect, it } from "bun:test";
import { CSRF_FIELD_DEFAULT } from "../../form/constants";
import { render } from "../../jsx/render-test-helper";
import { Form } from "./form";
import { Honeypot } from "./honeypot";

describe("Form component", () => {
  it("renders a form element with method=post by default", async () => {
    expect(
      await render(
        <Form>
          <input name='x' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="post"><input name="x"></form>');
  });

  it("uses the native id prop", async () => {
    expect(
      await render(
        <Form id='contact-form'>
          <input name='x' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="post" id="contact-form"><input name="x"></form>');
  });

  it("passes through hx-post and hx-target", async () => {
    expect(
      await render(
        <Form hx-post='/api/contact' hx-target='#result'>
          <input name='x' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="post" hx-post="/api/contact" hx-target="#result"><input name="x"></form>');
  });

  it("sets hx-headers with X-CSRF-Token when csrfToken is provided", async () => {
    expect(
      await render(
        <Form csrfToken='abc123'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><input name="x"></form>',
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
      '<form data-slot="form" method="post" hx-headers="{&quot;X-Custom&quot;:&quot;val&quot;,&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><input name="x"></form>',
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
      '<form data-slot="form" method="post" hx-headers="js:window.headers"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><input name="x"></form>',
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
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><input name="x"></form>',
    );
  });

  it("renders children inside the form", async () => {
    expect(
      await render(
        <Form>
          <input name='message' id='msg' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="post"><input name="message" id="msg"></form>');
  });

  /**
   * The name is interpolated from `form/constants.ts` rather than written as a literal. Renaming the
   * constant is then a failing test instead of a silently mismatched field: the component and the
   * parser that validates the submission have to keep naming the same one.
   */
  it("names the CSRF input after the constant the form parser validates", async () => {
    expect(
      await render(
        <Form csrfToken='abc123'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      `<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="${CSRF_FIELD_DEFAULT}" value="abc123"><input name="x"></form>`,
    );
  });

  it("an explicit csrfField overrides the default", async () => {
    expect(
      await render(
        <Form csrfToken='abc123' csrfField='authenticity_token'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="authenticity_token" value="abc123"><input name="x"></form>',
    );
  });

  it("passes through hx-disabled-elt and novalidate", async () => {
    expect(
      await render(
        <Form hx-disabled-elt="find [data-ref='submit']" novalidate={true}>
          <input name='x' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="post" hx-disabled-elt="find [data-ref=&#39;submit&#39;]" novalidate><input name="x"></form>');
  });
});

/**
 * `method="get"` is half of the public `method?: "get" | "post"` union and had **no** coverage —
 * every assertion above and before it used the default. That gap is why an unconditional honeypot
 * survived: on GET the browser serialises every field into the query string, so `?__surname=` ended
 * up in the address bar, in bookmarks and shared links, in history, and in the outbound `Referer`.
 */
describe("Form — method=get", () => {
  it("emits method=get verbatim and injects no fields of its own", async () => {
    expect(
      await render(
        <Form method='get'>
          <input name='q' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="get"><input name="q"></form>');
  });

  it("renders nothing at all beyond the children when given none", async () => {
    // The strongest form of the assertion: no hidden input can reach the query string because the
    // component contributes no markup between the tags.
    expect(await render(<Form method='get' />)).toBe('<form data-slot="form" method="get"></form>');
  });

  it("passes htmx attributes through on GET just as it does on POST", async () => {
    expect(
      await render(
        <Form method='get' hx-get='/search' hx-target='#results'>
          <input name='q' />
        </Form>,
      ),
    ).toBe('<form data-slot="form" method="get" hx-get="/search" hx-target="#results"><input name="q"></form>');
  });
});

describe("Form — composed with Honeypot", () => {
  it("places the honeypot exactly where the caller puts it", async () => {
    expect(
      await render(
        <Form csrfToken='abc123'>
          <Honeypot />
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><div aria-hidden="true" data-slot="form-honeypot" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="__surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });
});
