/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { attrsOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { CheckboxGroup as CoreCheckboxGroup } from "../core/checkbox-group";
import { RadioGroup as CoreRadioGroup } from "../core/radio-group";
import { ToggleGroup as CoreToggleGroup } from "../core/toggle-group";
import { CheckboxGroup } from "./checkbox-group";
import { createBoundCompound, createBoundControl, createBoundItem } from "./create-bound-control";
import { RadioGroup } from "./radio-group";
import { ToggleGroup } from "./toggle-group";

describe("createBoundControl", () => {
  it("adds a bind prop that becomes data-field, and forwards everything else", async () => {
    // Spreads everything: the wrapper hands `data-field` down as a prop, so a stub that named only
    // its own props would drop it and prove nothing.
    const Bare = (props: { id: string }) => <span {...props} />;
    const Bound = createBoundControl(Bare);

    expect(await render(<Bound bind='thing' id='x' />)).toBe('<span id="x" data-field="thing"></span>');
  });

  it("overrides a data-field the caller already set", async () => {
    const Bound = createBoundControl((props: { id: string }) => <span {...props} />);

    expect(await render(<Bound bind='thing' data-field='stale' id='x' />)).toBe('<span data-field="thing" id="x"></span>');
  });

  it("forwards a caller's name untouched rather than deriving it from bind", async () => {
    const Bound = createBoundControl((props: { id: string; name?: string }) => <span {...props} />);

    expect(await render(<Bound bind='thing' id='x' name='other' />)).toBe('<span id="x" name="other" data-field="thing"></span>');
  });

  it("emits an empty data-field for an empty bind", async () => {
    const Bound = createBoundControl((props: { id: string }) => <span {...props} />);

    expect(await render(<Bound bind='' id='x' />)).toBe('<span id="x" data-field=""></span>');
  });

  it("carries the core component's own statics onto the wrapper", async () => {
    const Core = Object.assign((props: { id: string }) => <span {...props} />, { Label: () => <b>L</b>, Item: () => <i>core</i> });
    const Bound = createBoundControl(Core);

    expect(await render(<Bound.Label />)).toBe("<b>L</b>");
    expect(await render(<Bound.Item />)).toBe("<i>core</i>");
  });

  it("lets an override replace one static and wrap the original without re-entering itself", async () => {
    const Core = Object.assign((props: { id: string }) => <span {...props} />, { Label: () => <b>L</b>, Item: () => <i>core</i> });
    const Bound = createBoundControl(Core, { Item: () => <u>{Core.Item()}</u> });

    expect(await render(<Bound.Label />)).toBe("<b>L</b>");
    expect(await render(<Bound.Item />)).toBe("<u><i>core</i></u>");
  });
});

describe("createBoundCompound", () => {
  it("passes the root's props through untouched and carries every static over", async () => {
    const Core = Object.assign((props: { id: string }) => <span {...props} />, { Label: () => <b>L</b>, Item: () => <i>core</i> });
    const Bound = createBoundCompound(Core, { Item: () => <u>bound</u> });

    expect(await render(<Bound id='x' />)).toBe('<span id="x"></span>');
    expect(await render(<Bound.Label />)).toBe("<b>L</b>");
    expect(await render(<Bound.Item />)).toBe("<u>bound</u>");
  });
});

describe("createBoundItem", () => {
  const Item = createBoundItem((props: { name: string; value: string; id?: string }) => <input {...props} />);

  it("names the item after bind and stamps data-field and data-value", async () => {
    expect(attrsOf(await render(<Item bind='plan' value='free' id='x' />))).toEqual({
      id: "x",
      name: "plan",
      value: "free",
      "data-field": "plan",
      "data-value": "free",
    });
  });

  it("lets a caller's name win over bind while data-field still follows bind", async () => {
    expect(attrsOf(await render(<Item bind='plan' name='tier' value='free' />))).toEqual({
      name: "tier",
      value: "free",
      "data-field": "plan",
      "data-value": "free",
    });
  });
});

describe("createBoundItem — every bound group's Item is the shared one", () => {
  const props = { bind: "plan", value: "free", children: "Free" };

  it("CheckboxGroup.Item", async () => {
    const Shared = createBoundItem(CoreCheckboxGroup.Item);

    expect(await render(<CheckboxGroup.Item {...props} />)).toBe(await render(<Shared {...props} />));
  });

  it("RadioGroup.Item", async () => {
    const Shared = createBoundItem(CoreRadioGroup.Item);

    expect(await render(<RadioGroup.Item {...props} />)).toBe(await render(<Shared {...props} />));
  });

  it("ToggleGroup.Item", async () => {
    const Shared = createBoundItem(CoreToggleGroup.Item);

    expect(await render(<ToggleGroup.Item {...props} />)).toBe(await render(<Shared {...props} />));
  });
});
