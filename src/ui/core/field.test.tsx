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
    expect(
      await render(
        <FormField name='email'>
          <FormField.Label name='email'>Email address</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "email" }} />
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-email">Email address</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email" aria-describedby="field-email-description"></div></fieldset>',
    );
  });

  it("adds data-invalid to the field and aria-invalid to the control", async () => {
    expect(
      await render(
        <FormField name='email' invalid>
          <FormField.Label name='email'>Email</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "email", invalid: true }} />
            <FormField.Error name='email'>Email is required.</FormField.Error>
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-invalid="true" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-email">Email</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email" aria-describedby="field-email-description field-email-error" aria-invalid="true"><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-email-error" role="alert">Email is required.</p></div></fieldset>',
    );
  });

  it("wires description and error ids into aria-describedby", async () => {
    expect(
      await render(
        <FormField name='message' invalid>
          <FormField.Label name='message'>Message</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "message", invalid: true }} />
            <FormField.Description name='message'>Minimum 15 characters</FormField.Description>
            <FormField.Error name='message'>Required</FormField.Error>
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-invalid="true" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-message">Message</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-message" name="message" aria-describedby="field-message-description field-message-error" aria-invalid="true"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-message-description">Minimum 15 characters</p><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-message-error" role="alert">Required</p></div></fieldset>',
    );
  });

  it("inherits disabled state on the control", async () => {
    expect(
      await render(
        <FormField name='name' disabled>
          <FormField.Label name='name'>Name</FormField.Label>
          <FormField.Content>
            <Input field={{ name: "name", disabled: true }} />
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset disabled data-slot="field" data-disabled="true" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-name">Name</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-name" name="name" disabled aria-describedby="field-name-description"></div></fieldset>',
    );
  });

  it("preserves explicit control props over field defaults", async () => {
    expect(
      await render(
        <FormField name='name' invalid>
          <FormField.Label name='name'>Name</FormField.Label>
          <FormField.Content>
            <Input id='custom-id' aria-describedby='custom-help' aria-invalid='false' field={{ name: "name", invalid: true }} />
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-invalid="true" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-name">Name</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="custom-id" aria-describedby="custom-help field-name-description field-name-error" aria-invalid="false" name="name"></div></fieldset>',
    );
  });

  it("renders Field.Group with stack classes", async () => {
    expect(
      await render(
        <FormField.Group>
          <FormField name='name'>
            <FormField.Label name='name'>Name</FormField.Label>
            <FormField.Content>
              <Input field={{ name: "name" }} />
            </FormField.Content>
          </FormField>
        </FormField.Group>,
      ),
    ).toBe(
      '<div data-slot="field-group" class="@container/field-group flex w-full flex-col gap-6"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-name">Name</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-name" name="name" aria-describedby="field-name-description"></div></fieldset></div>',
    );
  });

  it("renders Field.Set and Field.Legend with explicit slots", async () => {
    expect(
      await render(
        <FormField.Set>
          <FormField.Legend>Contact details</FormField.Legend>
        </FormField.Set>,
      ),
    ).toBe(
      '<fieldset data-slot="field-set" class="flex flex-col gap-6"><legend data-slot="field-legend" data-variant="legend" class="mb-3 font-medium text-base text-foreground">Contact details</legend></fieldset>',
    );
  });

  it("renders Field.Title and Field.Separator with explicit slots", async () => {
    expect(
      await render(
        <FormField.Group>
          <FormField name='name'>
            <FormField.Title>Name</FormField.Title>
            <FormField.Content>
              <Input field={{ name: "name" }} />
            </FormField.Content>
          </FormField>
          <FormField.Separator>or</FormField.Separator>
        </FormField.Group>,
      ),
    ).toBe(
      '<div data-slot="field-group" class="@container/field-group flex w-full flex-col gap-6"><fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><div data-slot="field-title" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Name</div><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-name" name="name" aria-describedby="field-name-description"></div></fieldset><div data-content="true" data-slot="field-separator" class="relative h-5 text-sm"><hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border absolute inset-0 top-1/2"><span data-slot="field-separator-content" class="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">or</span></div></div>',
    );
  });
});

describe("Field — arbitrary attribute pass-through", () => {
  it("forwards data-* attributes to the root with escaped values", async () => {
    expect(
      await render(
        <Field label='Email' data-test-hook='email-field' data-note='a&b'>
          <Input field={{ name: "email" }} />
        </Field>,
      ),
    ).toBe(
      '<div data-slot="field" data-orientation="vertical" class="flex flex-col gap-1" data-test-hook="email-field" data-note="a&amp;b"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">Email</span><input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" id="field-email" name="email" aria-describedby="field-email-description"></div>',
    );
  });
});
