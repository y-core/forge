import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
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
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none"><option data-slot="select-option" value="a">Option A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
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
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none"><option data-slot="select-option" value="a">Option A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
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
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none"><option data-slot="select-option" value="a">Option A</option><option data-slot="select-option" value="b">Option B</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
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
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" id="my-select" name="choice" required value="b"><option data-slot="select-option" value="a">A</option><option data-slot="select-option" value="b" selected>B</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
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
      '<fieldset data-slot="field" data-orientation="vertical" class="group/field flex w-full gap-3 data-[invalid=true]:text-red-600 flex-col [&amp;&gt;*]:w-full"><label data-slot="field-label" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50" for="field-choice">Choice</label><div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" id="field-choice" name="choice" aria-describedby="field-choice-description"><option data-slot="select-option" value="a">A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div></div></fieldset>',
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
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none extra"><option data-slot="select-option" value="a">A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
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
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none"><optgroup data-slot="select-optgroup" label="Group A"><option data-slot="select-option" value="a">A</option></optgroup></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });
});
