/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { createIcon } from "../core/icon";
import { Select } from "./select";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

describe("controls/Select", () => {
  it("emits data-field on the select element", async () => {
    const out = await render(
      <Select bind='language' icon={icon}>
        <Select.Option value='en'>English</Select.Option>
      </Select>,
    );
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background ps-3 py-2 pe-10 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-field="language"><option data-slot="select-option" value="en">English</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("renders the chevron icon and children options", async () => {
    const out = await render(
      <Select bind='language' icon={icon}>
        <Select.Option value='en' selected>
          English
        </Select.Option>
        <Select.Option value='fr'>French</Select.Option>
      </Select>,
    );
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background ps-3 py-2 pe-10 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-field="language"><option data-slot="select-option" value="en" selected>English</option><option data-slot="select-option" value="fr">French</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("passes data-ref through", async () => {
    const out = await render(
      <Select bind='language' icon={icon} data-ref='lang-select'>
        <Select.Option value='en'>English</Select.Option>
      </Select>,
    );
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background ps-3 py-2 pe-10 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-ref="lang-select" data-field="language"><option data-slot="select-option" value="en">English</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });
});
