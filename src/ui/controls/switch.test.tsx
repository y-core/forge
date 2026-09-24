/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Switch } from "./switch";

describe("controls/Switch", () => {
  it("emits data-field on the input", async () => {
    const out = await render(
      <Switch bind='gridVisible' checked={true}>
        Grid
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked data-field="gridVisible"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span>Grid</label>',
    );
  });

  it("passes checked and data-ref through to the underlying input", async () => {
    const out = await render(
      <Switch bind='gridVisible' checked={false} data-ref='grid-switch'>
        Grid
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-ref="grid-switch" data-field="gridVisible"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span>Grid</label>',
    );
  });

  it("renders children as label text", async () => {
    const out = await render(
      <Switch bind='shadows' checked={true}>
        Shadows
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked data-field="shadows"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span>Shadows</label>',
    );
  });
});
