/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Slider } from "./slider";

const SLIDER_CLASS =
  "h-8 w-full cursor-pointer appearance-none rounded-full bg-transparent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

describe("controls/Slider", () => {
  it("emits data-field on the range input", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={50} />);
    expect(out).toBe(`<input data-slot="slider" type="range" class="${SLIDER_CLASS}" min="10" max="120" value="50" data-field="fov">`);
  });

  it("passes min, max, value, and data-ref through", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={60} data-ref='fov-slider' />);
    expect(out).toBe(
      `<input data-slot="slider" type="range" class="${SLIDER_CLASS}" min="10" max="120" value="60" data-ref="fov-slider" data-field="fov">`,
    );
  });

  it("renders the output readout when output=true", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={75} output />);
    expect(out).toBe(
      `<div data-slot="slider-wrapper" data-scope="slider" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="${SLIDER_CLASS}" data-on-input="sync" min="10" max="120" value="75" data-field="fov"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">75</output></div>`,
    );
  });
});
