import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { fieldDescriptionId, fieldErrorId, fieldId } from "./field";
import { FormField } from "./field-layout";
import { Field } from "./field-stack";
import { Input } from "./input";

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
      <FormField name='email'>
        <FormField.Label name='email'>Email address</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email" }} />
        </FormField.Content>
      </FormField>,
    );
    expect(out).toContain('for="field-email"');
    expect(out).toContain('id="field-email"');
    expect(out).toContain('data-slot="field-content"');
  });

  it("adds data-invalid to the field and aria-invalid to the control", async () => {
    const out = await render(
      <FormField name='email' invalid>
        <FormField.Label name='email'>Email</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "email", invalid: true }} />
          <FormField.Error name='email'>Email is required.</FormField.Error>
        </FormField.Content>
      </FormField>,
    );
    expect(out).toContain('data-invalid="true"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="field-email-error"');
  });

  it("wires description and error ids into aria-describedby", async () => {
    const out = await render(
      <FormField name='message' invalid>
        <FormField.Label name='message'>Message</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "message", invalid: true }} />
          <FormField.Description name='message'>Minimum 15 characters</FormField.Description>
          <FormField.Error name='message'>Required</FormField.Error>
        </FormField.Content>
      </FormField>,
    );
    expect(out).toContain('aria-describedby="field-message-description field-message-error"');
  });

  it("inherits disabled state on the control", async () => {
    const out = await render(
      <FormField name='name' disabled>
        <FormField.Label name='name'>Name</FormField.Label>
        <FormField.Content>
          <Input field={{ name: "name", disabled: true }} />
        </FormField.Content>
      </FormField>,
    );
    expect(out).toContain('data-disabled="true"');
    expect(out).toMatch(/\bdisabled(?!:)/);
  });

  it("preserves explicit control props over field defaults", async () => {
    const out = await render(
      <FormField name='name' invalid>
        <FormField.Label name='name'>Name</FormField.Label>
        <FormField.Content>
          <Input id='custom-id' aria-describedby='custom-help' aria-invalid='false' field={{ name: "name", invalid: true }} />
        </FormField.Content>
      </FormField>,
    );
    expect(out).toContain('id="custom-id"');
    expect(out).toContain('aria-invalid="false"');
    expect(out).toContain('aria-describedby="custom-help field-name-description field-name-error"');
  });

  it("renders Field.Group with stack classes", async () => {
    const out = await render(
      <FormField.Group>
        <FormField name='name'>
          <FormField.Label name='name'>Name</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "name" }} />
          </FormField.Content>
        </FormField>
      </FormField.Group>,
    );
    expect(out).toContain('data-slot="field-group"');
    expect(out).toContain("@container/field-group");
  });

  it("renders Field.Set and Field.Legend with explicit slots", async () => {
    const out = await render(
      <FormField.Set>
        <FormField.Legend>Contact details</FormField.Legend>
      </FormField.Set>,
    );
    expect(out).toContain('data-slot="field-set"');
    expect(out).toContain('data-slot="field-legend"');
  });

  it("renders Field.Title and Field.Separator with explicit slots", async () => {
    const out = await render(
      <FormField.Group>
        <FormField name='name'>
          <FormField.Title>Name</FormField.Title>
          <FormField.Content>
            <Input field={{ name: "name" }} />
          </FormField.Content>
        </FormField>
        <FormField.Separator>or</FormField.Separator>
      </FormField.Group>,
    );
    expect(out).toContain('data-slot="field-title"');
    expect(out).toContain('data-slot="field-separator"');
    expect(out).toContain('data-slot="field-separator-content"');
  });
});

describe("Field — arbitrary attribute pass-through", () => {
  it("forwards data-* attributes to the root with escaped values", async () => {
    const out = await render(
      <Field label='Email' data-test-hook='email-field' data-note='a&b'>
        <Input field={{ name: "email" }} />
      </Field>,
    );
    expect(out).toContain('data-test-hook="email-field"');
    expect(out).toContain('data-note="a&amp;b"');
  });
});
