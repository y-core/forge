import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Field } from "./field-stack";

describe("Field (layout)", () => {
  it("renders a label caption bound to its control children", async () => {
    const out = await render(
      <Field label='Field of view'>
        <input data-ref='control' />
      </Field>,
    );
    expect(out).toContain('data-slot="field"');
    expect(out).toContain('data-slot="field-label"');
    expect(out).toContain("Field of view");
    expect(out).toContain('data-ref="control"');
  });

  it("defaults to vertical orientation", async () => {
    const out = await render(<Field label='X' />);
    expect(out).toContain('data-orientation="vertical"');
    expect(out).toContain("flex-col");
  });

  it("supports horizontal orientation", async () => {
    const out = await render(<Field label='X' orientation='horizontal' />);
    expect(out).toContain('data-orientation="horizontal"');
    expect(out).toContain("items-center");
  });

  it("merges a custom class onto the wrapper", async () => {
    const out = await render(<Field label='X' class='extra-class' />);
    expect(out).toContain("extra-class");
    expect(out).toContain("flex");
  });

  it("spreads arbitrary attributes onto the wrapper", async () => {
    const out = await render(<Field label='X' data-ref='fov-field' />);
    expect(out).toContain('data-ref="fov-field"');
  });
});
