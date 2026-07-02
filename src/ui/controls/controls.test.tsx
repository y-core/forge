/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { Select, Slider, Switch, ToggleGroup } from "./mod";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

describe("controls/Switch", () => {
  it("emits data-on-change and data-field on the input", async () => {
    const out = await render(
      <Switch bind='gridVisible' checked={true}>
        Grid
      </Switch>,
    );
    expect(out).toContain('data-on-change="bindField"');
    expect(out).toContain('data-field="gridVisible"');
  });

  it("passes checked and data-ref through to the underlying input", async () => {
    const out = await render(
      <Switch bind='gridVisible' checked={false} data-ref='grid-switch'>
        Grid
      </Switch>,
    );
    expect(out).toContain('data-ref="grid-switch"');
    expect(out).toContain("checked");
  });

  it("renders children as label text", async () => {
    const out = await render(
      <Switch bind='shadows' checked={true}>
        Shadows
      </Switch>,
    );
    expect(out).toContain("Shadows");
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(
      <Switch bind='x' checked={false} action='myAction'>
        X
      </Switch>,
    );
    expect(out).toContain('data-on-change="myAction"');
  });
});

describe("controls/Slider", () => {
  it("emits data-on-input and data-field on the range input", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={50} />);
    expect(out).toContain('data-on-input="bindField"');
    expect(out).toContain('data-field="fov"');
  });

  it("passes min, max, value, and data-ref through", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={60} data-ref='fov-slider' />);
    expect(out).toContain('min="10"');
    expect(out).toContain('max="120"');
    expect(out).toContain('value="60"');
    expect(out).toContain('data-ref="fov-slider"');
  });

  it("renders the output readout when output=true", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={75} output />);
    expect(out).toContain('data-slot="slider-output"');
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(<Slider bind='y' min={0} max={1} value={0} action='myAction' />);
    expect(out).toContain('data-on-input="myAction"');
  });
});

describe("controls/Select", () => {
  it("emits data-on-change and data-field on the select element", async () => {
    const out = await render(
      <Select bind='language' icon={icon}>
        <Select.Option value='en'>English</Select.Option>
      </Select>,
    );
    expect(out).toContain('data-on-change="bindField"');
    expect(out).toContain('data-field="language"');
  });

  it("renders the chevron icon and children options", async () => {
    const out = await render(
      <Select bind='language' icon={icon}>
        <Select.Option value='en' selected>
          English
        </Select.Option>
        <Select.Option value='fr'>French</Select.Option>
      </Select>,
    );
    expect(out).toContain("<use");
    expect(out).toContain('value="en"');
    expect(out).toContain('value="fr"');
    expect(out).toContain("English");
  });

  it("passes data-ref through", async () => {
    const out = await render(
      <Select bind='language' icon={icon} data-ref='lang-select'>
        <Select.Option value='en'>English</Select.Option>
      </Select>,
    );
    expect(out).toContain('data-ref="lang-select"');
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(
      <Select bind='z' icon={icon} action='myAction'>
        <Select.Option value='a'>A</Select.Option>
      </Select>,
    );
    expect(out).toContain('data-on-change="myAction"');
  });
});

describe("controls/ToggleGroup.Item", () => {
  it("emits data-field, data-value, and data-on-click on the button", async () => {
    const out = await render(
      <ToggleGroup aria-label='Projection'>
        <ToggleGroup.Item bind='projection' value='perspective' pressed>
          Perspective
        </ToggleGroup.Item>
      </ToggleGroup>,
    );
    expect(out).toContain('data-field="projection"');
    expect(out).toContain('data-value="perspective"');
    expect(out).toContain('data-on-click="bindGroup"');
  });

  it("passes pressed, aria-label, title, and data-ref through", async () => {
    const out = await render(
      <ToggleGroup.Item bind='projection' value='parallel' pressed={false} aria-label='Parallel' title='Parallel' data-ref='cam-parallel'>
        Parallel
      </ToggleGroup.Item>,
    );
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-label="Parallel"');
    expect(out).toContain('title="Parallel"');
    expect(out).toContain('data-ref="cam-parallel"');
  });

  it("does not forward bind or value as button attributes", async () => {
    const out = await render(
      <ToggleGroup.Item bind='projection' value='perspective'>
        P
      </ToggleGroup.Item>,
    );
    expect(out).not.toContain("bind=");
    expect(out).toContain('data-value="perspective"');
  });

  it("renders text children", async () => {
    const out = await render(
      <ToggleGroup.Item bind='projection' value='perspective'>
        Perspective
      </ToggleGroup.Item>,
    );
    expect(out).toContain("Perspective");
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(
      <ToggleGroup.Item bind='p' value='q' action='myAction'>
        Q
      </ToggleGroup.Item>,
    );
    expect(out).toContain('data-on-click="myAction"');
  });

  it("root group passes aria-label and data-ref through", async () => {
    const out = await render(<ToggleGroup aria-label='Views' data-ref='view-group' />);
    expect(out).toContain('aria-label="Views"');
    expect(out).toContain('data-ref="view-group"');
  });
});

// Contract: unrecognized props — any data-*/aria-* attribute — forward to the underlying
// element with HTML-escaped values. Consumers (e.g. cad-forge's chrome binding convention)
// rely on this instead of re-wrapping controls.
describe("controls — arbitrary attribute pass-through", () => {
  it("Switch forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Switch bind='b' data-test-hook='sw' />);
    expect(out).toContain('data-test-hook="sw"');
  });

  it("Slider forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Slider bind='b' data-test-hook='sl' />);
    expect(out).toContain('data-test-hook="sl"');
  });

  it("Select forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Select bind='b' icon={icon} data-test-hook='se' />);
    expect(out).toContain('data-test-hook="se"');
  });

  it("ToggleGroup.Item forwards an arbitrary data-* attribute", async () => {
    const out = await render(
      <ToggleGroup.Item bind='b' value='v' data-test-hook='tg'>
        V
      </ToggleGroup.Item>,
    );
    expect(out).toContain('data-test-hook="tg"');
  });

  it("HTML-escapes forwarded attribute values", async () => {
    const out = await render(<Switch bind='b' data-note='a&b "quoted"' />);
    expect(out).toContain('data-note="a&amp;b &quot;quoted&quot;"');
  });
});
