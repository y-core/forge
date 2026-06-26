import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Slider } from "./slider";

describe("Slider", () => {
  it("renders a bare range input by default", async () => {
    const out = await render(<Slider min={0} max={10} step={1} value={4} />);
    expect(out).toContain('data-slot="slider"');
    expect(out).toContain('type="range"');
    expect(out).toContain('min="0"');
    expect(out).toContain('max="10"');
    expect(out).toContain('step="1"');
    expect(out).toContain('value="4"');
    expect(out).not.toContain('data-slot="slider-wrapper"');
  });

  it("wraps the input with a seeded output when output is set", async () => {
    const out = await render(<Slider min={0} max={10} value={4} output />);
    expect(out).toContain('data-slot="slider-wrapper"');
    expect(out).toContain('data-slot="slider"');
    expect(out).toContain('data-slot="slider-output"');
    expect(out).toContain("<output");
    expect(out).toContain(">4</output>");
  });

  it("spreads delegation attributes onto the input", async () => {
    const out = await render(<Slider data-on-input='setOpacity' data-setting='opacity' data-ref='opacity-slider' />);
    expect(out).toContain('data-on-input="setOpacity"');
    expect(out).toContain('data-setting="opacity"');
    expect(out).toContain('data-ref="opacity-slider"');
  });

  it("passes the disabled attribute through", async () => {
    const withDisabled = await render(<Slider disabled />);
    const withoutDisabled = await render(<Slider />);
    expect(withDisabled).toMatch(/\bdisabled(?!:)/);
    expect(withoutDisabled).not.toMatch(/\bdisabled(?!:)/);
  });

  it("merges a custom class with the base classes", async () => {
    const out = await render(<Slider class='extra-class' />);
    expect(out).toContain("extra-class");
    expect(out).toContain("appearance-none");
  });

  it("wires field id and name from the descriptor", async () => {
    const out = await render(<Slider field={{ name: "opacity" }} />);
    expect(out).toContain('id="field-opacity"');
    expect(out).toContain('name="opacity"');
  });

  it("adds aria-invalid and aria-describedby when the field is invalid", async () => {
    const out = await render(<Slider field={{ name: "opacity", invalid: true }} />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="field-opacity-description field-opacity-error"');
  });

  it("horizontal orientation (default) uses the standard horizontal base classes", async () => {
    const out = await render(<Slider min={0} max={10} value={5} />);
    expect(out).toContain("w-full");
    expect(out).toContain("h-2");
    expect(out).not.toContain("writing-mode");
  });

  it("vertical orientation adds writing-mode and direction classes to the slider", async () => {
    const out = await render(<Slider min={0} max={10} value={5} orientation='vertical' />);
    expect(out).toContain("[writing-mode:vertical-lr]");
    expect(out).toContain("[direction:rtl]");
  });

  it("vertical orientation with output wraps in a flex-col container", async () => {
    const out = await render(<Slider min={0} max={10} value={5} orientation='vertical' output />);
    expect(out).toContain('data-slot="slider-wrapper"');
    expect(out).toContain("flex-col");
    expect(out).toContain("items-center");
  });
});
