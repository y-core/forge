/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Input } from "./input";

describe("controls/Input", () => {
  it("emits data-field on the input", async () => {
    const out = await render(<Input bind='name' value='ada' />);
    expect(out).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" value="ada" data-field="name">',
    );
  });

  it("passes value and data-ref through to the underlying input", async () => {
    const out = await render(<Input bind='name' value='ada' data-ref='name-input' />);
    expect(out).toBe(
      '<input data-slot="input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm" value="ada" data-ref="name-input" data-field="name">',
    );
  });
});
