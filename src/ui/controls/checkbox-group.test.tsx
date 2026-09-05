/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { CheckboxGroup } from "./checkbox-group";

const GROUP_CLASS = "state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col";

const ITEM_CLASS = "inline-flex items-center gap-2 text-sm text-foreground";

const INPUT_CLASS =
  "state-busy state-disabled shrink-0 appearance-none rounded border state-invalid border-input " +
  "bg-background focus-ring-outset checked:bg-primary size-4";

const GROUP_OPEN = `<fieldset data-slot="checkbox-group" data-size="md" data-orientation="vertical" class="${GROUP_CLASS}">`;

describe("controls/CheckboxGroup", () => {
  it("stamps data-field and data-value on each item", async () => {
    expect(
      await render(
        <CheckboxGroup name='toppings'>
          <CheckboxGroup.Item bind='toppings' value='olives' />
        </CheckboxGroup>,
      ),
    ).toBe(
      `${GROUP_OPEN}<label data-slot="checkbox-group-item" class="${ITEM_CLASS}">` +
        `<input type="checkbox" data-slot="checkbox-group-input" id="field-toppings-olives" name="toppings" value="olives" class="${INPUT_CLASS}" data-field="toppings" data-value="olives">` +
        "</label></fieldset>",
    );
  });

  it("passes checked through, which is how the server paints the initial set", async () => {
    expect(await render(<CheckboxGroup.Item bind='toppings' value='olives' checked />)).toBe(
      `<label data-slot="checkbox-group-item" class="${ITEM_CLASS}">` +
        `<input type="checkbox" data-slot="checkbox-group-input" id="field-toppings-olives" name="toppings" value="olives" class="${INPUT_CLASS}" checked data-field="toppings" data-value="olives">` +
        "</label>",
    );
  });

  // Every static the core compound publishes, from `ui/controls` alone: `NAMESPACES.md` §5b
  // forbids importing the core twin beside the bound one, so a static the wrapper drops has no
  // workaround at the call site — it is simply `undefined`.
  it("publishes the full README-documented compound, not only .Item", async () => {
    expect(
      await render(
        <CheckboxGroup name='toppings'>
          <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
          <CheckboxGroup.Item bind='toppings' value='olives'>
            Olives
          </CheckboxGroup.Item>
          <CheckboxGroup.Description>Pick any.</CheckboxGroup.Description>
          <CheckboxGroup.Error>Pick one.</CheckboxGroup.Error>
        </CheckboxGroup>,
      ),
    ).toBe(
      `${GROUP_OPEN}<legend data-slot="checkbox-group-label" class="mb-1 text-sm font-medium text-foreground">Toppings</legend>` +
        `<label data-slot="checkbox-group-item" class="${ITEM_CLASS}">` +
        `<input type="checkbox" data-slot="checkbox-group-input" id="field-toppings-olives" name="toppings" value="olives" class="${INPUT_CLASS}" data-field="toppings" data-value="olives">` +
        "Olives</label>" +
        '<p data-slot="field-description" class="text-sm leading-normal text-muted-foreground">Pick any.</p>' +
        '<p data-slot="field-error" class="text-sm font-normal text-destructive-text" role="alert">Pick one.</p></fieldset>',
    );
  });
});
