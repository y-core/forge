import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import {
  fieldDescriptionId,
  fieldErrorId,
  fieldId,
} from "./field";
import { Field } from "./field-layout";
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
  it("wires Field.Label to the control id via explicit name prop", async () => {
    const out = await render(
      <Field name="email">
        <Field.Label name="email">Email address</Field.Label>
        <Field.Content>
          <Input field={{ name: "email" }} />
        </Field.Content>
      </Field>,
    );
    expect(out).toContain('for="field-email"');
    expect(out).toContain('id="field-email"');
    expect(out).toContain('data-slot="field-content"');
  });

  it("adds data-invalid to the field and aria-invalid to the control", async () => {
    const out = await render(
      <Field name="email" invalid>
        <Field.Label name="email">Email</Field.Label>
        <Field.Content>
          <Input field={{ name: "email", invalid: true }} />
          <Field.Error name="email">Email is required.</Field.Error>
        </Field.Content>
      </Field>,
    );
    expect(out).toContain('data-invalid="true"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="field-email-error"');
  });

  it("wires description and error ids into aria-describedby", async () => {
    const out = await render(
      <Field name="message" invalid>
        <Field.Label name="message">Message</Field.Label>
        <Field.Content>
          <Input field={{ name: "message", invalid: true }} />
          <Field.Description name="message">Minimum 15 characters</Field.Description>
          <Field.Error name="message">Required</Field.Error>
        </Field.Content>
      </Field>,
    );
    expect(out).toContain('aria-describedby="field-message-description field-message-error"');
  });

  it("inherits disabled state on the control", async () => {
    const out = await render(
      <Field name="name" disabled>
        <Field.Label name="name">Name</Field.Label>
        <Field.Content>
          <Input field={{ name: "name", disabled: true }} />
        </Field.Content>
      </Field>,
    );
    expect(out).toContain('data-disabled="true"');
    expect(out).toMatch(/\bdisabled(?!:)/);
  });

  it("preserves explicit control props over field defaults", async () => {
    const out = await render(
      <Field name="name" invalid>
        <Field.Label name="name">Name</Field.Label>
        <Field.Content>
          <Input
            id="custom-id"
            aria-describedby="custom-help"
            aria-invalid="false"
            field={{ name: "name", invalid: true }}
          />
        </Field.Content>
      </Field>,
    );
    expect(out).toContain('id="custom-id"');
    expect(out).toContain('aria-invalid="false"');
    expect(out).toContain('aria-describedby="custom-help field-name-description field-name-error"');
  });

  it("renders Field.Group with stack classes", async () => {
    const out = await render(
      <Field.Group>
        <Field name="name">
          <Field.Label name="name">Name</Field.Label>
          <Field.Content>
            <Input field={{ name: "name" }} />
          </Field.Content>
        </Field>
      </Field.Group>,
    );
    expect(out).toContain('data-slot="field-group"');
    expect(out).toContain("@container/field-group");
  });

  it("renders Field.Set and Field.Legend with explicit slots", async () => {
    const out = await render(
      <Field.Set>
        <Field.Legend>Contact details</Field.Legend>
      </Field.Set>,
    );
    expect(out).toContain('data-slot="field-set"');
    expect(out).toContain('data-slot="field-legend"');
  });

  it("renders Field.Title and Field.Separator with explicit slots", async () => {
    const out = await render(
      <Field.Group>
        <Field name="name">
          <Field.Title>Name</Field.Title>
          <Field.Content>
            <Input field={{ name: "name" }} />
          </Field.Content>
        </Field>
        <Field.Separator>or</Field.Separator>
      </Field.Group>,
    );
    expect(out).toContain('data-slot="field-title"');
    expect(out).toContain('data-slot="field-separator"');
    expect(out).toContain('data-slot="field-separator-content"');
  });
});
