import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Label } from "./label";

describe("Label", () => {
  it("renders a <label> with data-slot=label", async () => {
    expect(await render(<Label>Name</Label>)).toBe(
      '<label data-slot="label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Name</label>',
    );
  });

  it("applies shared label classes", async () => {
    expect(await render(<Label>Field</Label>)).toBe(
      '<label data-slot="label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Field</label>',
    );
  });

  it("renders required marker when required=true", async () => {
    expect(await render(<Label required>Email</Label>)).toBe(
      '<label data-slot="label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Email<span data-slot="label-required" aria-hidden="true" class="ml-0.5 text-red-500">*</span></label>',
    );
  });

  it("does not render required marker by default", async () => {
    expect(await render(<Label>Optional</Label>)).toBe(
      '<label data-slot="label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Optional</label>',
    );
  });

  it("passes the for attribute through", async () => {
    expect(await render(<Label for='email-field'>Email</Label>)).toBe(
      '<label data-slot="label" for="email-field" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Email</label>',
    );
  });

  it("merges a custom class", async () => {
    expect(await render(<Label class='my-label'>Text</Label>)).toBe(
      '<label data-slot="label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50 my-label">Text</label>',
    );
  });
});
