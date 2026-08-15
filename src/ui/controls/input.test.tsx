/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Input } from "./input";

describe("controls/Input", () => {
  it("emits data-field on the input", async () => {
    const out = await render(<Input bind='name' value='ada' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" value="ada" data-field="name">',
    );
  });

  it("passes value and data-ref through to the underlying input", async () => {
    const out = await render(<Input bind='name' value='ada' data-ref='name-input' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" value="ada" data-ref="name-input" data-field="name">',
    );
  });
});
