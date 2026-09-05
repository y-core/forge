import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { FormField } from "./field-layout";
import { createIcon } from "./icon";
import { Select } from "./select";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

describe("Select", () => {
  it("renders a <select> element", async () => {
    expect(
      await render(
        <Select icon={icon}>
          <Select.Option value='a'>Option A</Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"><option data-slot="select-option" value="a">Option A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("renders the chevron via a sprite <use> reference", async () => {
    expect(
      await render(
        <Select icon={icon}>
          <Select.Option value='a'>Option A</Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"><option data-slot="select-option" value="a">Option A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("renders child options", async () => {
    expect(
      await render(
        <Select icon={icon}>
          <Select.Option value='a'>Option A</Select.Option>
          <Select.Option value='b'>Option B</Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"><option data-slot="select-option" value="a">Option A</option><option data-slot="select-option" value="b">Option B</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("passes through native attributes", async () => {
    expect(
      await render(
        <Select icon={icon} id='my-select' name='choice' required value='b'>
          <Select.Option value='a'>A</Select.Option>
          <Select.Option value='b' selected>
            B
          </Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" id="my-select" name="choice" required value="b"><option data-slot="select-option" value="a">A</option><option data-slot="select-option" value="b" selected>B</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("wires id and for via explicit field and name props", async () => {
    expect(
      await render(
        <FormField name='choice'>
          <FormField.Label name='choice'>Choice</FormField.Label>
          <FormField.Content>
            <Select icon={icon} field={{ name: "choice" }}>
              <Select.Option value='a'>A</Select.Option>
            </Select>
          </FormField.Content>
        </FormField>,
      ),
    ).toBe(
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid]:text-destructive-text flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm leading-snug font-medium text-foreground group-data-[disabled]/field:opacity-50" for="field-choice">Choice</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" id="field-choice" name="choice"><option data-slot="select-option" value="a">A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></div></fieldset>',
    );
  });

  it("merges a custom class with the default classes", async () => {
    expect(
      await render(
        <Select icon={icon} class='extra'>
          <Select.Option value='a'>A</Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50 extra"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"><option data-slot="select-option" value="a">A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("renders optgroups with explicit slots", async () => {
    expect(
      await render(
        <Select icon={icon}>
          <Select.OptGroup label='Group A'>
            <Select.Option value='a'>A</Select.Option>
          </Select.OptGroup>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"><optgroup data-slot="select-optgroup" label="Group A"><option data-slot="select-option" value="a">A</option></optgroup></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });
});

describe("Select — size, invalid and busy", () => {
  it("stamps data-size=md and the md field size by default", async () => {
    expect(await render(<Select icon={icon} />)).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("size='sm' stamps data-size=sm and the sm field size", async () => {
    expect(await render(<Select icon={icon} size='sm' />)).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="sm" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-sm text-sm"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("size='lg' stamps data-size=lg and the lg field size", async () => {
    expect(await render(<Select icon={icon} size='lg' />)).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="lg" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-lg text-base"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("invalid stamps data-invalid beside aria-invalid", async () => {
    expect(await render(<Select icon={icon} invalid />)).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" data-invalid="" aria-invalid="true"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("busy stamps data-busy beside aria-busy", async () => {
    expect(await render(<Select icon={icon} busy />)).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm" data-busy="" aria-busy="true"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  // `state-invalid` sets `border-color` *and* `--tw-ring-color`, so before it had a group key of
  // its own it shared `ring-*`'s slot. Select puts the caller's class on the wrapper, so the ring
  // never meets `state-invalid` here — the case is kept because the group's key is what makes that
  // true of the select element too, wherever a ring reaches it.
  it("keeps state-invalid on the select when the caller supplies a ring of their own", async () => {
    expect(
      await render(
        <Select icon={icon} class='ring-primary'>
          <Select.Option value='a'>Option A</Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50 ring-primary"><select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring h-control-md text-sm"><option data-slot="select-option" value="a">Option A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });
});
