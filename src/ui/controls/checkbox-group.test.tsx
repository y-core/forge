/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { CheckboxGroup } from "./checkbox-group";

describe("controls/CheckboxGroup", () => {
  it("stamps data-field and data-value on each item", async () => {
    const out = await render(
      <CheckboxGroup name='toppings'>
        <CheckboxGroup.Item bind='toppings' value='olives' />
      </CheckboxGroup>,
    );

    expect(out).toContain('data-field="toppings"');
    expect(out).toContain('data-value="olives"');
  });

  it("passes checked through, which is how the server paints the initial set", async () => {
    expect(await render(<CheckboxGroup.Item bind='toppings' value='olives' checked />)).toContain(" checked");
  });
});
