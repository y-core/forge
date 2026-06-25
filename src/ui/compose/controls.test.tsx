import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { bindControls } from "./controls";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });
const Bound = bindControls("bindField");
const Custom = bindControls("myAction");

describe("bindControls — Switch", () => {
  it("emits data-on-change and data-field on the input", async () => {
    const out = await render(
      <Bound.Switch bind='gridVisible' checked={true}>
        Grid
      </Bound.Switch>,
    );
    expect(out).toContain('data-on-change="bindField"');
    expect(out).toContain('data-field="gridVisible"');
  });

  it("passes checked and data-testid through to the underlying input", async () => {
    const out = await render(
      <Bound.Switch bind='gridVisible' checked={false} data-testid='grid-switch'>
        Grid
      </Bound.Switch>,
    );
    expect(out).toContain('data-testid="grid-switch"');
    expect(out).toContain("checked");
  });

  it("renders children as label text", async () => {
    const out = await render(
      <Bound.Switch bind='shadows' checked={true}>
        Shadows
      </Bound.Switch>,
    );
    expect(out).toContain("Shadows");
  });

  it("honours a custom action name", async () => {
    const out = await render(
      <Custom.Switch bind='x' checked={false}>
        X
      </Custom.Switch>,
    );
    expect(out).toContain('data-on-change="myAction"');
  });
});

describe("bindControls — Slider", () => {
  it("emits data-on-input and data-field on the range input", async () => {
    const out = await render(<Bound.Slider bind='fov' min={10} max={120} value={50} />);
    expect(out).toContain('data-on-input="bindField"');
    expect(out).toContain('data-field="fov"');
  });

  it("passes min, max, value, and data-testid through", async () => {
    const out = await render(<Bound.Slider bind='fov' min={10} max={120} value={60} data-testid='fov-slider' />);
    expect(out).toContain('min="10"');
    expect(out).toContain('max="120"');
    expect(out).toContain('value="60"');
    expect(out).toContain('data-testid="fov-slider"');
  });

  it("renders the output readout when output=true", async () => {
    const out = await render(<Bound.Slider bind='fov' min={10} max={120} value={75} output />);
    expect(out).toContain('data-slot="slider-output"');
  });

  it("honours a custom action name", async () => {
    const out = await render(<Custom.Slider bind='y' min={0} max={1} value={0} />);
    expect(out).toContain('data-on-input="myAction"');
  });
});

describe("bindControls — Select", () => {
  it("emits data-on-change and data-field on the select element", async () => {
    const out = await render(
      <Bound.Select bind='language' icon={icon}>
        <Bound.Select.Option value='en'>English</Bound.Select.Option>
      </Bound.Select>,
    );
    expect(out).toContain('data-on-change="bindField"');
    expect(out).toContain('data-field="language"');
  });

  it("renders the chevron icon and children options", async () => {
    const out = await render(
      <Bound.Select bind='language' icon={icon}>
        <Bound.Select.Option value='en' selected>
          English
        </Bound.Select.Option>
        <Bound.Select.Option value='fr'>French</Bound.Select.Option>
      </Bound.Select>,
    );
    expect(out).toContain("<use");
    expect(out).toContain('value="en"');
    expect(out).toContain('value="fr"');
    expect(out).toContain("English");
  });

  it("passes data-testid through", async () => {
    const out = await render(
      <Bound.Select bind='language' icon={icon} data-testid='lang-select'>
        <Bound.Select.Option value='en'>English</Bound.Select.Option>
      </Bound.Select>,
    );
    expect(out).toContain('data-testid="lang-select"');
  });

  it("honours a custom action name", async () => {
    const out = await render(
      <Custom.Select bind='z' icon={icon}>
        <Custom.Select.Option value='a'>A</Custom.Select.Option>
      </Custom.Select>,
    );
    expect(out).toContain('data-on-change="myAction"');
  });
});

describe("bindControls — ToggleGroup.Item", () => {
  it("emits data-field, data-value, and data-on-click on the button", async () => {
    const out = await render(
      <Bound.ToggleGroup aria-label='Projection'>
        <Bound.ToggleGroup.Item bind='projection' value='perspective' pressed>
          Perspective
        </Bound.ToggleGroup.Item>
      </Bound.ToggleGroup>,
    );
    expect(out).toContain('data-field="projection"');
    expect(out).toContain('data-value="perspective"');
    expect(out).toContain('data-on-click="bindField"');
  });

  it("passes pressed, aria-label, title, and data-testid through", async () => {
    const out = await render(
      <Bound.ToggleGroup.Item bind='projection' value='parallel' pressed={false} aria-label='Parallel' title='Parallel' data-testid='cam-parallel'>
        Parallel
      </Bound.ToggleGroup.Item>,
    );
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-label="Parallel"');
    expect(out).toContain('title="Parallel"');
    expect(out).toContain('data-testid="cam-parallel"');
  });

  it("does not forward bind or value as button attributes", async () => {
    const out = await render(
      <Bound.ToggleGroup.Item bind='projection' value='perspective'>
        P
      </Bound.ToggleGroup.Item>,
    );
    expect(out).not.toContain("bind=");
    expect(out).toContain('data-value="perspective"');
  });

  it("renders text and icon children", async () => {
    const out = await render(
      <Bound.ToggleGroup.Item bind='projection' value='perspective'>
        Perspective
      </Bound.ToggleGroup.Item>,
    );
    expect(out).toContain("Perspective");
  });

  it("honours a custom action name", async () => {
    const out = await render(
      <Custom.ToggleGroup.Item bind='p' value='q'>
        Q
      </Custom.ToggleGroup.Item>,
    );
    expect(out).toContain('data-on-click="myAction"');
  });

  it("root group passes aria-label and data-testid through", async () => {
    const out = await render(<Bound.ToggleGroup aria-label='Views' data-testid='view-group' />);
    expect(out).toContain('aria-label="Views"');
    expect(out).toContain('data-testid="view-group"');
  });
});
