import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Field } from "./field-stack";
import { createIcon } from "./icon";
import { Select } from "./select";
import { Slider } from "./slider";
import { Switch } from "./switch";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

const CAPTION = 'data-slot="field-stack-label"';

describe("Field (layout)", () => {
  it("renders the whole stack exactly, its caption escaped and the control kept after it", async () => {
    expect(
      await render(
        <Field label={`R&D's`}>
          <input data-ref='control' />
        </Field>,
      ),
    ).toBe(
      '<div data-slot="field-stack" data-orientation="vertical" class="flex flex-col gap-1">' +
        '<span data-slot="field-stack-label" class="text-xs font-medium text-muted-foreground">R&amp;D&#39;s</span>' +
        '<input data-ref="control"></div>',
    );
  });

  it("stands its caption above the control unless told otherwise, and says which on the attribute", async () => {
    expect(attrsOf(await render(<Field label='X' />))).toEqual({ "data-slot": "field-stack", "data-orientation": "vertical" });
  });

  it("names the horizontal orientation it was given, so a stylesheet keys on it rather than on a class", async () => {
    expect(attrsOf(await render(<Field label='X' orientation='horizontal' />))).toEqual({
      "data-slot": "field-stack",
      "data-orientation": "horizontal",
    });
  });

  it("lays the caption alongside the control when horizontal rather than keeping both layouts", async () => {
    expect(variantClasses(await render(<Field label='X' orientation='horizontal' />), await render(<Field label='X' />))).toEqual({
      added: ["items-center", "gap-2"],
      dropped: ["flex-col", "gap-1"],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Field label='X' class='extra-class' />)).at(-1)).toBe("extra-class");
  });

  it("spreads an attribute it does not know onto the wrapper, so a caller can hook the stack itself", async () => {
    expect(attrsOf(await render(<Field label='X' data-ref='fov-field' />))).toEqual({
      "data-slot": "field-stack",
      "data-orientation": "vertical",
      "data-ref": "fov-field",
    });
  });
});

describe("Field — the caption names the one control it wraps", () => {
  it("links a Select's caption through the id its field descriptor derives", async () => {
    const html = await render(
      <Field label='Theme'>
        <Select icon={icon} field={{ name: "theme" }}>
          <Select.Option value='dark'>Dark</Select.Option>
        </Select>
      </Field>,
    );

    expect([attrOf(html, "id", CAPTION), attrOf(html, "aria-labelledby", 'data-slot="select"'), attrOf(html, "id", 'data-slot="select"')]).toEqual([
      "field-theme-label",
      "field-theme-label",
      "field-theme",
    ]);
  });

  it("links a Slider's caption through the control's own id", async () => {
    const html = await render(
      <Field label='Volume'>
        <Slider id='volume' />
      </Field>,
    );

    expect([attrOf(html, "id", CAPTION), attrOf(html, "aria-labelledby", 'data-slot="slider"')]).toEqual(["volume-label", "volume-label"]);
  });

  it("links a bare Switch's caption to the switch input, the element that takes the role", async () => {
    const html = await render(
      <Field label='Alerts'>
        <Switch field={{ name: "alerts" }} />
      </Field>,
    );

    expect([attrOf(html, "id", CAPTION), attrOf(html, "aria-labelledby", 'data-slot="switch-input"')]).toEqual([
      "field-alerts-label",
      "field-alerts-label",
    ]);
  });

  it("leaves a control that names itself with aria-label alone, and gives the caption no id", async () => {
    const html = await render(
      <Field label='Volume'>
        <Slider id='volume' aria-label='Volume' />
      </Field>,
    );

    expect([attrsOf(html, CAPTION), attrsOf(html, 'data-slot="slider"')]).toEqual([
      { "data-slot": "field-stack-label" },
      { "data-slot": "slider", type: "range", "data-size": "md", id: "volume", "aria-label": "Volume" },
    ]);
  });

  it("keeps a caller's own aria-labelledby rather than replacing it", async () => {
    const html = await render(
      <Field label='Volume'>
        <Slider id='volume' aria-labelledby='mine' />
      </Field>,
    );

    expect([attrsOf(html, CAPTION), attrsOf(html, 'data-slot="slider"')]).toEqual([
      { "data-slot": "field-stack-label" },
      { "data-slot": "slider", type: "range", "data-size": "md", id: "volume", "aria-labelledby": "mine" },
    ]);
  });

  it("wires nothing for a field name that cannot be an id token", async () => {
    const html = await render(
      <Field label='Name'>
        <Switch field={{ name: "first name" }} />
      </Field>,
    );

    expect([attrsOf(html, CAPTION), attrsOf(html, 'data-slot="switch-input"')]).toEqual([
      { "data-slot": "field-stack-label" },
      { "data-slot": "switch-input", type: "checkbox", role: "switch", name: "first name" },
    ]);
  });

  it("wires nothing when it wraps two controls, since one caption cannot name both", async () => {
    const html = await render(
      <Field label='Range'>
        <Slider id='low' />
        <Slider id='high' />
      </Field>,
    );

    expect([attrsOf(html, CAPTION), [...html.matchAll(/\saria-labelledby=/g)].length]).toEqual([{ "data-slot": "field-stack-label" }, 0]);
  });
});
