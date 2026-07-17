import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Switch } from "./switch";

describe("Switch", () => {
  it("renders a label wrapper with a checkbox input in switch role", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("renders the decorative track and thumb", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("reflects the checked attribute when set", async () => {
    expect(await render(<Switch checked />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("spreads delegation attributes onto the input", async () => {
    expect(await render(<Switch data-on-change='toggle' data-setting='grid' data-ref='grid-switch' />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-on-change="toggle" data-setting="grid" data-ref="grid-switch"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("passes the disabled attribute through", async () => {
    expect(await render(<Switch disabled />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" disabled><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("merges a custom class with the base wrapper classes", async () => {
    expect(await render(<Switch class='extra-class' />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2 extra-class"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("wires field id and name from the descriptor", async () => {
    expect(await render(<Switch field={{ name: "grid" }} />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" id="field-grid" name="grid" aria-describedby="field-grid-description"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("adds aria-invalid and aria-describedby when the field is invalid", async () => {
    expect(await render(<Switch field={{ name: "grid", invalid: true }} />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" id="field-grid" name="grid" aria-describedby="field-grid-description field-grid-error" aria-invalid="true"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("renders label children inside the wrapper", async () => {
    expect(await render(<Switch>Snap to grid</Switch>)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span>Snap to grid</label>',
    );
  });

  it("defaults to label-after orientation with data-orientation and no flex-row-reverse", async () => {
    expect(await render(<Switch />)).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("label-before orientation stamps data-orientation and adds flex-row-reverse", async () => {
    expect(await render(<Switch orientation='label-before' />)).toBe(
      '<label data-slot="switch" data-orientation="label-before" class="inline-flex items-center gap-2 flex-row-reverse"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });
});
