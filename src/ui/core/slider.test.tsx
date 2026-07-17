import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Slider } from "./slider";

describe("Slider", () => {
  it("renders a bare range input by default", async () => {
    expect(await render(<Slider min={0} max={10} step={1} value={4} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="10" step="1" value="4">',
    );
  });

  it("wraps the input with a seeded output when output is set", async () => {
    expect(await render(<Slider min={0} max={10} value={4} output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="10" value="4"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">4</output></div>',
    );
  });

  it("spreads delegation attributes onto the input", async () => {
    expect(await render(<Slider data-on-input='setOpacity' data-setting='opacity' data-ref='opacity-slider' />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" data-on-input="setOpacity" data-setting="opacity" data-ref="opacity-slider">',
    );
  });

  it("passes the disabled attribute through", async () => {
    expect(await render(<Slider disabled />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" disabled>',
    );
    expect(await render(<Slider />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50">',
    );
  });

  it("merges a custom class with the base classes", async () => {
    expect(await render(<Slider class='extra-class' />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50 extra-class">',
    );
  });

  it("wires field id and name from the descriptor", async () => {
    expect(await render(<Slider field={{ name: "opacity" }} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" id="field-opacity" name="opacity" aria-describedby="field-opacity-description">',
    );
  });

  it("adds aria-invalid and aria-describedby when the field is invalid", async () => {
    expect(await render(<Slider field={{ name: "opacity", invalid: true }} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" id="field-opacity" name="opacity" aria-describedby="field-opacity-description field-opacity-error" aria-invalid="true">',
    );
  });

  it("horizontal orientation (default) uses the standard horizontal base classes", async () => {
    expect(await render(<Slider min={0} max={10} value={5} />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="10" value="5">',
    );
  });

  it("vertical orientation adds writing-mode and direction classes to the slider", async () => {
    expect(await render(<Slider min={0} max={10} value={5} orientation='vertical' />)).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50 [writing-mode:vertical-lr] [direction:rtl] h-22 w-5" min="0" max="10" value="5">',
    );
  });

  it("vertical orientation with output wraps in a flex-col container", async () => {
    expect(await render(<Slider min={0} max={10} value={5} orientation='vertical' output />)).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 flex-col items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50 [writing-mode:vertical-lr] [direction:rtl] h-22 w-5" min="0" max="10" value="5"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">5</output></div>',
    );
  });
});
