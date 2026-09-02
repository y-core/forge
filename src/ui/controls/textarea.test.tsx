/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Textarea } from "./textarea";

describe("controls/Textarea", () => {
  it("emits data-field on the textarea", async () => {
    const out = await render(<Textarea bind='bio' />);
    expect(out).toBe(
      '<textarea data-slot="textarea" class="field-sizing-content max-h-64 min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none resize-y disabled:cursor-not-allowed disabled:opacity-50" data-field="bio"></textarea>',
    );
  });

  it("passes data-ref through and renders children", async () => {
    const out = await render(
      <Textarea bind='bio' data-ref='bio-textarea'>
        Hello
      </Textarea>,
    );
    expect(out).toBe(
      '<textarea data-slot="textarea" class="field-sizing-content max-h-64 min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none resize-y disabled:cursor-not-allowed disabled:opacity-50" data-ref="bio-textarea" data-field="bio">Hello</textarea>',
    );
  });
});
