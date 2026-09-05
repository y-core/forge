/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Textarea } from "./textarea";

describe("controls/Textarea", () => {
  it("emits data-field on the textarea", async () => {
    const out = await render(<Textarea bind='bio' />);
    expect(out).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" data-field="bio"></textarea>',
    );
  });

  it("passes data-ref through and renders children", async () => {
    const out = await render(
      <Textarea bind='bio' data-ref='bio-textarea'>
        Hello
      </Textarea>,
    );
    expect(out).toBe(
      '<textarea data-slot="textarea" data-size="md" class="state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring text-sm" data-ref="bio-textarea" data-field="bio">Hello</textarea>',
    );
  });
});
