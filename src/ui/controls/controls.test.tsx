/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { Input, Select, Slider, Switch, Textarea, ToggleGroup } from "./mod";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

describe("controls/Switch", () => {
  it("emits data-on-change and data-field on the input", async () => {
    const out = await render(
      <Switch bind='gridVisible' checked={true}>
        Grid
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked data-on-change="bindField" data-field="gridVisible"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span>Grid</label>',
    );
  });

  it("passes checked and data-ref through to the underlying input", async () => {
    const out = await render(
      <Switch bind='gridVisible' checked={false} data-ref='grid-switch'>
        Grid
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-ref="grid-switch" data-on-change="bindField" data-field="gridVisible"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span>Grid</label>',
    );
  });

  it("renders children as label text", async () => {
    const out = await render(
      <Switch bind='shadows' checked={true}>
        Shadows
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" checked data-on-change="bindField" data-field="shadows"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span>Shadows</label>',
    );
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(
      <Switch bind='x' checked={false} action='myAction'>
        X
      </Switch>,
    );
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-on-change="myAction" data-field="x"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span>X</label>',
    );
  });
});

describe("controls/Slider", () => {
  it("emits data-on-input and data-field on the range input", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={50} />);
    expect(out).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="10" max="120" value="50" data-on-input="bindField" data-field="fov">',
    );
  });

  it("passes min, max, value, and data-ref through", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={60} data-ref='fov-slider' />);
    expect(out).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="10" max="120" value="60" data-ref="fov-slider" data-on-input="bindField" data-field="fov">',
    );
  });

  it("renders the output readout when output=true", async () => {
    const out = await render(<Slider bind='fov' min={10} max={120} value={75} output />);
    expect(out).toBe(
      '<div data-slot="slider-wrapper" class="flex gap-2 items-center"><input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="10" max="120" value="75" data-on-input="bindField" data-field="fov"><output data-slot="slider-output" class="text-sm tabular-nums text-muted-foreground">75</output></div>',
    );
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(<Slider bind='y' min={0} max={1} value={0} action='myAction' />);
    expect(out).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" min="0" max="1" value="0" data-on-input="myAction" data-field="y">',
    );
  });
});

describe("controls/Input", () => {
  it("emits data-on-input and data-field on the input", async () => {
    const out = await render(<Input bind='name' value='ada' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" value="ada" data-on-input="bindField" data-field="name">',
    );
  });

  it("passes value and data-ref through to the underlying input", async () => {
    const out = await render(<Input bind='name' value='ada' data-ref='name-input' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" value="ada" data-ref="name-input" data-on-input="bindField" data-field="name">',
    );
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(<Input bind='name' action='myAction' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" data-on-input="myAction" data-field="name">',
    );
  });
});

describe("controls/Textarea", () => {
  it("emits data-on-input and data-field on the textarea", async () => {
    const out = await render(<Textarea bind='bio' />);
    expect(out).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" data-on-input="bindField" data-field="bio"></textarea>',
    );
  });

  it("passes data-ref through and renders children", async () => {
    const out = await render(
      <Textarea bind='bio' data-ref='bio-textarea'>
        Hello
      </Textarea>,
    );
    expect(out).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" data-ref="bio-textarea" data-on-input="bindField" data-field="bio">Hello</textarea>',
    );
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(<Textarea bind='bio' action='myAction' />);
    expect(out).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" data-on-input="myAction" data-field="bio"></textarea>',
    );
  });
});

describe("controls/Select", () => {
  it("emits data-on-change and data-field on the select element", async () => {
    const out = await render(
      <Select bind='language' icon={icon}>
        <Select.Option value='en'>English</Select.Option>
      </Select>,
    );
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-on-change="bindField" data-field="language"><option data-slot="select-option" value="en">English</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
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
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-on-change="bindField" data-field="language"><option data-slot="select-option" value="en" selected>English</option><option data-slot="select-option" value="fr">French</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("passes data-ref through", async () => {
    const out = await render(
      <Select bind='language' icon={icon} data-ref='lang-select'>
        <Select.Option value='en'>English</Select.Option>
      </Select>,
    );
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-ref="lang-select" data-on-change="bindField" data-field="language"><option data-slot="select-option" value="en">English</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(
      <Select bind='z' icon={icon} action='myAction'>
        <Select.Option value='a'>A</Select.Option>
      </Select>,
    );
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-on-change="myAction" data-field="z"><option data-slot="select-option" value="a">A</option></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
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
    expect(out).toBe(
      '<fieldset role="toolbar" data-slot="toggle-group" data-orientation="horizontal" aria-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0" aria-label="Projection"><button type="button" data-slot="toggle-group-item" aria-pressed="true" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px] bg-primary text-primary-foreground hover:bg-primary" data-field="projection" data-value="perspective" data-on-click="bindGroup">Perspective</button></fieldset>',
    );
  });

  it("passes pressed, aria-label, title, and data-ref through", async () => {
    const out = await render(
      <ToggleGroup.Item bind='projection' value='parallel' pressed={false} aria-label='Parallel' title='Parallel' data-ref='cam-parallel'>
        Parallel
      </ToggleGroup.Item>,
    );
    expect(out).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px]" aria-label="Parallel" title="Parallel" data-ref="cam-parallel" data-field="projection" data-value="parallel" data-on-click="bindGroup">Parallel</button>',
    );
  });

  it("does not forward bind or value as button attributes", async () => {
    const out = await render(
      <ToggleGroup.Item bind='projection' value='perspective'>
        P
      </ToggleGroup.Item>,
    );
    expect(out).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px]" data-field="projection" data-value="perspective" data-on-click="bindGroup">P</button>',
    );
  });

  it("renders text children", async () => {
    const out = await render(
      <ToggleGroup.Item bind='projection' value='perspective'>
        Perspective
      </ToggleGroup.Item>,
    );
    expect(out).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px]" data-field="projection" data-value="perspective" data-on-click="bindGroup">Perspective</button>',
    );
  });

  it("honours a custom action name via the action prop", async () => {
    const out = await render(
      <ToggleGroup.Item bind='p' value='q' action='myAction'>
        Q
      </ToggleGroup.Item>,
    );
    expect(out).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px]" data-field="p" data-value="q" data-on-click="myAction">Q</button>',
    );
  });

  it("root group passes aria-label and data-ref through", async () => {
    const out = await render(<ToggleGroup aria-label='Views' data-ref='view-group' />);
    expect(out).toBe(
      '<fieldset role="toolbar" data-slot="toggle-group" data-orientation="horizontal" aria-orientation="horizontal" class="flex justify-center min-w-0 border-0 m-0 p-0" aria-label="Views" data-ref="view-group"></fieldset>',
    );
  });
});

// Contract: unrecognized props — any data-*/aria-* attribute — forward to the underlying
// element with HTML-escaped values. Consumers (e.g. cad-forge's chrome binding convention)
// rely on this instead of re-wrapping controls.
describe("controls — arbitrary attribute pass-through", () => {
  it("Switch forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Switch bind='b' data-test-hook='sw' />);
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-test-hook="sw" data-on-change="bindField" data-field="b"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });

  it("Slider forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Slider bind='b' data-test-hook='sl' />);
    expect(out).toBe(
      '<input data-slot="slider" type="range" class="h-2 w-full cursor-pointer appearance-none rounded-full bg-input accent-primary disabled:opacity-50" data-test-hook="sl" data-on-input="bindField" data-field="b">',
    );
  });

  it("Input forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Input bind='b' data-test-hook='in' />);
    expect(out).toBe(
      '<input data-slot="input" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50" data-test-hook="in" data-on-input="bindField" data-field="b">',
    );
  });

  it("Textarea forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Textarea bind='b' data-test-hook='ta' />);
    expect(out).toBe(
      '<textarea data-slot="textarea" class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 resize-y" data-test-hook="ta" data-on-input="bindField" data-field="b"></textarea>',
    );
  });

  it("Select forwards an arbitrary data-* attribute", async () => {
    const out = await render(<Select bind='b' icon={icon} data-test-hook='se' />);
    expect(out).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50"><select data-slot="select" class="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:pointer-events-none" data-test-hook="se" data-on-change="bindField" data-field="b"></select><span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("ToggleGroup.Item forwards an arbitrary data-* attribute", async () => {
    const out = await render(
      <ToggleGroup.Item bind='b' value='v' data-test-hook='tg'>
        V
      </ToggleGroup.Item>,
    );
    expect(out).toBe(
      '<button type="button" data-slot="toggle-group-item" aria-pressed="false" class="inline-flex items-center justify-center bg-transparent text-foreground border border-input border-l-0 cursor-pointer first:border-l first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-accent-foreground [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-l [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:rounded-none [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:border-t [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md [[data-slot=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md size-[34px] [&amp;_svg]:size-[18px]" data-test-hook="tg" data-field="b" data-value="v" data-on-click="bindGroup">V</button>',
    );
  });

  it("HTML-escapes forwarded attribute values", async () => {
    const out = await render(<Switch bind='b' data-note='a&b "quoted"' />);
    expect(out).toBe(
      '<label data-slot="switch" data-orientation="label-after" class="inline-flex items-center gap-2"><input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only" data-note="a&amp;b &quot;quoted&quot;" data-on-change="bindField" data-field="b"><span data-slot="switch-track" aria-hidden="true" class="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50"><span data-slot="switch-thumb" class="absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4"></span></span></label>',
    );
  });
});
