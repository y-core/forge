import { describe, expect, it } from "bun:test";
import { CSRF_FIELD_DEFAULT } from "../../form/constants";
import { render } from "../../testing/render";
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

/**
 * `class` is composed through `cn` rather than riding to the element inside the rest spread.
 *
 * **Only half of that contract is observable here.** `Form` declares no base classes, so a caller's
 * class has nothing to conflict with and nothing for `cn` to resolve — the precedence half that
 * `src/ui/README.md` advertises ("a caller's `class` overrides a component's base rather than racing
 * it in the stylesheet") cannot be asserted through `Form`'s public surface as committed. It becomes
 * observable, and must be covered here, the moment `Form` gains a base class.
 *
 * What is observable is that the prop passes through `cn` **at all** — `cn` resolves a conflict
 * inside a single argument, and emits nothing for an absent one. The conflict case is the one
 * carrying that weight: a case that merely passes a `class` and asserts it appeared passes with
 * `cn` deleted too, which is exactly how the bypass stayed invisible (TESTING.md §3d). Nothing else
 * in the render path collapses `p-4 p-8` to `p-8`.
 */
describe("Form — class composition", () => {
  it("emits no class attribute at all when no class is passed", async () => {
    // `cn()` resolves to `""` with no base classes to fall back on; the attribute is dropped rather
    // than emitted as `class=""`, keeping the output byte-identical to before the prop was composed.
    expect(await render(<Form />)).toBe('<form data-slot="form" method="post"></form>');
  });

  it("emits a caller's class verbatim when it holds no conflict", async () => {
    expect(await render(<Form class='p-8' />)).toBe('<form data-slot="form" method="post" class="p-8"></form>');
  });

  it("resolves a conflict within the caller's own class, proving the prop passes through cn", async () => {
    expect(await render(<Form class='p-4 p-8' />)).toBe('<form data-slot="form" method="post" class="p-8"></form>');
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
      '<form data-slot="form" method="post" hx-headers="{&quot;X-CSRF-Token&quot;:&quot;abc123&quot;}"><input data-slot="form-csrf" type="hidden" name="_csrf" value="abc123"><div aria-hidden="true" class="absolute -left-[9999px] opacity-0 pointer-events-none"><input type="text" name="__surname" tabindex="-1" autocomplete="off"></div><input name="x"></form>',
    );
  });
});
