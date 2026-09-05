import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Switch } from "./switch";

describe("Switch", () => {
  it("renders a label wrapper with a checkbox input in switch role", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("renders the decorative track and thumb", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("reflects the checked attribute when set", async () => {
    expect(await render(<Switch checked />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("spreads delegation attributes onto the input", async () => {
    expect(await render(<Switch data-on-change='toggle' data-setting='grid' data-ref='grid-switch' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-on-change="toggle" data-setting="grid" data-ref="grid-switch"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("passes the disabled attribute through", async () => {
    expect(await render(<Switch disabled />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" disabled><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("merges a custom class with the base wrapper classes", async () => {
    expect(await render(<Switch class='extra-class' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid extra-class"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("wires field id and name from the descriptor", async () => {
    expect(await render(<Switch field={{ name: "grid" }} />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" id="field-grid" name="grid"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("adds aria-invalid and aria-describedby when the field is invalid", async () => {
    expect(await render(<Switch field={{ name: "grid", invalid: true }} />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" id="field-grid" name="grid" aria-describedby="field-grid-error" aria-invalid="true"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("renders label children inside the wrapper", async () => {
    expect(await render(<Switch>Snap to grid</Switch>)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span>Snap to grid</label>',
    );
  });

  it("defaults to label-after: data-label-position=after, a horizontal axis, and no flex-row-reverse", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("emits no value attribute by default, and the caller's when one is given", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
    expect(await render(<Switch value='on' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" value="on"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("labelPlacement='before' stamps data-label-position=before and adds flex-row-reverse", async () => {
    expect(await render(<Switch labelPlacement='before' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="before" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid flex-row-reverse"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });
});

describe("Switch — size, invalid and busy", () => {
  it("stamps data-size=md and the md track and thumb by default", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("size='sm' shrinks the track, the thumb and its travel", async () => {
    expect(await render(<Switch size='sm' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="sm" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-4 w-7"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-3 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-3 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-3"></span></span></label>',
    );
  });

  it("size='lg' grows the track, the thumb and its travel", async () => {
    expect(await render(<Switch size='lg' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="lg" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-6 w-11"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-5 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-5 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-5"></span></span></label>',
    );
  });

  it("invalid stamps data-invalid beside aria-invalid on the input", async () => {
    expect(await render(<Switch invalid />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-invalid="" aria-invalid="true"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("busy stamps data-busy beside aria-busy on the input", async () => {
    expect(await render(<Switch busy />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-busy="" aria-busy="true"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });

  it("labelPlacement='after' is the default", async () => {
    expect(await render(<Switch labelPlacement='after' />)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md" class="state-busy inline-flex items-center gap-2 state-invalid"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9"><span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform size-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:translate-x-4 [[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:rtl:-translate-x-4"></span></span></label>',
    );
  });
});
