import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Input } from "./input";

describe("Input", () => {
  it("renders an <input> element", async () => {
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50">',
    );
  });

  it("includes default styling classes", async () => {
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50">',
    );
  });

  it("passes through id and name", async () => {
    expect(await render(<Input id='email' name='email' />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" id="email" name="email">',
    );
  });

  it("passes through the type attribute", async () => {
    expect(await render(<Input type='email' />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" type="email">',
    );
  });

  it("passes through the placeholder attribute", async () => {
    expect(await render(<Input placeholder='Enter email' />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" placeholder="Enter email">',
    );
  });

  it("passes through the required attribute", async () => {
    expect(await render(<Input required />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" required>',
    );
  });

  it("passes through the disabled attribute", async () => {
    expect(await render(<Input disabled />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" disabled>',
    );
    expect(await render(<Input />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50">',
    );
  });

  it("passes through aria-describedby", async () => {
    expect(await render(<Input aria-describedby='help-text' />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" aria-describedby="help-text">',
    );
  });

  it("passes through aria-invalid", async () => {
    expect(await render(<Input aria-invalid='true' />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50" aria-invalid="true">',
    );
  });

  it("merges a custom class with the default classes", async () => {
    expect(await render(<Input class='my-input' />)).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 my-input">',
    );
  });
});

const CLASSES =
  'class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"';

describe("Input — format", () => {
  it("stamps the scope and the template, and never a format attribute", async () => {
    expect(await render(<Input format='#### ####' />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="#### ####" ${CLASSES}>`,
    );
  });

  it("emits neither attribute for an empty template, which is the unformatted render", async () => {
    expect(await render(<Input format='' />)).toBe(`<input data-slot="input" ${CLASSES}>`);
  });

  it("paints an unformatted value on the server, so the no-JS render already reads grouped", async () => {
    expect(await render(<Input format='#### #### #### ####' value='4111111111111111' />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="#### #### #### ####" ${CLASSES} value="4111 1111 1111 1111">`,
    );
  });

  it("repaints an already formatted value to itself rather than accumulating separators", async () => {
    expect(await render(<Input format='#### #### #### ####' value='4111 1111 1111 1111' />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="#### #### #### ####" ${CLASSES} value="4111 1111 1111 1111">`,
    );
  });

  it("paints a numeric value through the same template", async () => {
    expect(await render(<Input format='##/##' value={1226} />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="##/##" ${CLASSES} value="12/26">`,
    );
  });

  it("emits no value at all when the caller passed none", async () => {
    expect(await render(<Input format='##/##' name='expiry' />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="##/##" ${CLASSES} name="expiry">`,
    );
  });

  it("escapes a template carrying HTML-significant characters", async () => {
    expect(await render(<Input format='<#&#>' />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="&lt;#&amp;#&gt;" ${CLASSES}>`,
    );
  });

  it("lets a caller's own data-scope win the spread, which is the forwarding contract", async () => {
    expect(await render(<Input format='##/##' data-scope='mine' />)).toBe(
      `<input data-slot="input" data-scope="mine" data-format="##/##" ${CLASSES}>`,
    );
  });

  it("lets a caller's own data-format win the spread", async () => {
    expect(await render(<Input format='##/##' data-format='##-##' />)).toBe(
      `<input data-slot="input" data-scope="input-format" data-format="##-##" ${CLASSES}>`,
    );
  });
});
