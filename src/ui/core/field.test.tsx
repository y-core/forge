import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { Field, fieldDescriptionId, fieldErrorId, fieldId } from "./field";
import { Input } from "./input";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

describe("fieldId helpers", () => {
  it("fieldId returns field-{name}", () => {
    expect(fieldId("email")).toBe("field-email");
  });

  it("fieldDescriptionId returns field-{name}-description", () => {
    expect(fieldDescriptionId("email")).toBe("field-email-description");
  });

  it("fieldErrorId returns field-{name}-error", () => {
    expect(fieldErrorId("email")).toBe("field-email-error");
  });
});

describe("Field component", () => {
  it("renders a label with for pointing to field-{name}", async () => {
    const html = await render(<Field name="email" label="Email address"><Input name="email" id="field-email" /></Field>);
    expect(html).toContain('for="field-email"');
    expect(html).toContain("Email address");
  });

  it("renders the required asterisk when required prop is set", async () => {
    const out = await render(
      <Field name="name" label="Name" required>
        <Input name="name" id="field-name" />
      </Field>,
    );
    expect(out).toContain("*");
    expect(out).toContain('aria-hidden="true"');
  });

  it("does not render asterisk without required prop", async () => {
    const out = await render(
      <Field name="name" label="Name">
        <Input name="name" id="field-name" />
      </Field>,
    );
    expect(out).not.toContain('<span class="ml-1 text-red-500"');
  });

  it("renders description with the correct id", async () => {
    const out = await render(
      <Field name="phone" label="Phone" description="Optional field">
        <Input name="phone" id="field-phone" />
      </Field>,
    );
    expect(out).toContain('id="field-phone-description"');
    expect(out).toContain("Optional field");
  });

  it("does not render description element when description is absent", async () => {
    const out = await render(
      <Field name="phone" label="Phone">
        <Input name="phone" id="field-phone" />
      </Field>,
    );
    expect(out).not.toContain("field-phone-description");
  });

  it("renders error with the correct id and role=alert", async () => {
    const out = await render(
      <Field name="email" label="Email" error="Email is required.">
        <Input name="email" id="field-email" />
      </Field>,
    );
    expect(out).toContain('id="field-email-error"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("Email is required.");
  });

  it("does not render error element when error is absent", async () => {
    const out = await render(
      <Field name="email" label="Email">
        <Input name="email" id="field-email" />
      </Field>,
    );
    expect(out).not.toContain("field-email-error");
  });

  it("renders child elements inside the wrapper", async () => {
    const out = await render(
      <Field name="msg" label="Message">
        <textarea id="field-msg" name="msg" />
      </Field>,
    );
    expect(out).toContain("<textarea");
    expect(out).toContain('name="msg"');
  });
});
