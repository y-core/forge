import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Input } from "./input";

describe("Input", () => {
  it("renders an <input> element", async () => {
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("includes default styling classes", async () => {
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("passes through id and name", async () => {
    expect(await render(<Input id='email' name='email' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" id="email" name="email">',
    );
  });

  it("passes through the type attribute", async () => {
    expect(await render(<Input type='email' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" type="email">',
    );
  });

  it("passes through the placeholder attribute", async () => {
    expect(await render(<Input placeholder='Enter email' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" placeholder="Enter email">',
    );
  });

  it("passes through the required attribute", async () => {
    expect(await render(<Input required />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" required>',
    );
  });

  it("passes through the disabled attribute", async () => {
    expect(await render(<Input disabled />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" disabled>',
    );
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("passes through aria-describedby", async () => {
    expect(await render(<Input aria-describedby='help-text' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" aria-describedby="help-text">',
    );
  });

  it("passes through aria-invalid", async () => {
    expect(await render(<Input aria-invalid='true' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" aria-invalid="true">',
    );
  });

  it("merges a custom class with the default classes", async () => {
    expect(await render(<Input class='my-input' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm my-input">',
    );
  });
});

describe("Input — format", () => {
  it("stamps the scope and the template, and never a format attribute", async () => {
    expect(await render(<Input format='#### ####' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="#### ####" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("emits neither attribute for an empty template, which is the unformatted render", async () => {
    expect(await render(<Input format='' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("paints an unformatted value on the server, so the no-JS render already reads grouped", async () => {
    expect(await render(<Input format='#### #### #### ####' value='4111111111111111' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="#### #### #### ####" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" value="4111 1111 1111 1111">',
    );
  });

  it("repaints an already formatted value to itself rather than accumulating separators", async () => {
    expect(await render(<Input format='#### #### #### ####' value='4111 1111 1111 1111' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="#### #### #### ####" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" value="4111 1111 1111 1111">',
    );
  });

  it("paints a numeric value through the same template", async () => {
    expect(await render(<Input format='##/##' value={1226} />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="##/##" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" value="12/26">',
    );
  });

  it("emits no value at all when the caller passed none", async () => {
    expect(await render(<Input format='##/##' name='expiry' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="##/##" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" name="expiry">',
    );
  });

  it("escapes a template carrying HTML-significant characters", async () => {
    expect(await render(<Input format='<#&#>' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="&lt;#&amp;#&gt;" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("lets a caller's own data-scope win the spread, which is the forwarding contract", async () => {
    expect(await render(<Input format='##/##' data-scope='mine' />)).toBe(
      '<input data-slot="input" data-scope="mine" data-format="##/##" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("lets a caller's own data-format win the spread", async () => {
    expect(await render(<Input format='##/##' data-format='##-##' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="##-##" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });
});

describe("Input — size, invalid and busy", () => {
  it("stamps data-size=md and the md field size by default", async () => {
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("size='sm' stamps data-size=sm and the sm field size", async () => {
    expect(await render(<Input size='sm' />)).toBe(
      '<input data-slot="input" data-size="sm" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-sm text-sm">',
    );
  });

  it("size='lg' stamps data-size=lg and the lg field size", async () => {
    expect(await render(<Input size='lg' />)).toBe(
      '<input data-slot="input" data-size="lg" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-lg text-base">',
    );
  });

  it("invalid stamps data-invalid beside aria-invalid", async () => {
    expect(await render(<Input invalid />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" data-invalid="" aria-invalid="true">',
    );
  });

  it("busy stamps data-busy beside aria-busy", async () => {
    expect(await render(<Input busy />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" data-busy="" aria-busy="true">',
    );
  });

  it("the explicit invalid boolean wins over a descriptor that says otherwise", async () => {
    expect(await render(<Input field={{ name: "email" }} invalid />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" id="field-email" name="email" aria-invalid="true" data-invalid="">',
    );
  });

  // `state-invalid` sets `border-color` *and* `--tw-ring-color`, so before it had a group key of
  // its own it shared `ring-*`'s slot and a caller's ring silently deleted it — leaving a control
  // that announced `aria-invalid` while looking valid.
  it("keeps state-invalid when the caller supplies a ring of their own", async () => {
    expect(await render(<Input class='ring-primary' />)).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm ring-primary">',
    );
  });
});
