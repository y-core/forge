import { describe, expect, it } from "bun:test";

import { CSRF_FIELD_DEFAULT } from "../../form/constants";
import { attrOf, attrsOf, classesOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { Form } from "./form";

const CSRF_FIELD = 'data-slot="form-csrf"';

const bodyOf = (html: string): string => /<form[^>]*>(.*)<\/form>/s.exec(html)?.[1] ?? "";

describe("Form component", () => {
  it("renders the whole protected form exactly, the header JSON and the hidden field both escaped", async () => {
    expect(
      await render(
        <Form csrfToken='abc123'>
          <input name='x' />
        </Form>,
      ),
    ).toBe(
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}">' +
        '<input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><input name="x"></form>',
    );
  });

  it("defaults to post, which is the method its CSRF protection assumes", async () => {
    expect(attrsOf(await render(<Form />))).toEqual({ "data-slot": "form", method: "post" });
  });

  it("renders the children it was given and nothing around them", async () => {
    expect(
      bodyOf(
        await render(
          <Form>
            <input name='message' id='msg' />
          </Form>,
        ),
      ),
    ).toBe('<input name="message" id="msg">');
  });

  it("forwards an id and the htmx attributes a caller drives the submit with", async () => {
    expect(attrsOf(await render(<Form id='contact-form' hx-post='/api/contact' hx-target='#result' />))).toEqual({
      "data-slot": "form",
      method: "post",
      id: "contact-form",
      "hx-post": "/api/contact",
      "hx-target": "#result",
    });
  });

  it("merges the CSRF header into an hx-headers object the caller already wrote", async () => {
    expect(attrOf(await render(<Form csrfToken='abc123' hx-headers='{"X-Custom":"val"}' />), "hx-headers")).toBe(
      "{&quot;X-Custom&quot;:&quot;val&quot;,&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}",
    );
  });

  it("keeps a non-string header entry, which htmx serialises just as it does a string", async () => {
    expect(attrOf(await render(<Form csrfToken='abc123' hx-headers='{"X-Retry":3,"X-Live":true}' />), "hx-headers")).toBe(
      "{&quot;X-Retry&quot;:3,&quot;X-Live&quot;:true,&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}",
    );
  });

  // Passing the string through was the old behaviour, and it shipped a form whose token htmx never
  // sends: the request 403s with nothing in the markup or the console naming the cause.
  it("throws rather than dropping the CSRF token into an hx-headers value it cannot merge into", () => {
    expect(() => Form({ csrfToken: "abc123", "hx-headers": "js:window.headers", children: null })).toThrow(/cannot merge its csrfToken/);
  });

  it("still passes a non-JSON hx-headers string through, injecting no field, when there is no token to lose", async () => {
    const html = await render(
      <Form hx-headers='js:window.headers'>
        <input name='x' />
      </Form>,
    );

    expect(attrOf(html, "hx-headers")).toBe("js:window.headers");
    expect(bodyOf(html)).toBe('<input name="x">');
  });

  // An `hx-delete` request carries no body, so a header name the app renamed is the only token
  // `csrfProtection` can read — a mismatch 403s with nothing on the page to explain it.
  it("writes the app's own header name into hx-headers when it renamed one, on its own or merged", async () => {
    expect(attrOf(await render(<Form csrfToken='abc123' csrfHeader='X-App-Csrf' />), "hx-headers")).toBe(
      "{&quot;X-App-Csrf&quot;:&quot;abc123&quot;}",
    );
    expect(attrOf(await render(<Form csrfToken='abc123' csrfHeader='X-App-Csrf' hx-headers='{"X-Custom":"val"}' />), "hx-headers")).toBe(
      "{&quot;X-Custom&quot;:&quot;val&quot;,&quot;X-App-Csrf&quot;:&quot;abc123&quot;}",
    );
  });

  it("names the app's own header in the unmergeable-value error, since that is the one to add", () => {
    expect(() => Form({ csrfToken: "abc123", csrfHeader: "X-App-Csrf", "hx-headers": "js:window.headers", children: null })).toThrow(
      'Add "X-App-Csrf" to that value yourself',
    );
  });

  it("names the CSRF input after the constant the form parser validates", async () => {
    expect(attrsOf(await render(<Form csrfToken='abc123' />), CSRF_FIELD)).toEqual({
      "data-slot": "form-csrf",
      type: "hidden",
      name: CSRF_FIELD_DEFAULT,
      value: "abc123",
    });
  });

  it("an explicit csrfField overrides the default", async () => {
    expect(attrOf(await render(<Form csrfToken='abc123' csrfField='authenticity_token' />), "name", CSRF_FIELD)).toBe("authenticity_token");
  });

  it("passes through hx-disabled-elt and novalidate, the selector's quotes escaped", async () => {
    expect(attrsOf(await render(<Form hx-disabled-elt="find [data-ref='submit']" novalidate={true} />))).toEqual({
      "data-slot": "form",
      method: "post",
      "hx-disabled-elt": "find [data-ref=&#39;submit&#39;]",
      novalidate: "",
    });
  });
});

describe("Form — method=get", () => {
  it("emits method=get verbatim and injects no fields of its own", async () => {
    const html = await render(
      <Form method='get'>
        <input name='q' />
      </Form>,
    );

    expect(attrsOf(html)).toEqual({ "data-slot": "form", method: "get" });
    expect(bodyOf(html)).toBe('<input name="q">');
  });

  it("renders nothing at all inside when given no children", async () => {
    expect(bodyOf(await render(<Form method='get' />))).toBe("");
  });

  it("passes htmx attributes through on GET just as it does on POST", async () => {
    expect(attrsOf(await render(<Form method='get' hx-get='/search' hx-target='#results' />))).toEqual({
      "data-slot": "form",
      method: "get",
      "hx-get": "/search",
      "hx-target": "#results",
    });
  });
});

describe("Form — class composition", () => {
  it("emits no class attribute at all when no class is passed", async () => {
    expect(await render(<Form />)).not.toContain("class=");
  });

  it("emits a caller's class verbatim when it holds no conflict", async () => {
    expect(classesOf(await render(<Form class='p-8' />))).toEqual(["p-8"]);
  });

  it("resolves a conflict within the caller's own class, proving the prop passes through cn", async () => {
    expect(classesOf(await render(<Form class='p-4 p-8' />))).toEqual(["p-8"]);
  });
});
