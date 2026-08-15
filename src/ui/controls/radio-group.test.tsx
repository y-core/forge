/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { RadioGroup } from "./radio-group";

describe("controls/RadioGroup", () => {
  it("stamps data-field and data-value on each item", async () => {
    const out = await render(
      <RadioGroup name='plan'>
        <RadioGroup.Item bind='plan' value='basic' />
        <RadioGroup.Item bind='plan' value='pro' />
      </RadioGroup>,
    );

    expect([...out.matchAll(/data-field="plan"/g)]).toHaveLength(2);
    expect(out).toContain('data-value="basic"');
    expect(out).toContain('data-value="pro"');
  });

  it("defaults the input's name to the bound field, so the two cannot drift apart", async () => {
    expect(await render(<RadioGroup.Item bind='plan' value='basic' />)).toContain('name="plan"');
  });

  it("lets a caller name the group explicitly when it differs from the field", async () => {
    expect(await render(<RadioGroup.Item bind='plan' name='billing' value='basic' />)).toContain('name="billing"');
  });
});
