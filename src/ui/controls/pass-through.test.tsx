/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { createIcon } from "../core/icon";
import { Input, Select, Slider, Switch, Textarea } from "./mod";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

const SLIDER_CLASS =
  "h-8 w-full cursor-pointer appearance-none rounded-full bg-transparent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

describe("controls — arbitrary attribute pass-through", () => {
  it("Switch forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Switch bind='b' data-test-hook='sw' />);
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-test-hook="sw" data-field="b"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-track motion-safe:transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background motion-safe:transition-transform [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4"></span></span></label>',
    );
  });

  it("Slider forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Slider bind='b' data-test-hook='sl' />);
    expect(out).toBe(`<input data-slot="slider" type="range" class="${SLIDER_CLASS}" data-test-hook="sl" data-field="b">`);
  });

  it("Input forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Input bind='b' data-test-hook='in' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" data-test-hook="in" data-field="b">',
    );
  });

  it("Textarea forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Textarea bind='b' data-test-hook='ta' />);
    expect(out).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground field-sizing-content min-h-16 max-h-64 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" data-test-hook="ta" data-field="b"></textarea>',
    );
  });

  it("Select forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Select bind='b' icon={icon} data-test-hook='se' />);
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background ps-3 py-2 pe-10 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-test-hook="se" data-field="b"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("HTML-escapes forwarded attribute values", async () => {
    const out = await render(<Switch bind='b' data-note='a&b "quoted"' />);
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-note="a&amp;b &quot;quoted&quot;" data-field="b"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-track motion-safe:transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background motion-safe:transition-transform [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4"></span></span></label>',
    );
  });
});
