/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { RadioGroup } from "./radio-group";

const GROUP_CLASS = "state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col";

const ITEM_CLASS = "inline-flex items-center gap-2 text-sm text-foreground";

const INPUT_CLASS =
  "state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input " +
  "bg-background focus-ring-outset checked:bg-primary size-4";

const GROUP_OPEN = `<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="${GROUP_CLASS}">`;

const item = (id: string, name: string, value: string, field: string, children = "") =>
  `<label data-slot="radio-group-item" class="${ITEM_CLASS}">` +
  `<input type="radio" data-slot="radio-group-input" id="${id}" name="${name}" value="${value}" class="${INPUT_CLASS}" data-field="${field}" data-value="${value}">` +
  `${children}</label>`;

describe("controls/RadioGroup", () => {
  it("stamps data-field and data-value on each item", async () => {
    expect(
      await render(
        <RadioGroup name='plan'>
          <RadioGroup.Item bind='plan' value='basic' />
          <RadioGroup.Item bind='plan' value='pro' />
        </RadioGroup>,
      ),
    ).toBe(GROUP_OPEN + item("field-plan-basic", "plan", "basic", "plan") + item("field-plan-pro", "plan", "pro", "plan") + "</fieldset>");
  });

  it("defaults the input's name to the bound field, so the two cannot drift apart", async () => {
    expect(await render(<RadioGroup.Item bind='plan' value='basic' />)).toBe(item("field-plan-basic", "plan", "basic", "plan"));
  });

  it("lets a caller name the group explicitly when it differs from the field", async () => {
    expect(await render(<RadioGroup.Item bind='plan' name='billing' value='basic' />)).toBe(
      item("field-billing-basic", "billing", "basic", "plan"),
    );
  });

  // Every static the core compound publishes, from `ui/controls` alone: `NAMESPACES.md` §5b
  // forbids importing the core twin beside the bound one, so a static the wrapper drops has no
  // workaround at the call site — it is simply `undefined`.
  it("publishes the full README-documented compound, not only .Item", async () => {
    expect(
      await render(
        <RadioGroup name='toppings'>
          <RadioGroup.Label>Toppings</RadioGroup.Label>
          <RadioGroup.Item bind='toppings' value='olives'>
            Olives
          </RadioGroup.Item>
          <RadioGroup.Description>Pick any.</RadioGroup.Description>
          <RadioGroup.Error>Pick one.</RadioGroup.Error>
        </RadioGroup>,
      ),
    ).toBe(
      GROUP_OPEN +
        '<legend data-slot="radio-group-label" class="mb-1 text-sm font-medium text-foreground">Toppings</legend>' +
        item("field-toppings-olives", "toppings", "olives", "toppings", "Olives") +
        '<p data-slot="field-description" class="text-sm leading-normal text-muted-foreground">Pick any.</p>' +
        '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" role="alert">Pick one.</p></fieldset>',
    );
  });
});
