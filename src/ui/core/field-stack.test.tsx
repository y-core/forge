import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Field } from "./field-stack";

describe("Field (layout)", () => {
  it("renders a label caption bound to its control children", async () => {
    expect(
      await render(
        <Field label='Field of view'>
          <input data-ref='control' />
        </Field>,
      ),
    ).toBe(
      '<div data-slot="field" data-orientation="vertical" class="flex flex-col gap-1"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">Field of view</span><input data-ref="control"></div>',
    );
  });

  it("defaults to vertical orientation", async () => {
    expect(await render(<Field label='X' />)).toBe(
      '<div data-slot="field" data-orientation="vertical" class="flex flex-col gap-1"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">X</span></div>',
    );
  });

  it("supports horizontal orientation", async () => {
    expect(await render(<Field label='X' orientation='horizontal' />)).toBe(
      '<div data-slot="field" data-orientation="horizontal" class="flex items-center gap-2"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">X</span></div>',
    );
  });

  it("merges a custom class onto the wrapper", async () => {
    expect(await render(<Field label='X' class='extra-class' />)).toBe(
      '<div data-slot="field" data-orientation="vertical" class="flex flex-col gap-1 extra-class"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">X</span></div>',
    );
  });

  it("spreads arbitrary attributes onto the wrapper", async () => {
    expect(await render(<Field label='X' data-ref='fov-field' />)).toBe(
      '<div data-slot="field" data-orientation="vertical" class="flex flex-col gap-1" data-ref="fov-field"><span data-slot="field-label" class="text-xs font-medium text-muted-foreground">X</span></div>',
    );
  });
});
