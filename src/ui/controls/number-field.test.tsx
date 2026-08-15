/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { NumberField } from "./number-field";

describe("controls/NumberField", () => {
  it("binds only the input, since the steppers drive it rather than the signal", async () => {
    const out = await render(
      <NumberField>
        <NumberField.Decrement />
        <NumberField.Input bind='count' value={3} />
        <NumberField.Increment />
      </NumberField>,
    );

    expect([...out.matchAll(/data-field="count"/g)]).toHaveLength(1);
    expect(out).toContain('data-slot="number-field-input"');
  });

  it("re-exports the steppers unchanged, so the compound still composes", async () => {
    expect(await render(<NumberField.Increment />)).toContain('data-slot="number-field-increment"');
  });
});
