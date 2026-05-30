import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  fieldDescriptionId,
  fieldErrorId,
  fieldId,
} from "./field";
import {
  FieldContent,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "./field-layout";
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

describe("Field primitives", () => {
  it("wires FieldLabel to the control id automatically", async () => {
    const out = await render(
      <Field name="email">
        <FieldLabel>Email address</FieldLabel>
        <FieldContent>
          <Input />
        </FieldContent>
      </Field>,
    );
    expect(out).toContain('for="field-email"');
    expect(out).toContain('id="field-email"');
    expect(out).toContain('data-slot="field-content"');
  });

  it("adds data-invalid to the field and aria-invalid to the control", async () => {
    const out = await render(
      <Field name="email" invalid>
        <FieldLabel>Email</FieldLabel>
        <FieldContent>
          <Input />
          <FieldError>Email is required.</FieldError>
        </FieldContent>
      </Field>,
    );
    expect(out).toContain('data-invalid="true"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="field-email-error"');
  });

  it("wires description and error ids into aria-describedby", async () => {
    const out = await render(
      <Field name="message" invalid>
        <FieldLabel>Message</FieldLabel>
        <FieldContent>
          <Input />
          <FieldDescription>Minimum 15 characters</FieldDescription>
          <FieldError>Required</FieldError>
        </FieldContent>
      </Field>,
    );
    expect(out).toContain('aria-describedby="field-message-description field-message-error"');
  });

  it("inherits disabled state on the control", async () => {
    const out = await render(
      <Field name="name" disabled>
        <FieldLabel>Name</FieldLabel>
        <FieldContent>
          <Input />
        </FieldContent>
      </Field>,
    );
    expect(out).toContain('data-disabled="true"');
    expect(out).toMatch(/\bdisabled(?!:)/);
  });

  it("preserves explicit control props over field defaults", async () => {
    const out = await render(
      <Field name="name" invalid>
        <FieldLabel>Name</FieldLabel>
        <FieldContent>
          <Input id="custom-id" aria-describedby="custom-help" aria-invalid="false" />
        </FieldContent>
      </Field>,
    );
    expect(out).toContain('id="custom-id"');
    expect(out).toContain('aria-invalid="false"');
    expect(out).toContain('aria-describedby="custom-help field-name-description field-name-error"');
  });

  it("renders FieldGroup with stack classes", async () => {
    const out = await render(
      <FieldGroup>
        <Field name="name">
          <FieldLabel>Name</FieldLabel>
          <FieldContent>
            <Input />
          </FieldContent>
        </Field>
      </FieldGroup>,
    );
    expect(out).toContain('data-slot="field-group"');
    expect(out).toContain("@container/field-group");
  });

  it("renders FieldSet and FieldLegend with explicit slots", async () => {
    const out = await render(
      <FieldSet>
        <FieldLegend>Contact details</FieldLegend>
      </FieldSet>,
    );
    expect(out).toContain('data-slot="field-set"');
    expect(out).toContain('data-slot="field-legend"');
  });

  it("renders FieldTitle and FieldSeparator with explicit slots", async () => {
    const out = await render(
      <FieldGroup>
        <Field name="name">
          <FieldTitle>Name</FieldTitle>
          <FieldContent>
            <Input />
          </FieldContent>
        </Field>
        <FieldSeparator>or</FieldSeparator>
      </FieldGroup>,
    );
    expect(out).toContain('data-slot="field-title"');
    expect(out).toContain('data-slot="field-separator"');
    expect(out).toContain('data-slot="field-separator-content"');
  });
});
