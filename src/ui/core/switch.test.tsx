import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Switch } from "./switch";
import { attrsOf, classesOf, tagOf, variantClasses } from "./test-support";

const INPUT = 'data-slot="switch-input"';
const TRACK = 'data-slot="switch-track"';
const THUMB = 'data-slot="switch-thumb"';

const CHECKED_TRACK = "[[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&amp;]:";

describe("Switch", () => {
  it("renders the whole control exactly, the label text escaped", async () => {
    expect(await render(<Switch>{`R&D's "grid" <x>`}</Switch>)).toBe(
      '<label data-slot="switch" data-orientation="horizontal" data-label-position="after" data-size="md"' +
        ' class="state-busy inline-flex items-center gap-2 state-invalid">' +
        '<input data-slot="switch-input" type="checkbox" role="switch" class="peer sr-only">' +
        '<span data-slot="switch-track" aria-hidden="true" class="relative shrink-0 rounded-selector bg-track peer-checked:bg-primary' +
        ' peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors h-5 w-9">' +
        '<span data-slot="switch-thumb" class="absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform' +
        ` size-4 ${CHECKED_TRACK}translate-x-4 ${CHECKED_TRACK}rtl:-translate-x-4"></span></span>` +
        "R&amp;D&#39;s &quot;grid&quot; &lt;x&gt;</label>",
    );
  });

  it("is a label wrapping a native checkbox in the switch role, so the whole control is the hit target", async () => {
    const html = await render(<Switch />);

    expect(tagOf(html).startsWith("<label ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "switch", "data-orientation": "horizontal", "data-label-position": "after", "data-size": "md" });
    expect(attrsOf(html, INPUT)).toEqual({ "data-slot": "switch-input", type: "checkbox", role: "switch" });
  });

  it("hides the track and the thumb from a reader, since the input carries the whole state", async () => {
    const html = await render(<Switch />);

    expect(attrsOf(html, TRACK)).toEqual({ "data-slot": "switch-track", "aria-hidden": "true" });
    expect(attrsOf(html, THUMB)).toEqual({ "data-slot": "switch-thumb" });
  });

  it("reflects checked on the input when set, and emits nothing at all when it is not", async () => {
    expect(attrsOf(await render(<Switch checked />), INPUT)).toEqual({
      "data-slot": "switch-input",
      type: "checkbox",
      role: "switch",
      checked: "",
    });
    expect(attrsOf(await render(<Switch />), INPUT)).not.toHaveProperty("checked");
  });

  it("spreads delegation attributes onto the input, which is the element a controller listens to", async () => {
    expect(attrsOf(await render(<Switch data-on-change='toggle' data-setting='grid' data-ref='grid-switch' />), INPUT)).toEqual({
      "data-slot": "switch-input",
      type: "checkbox",
      role: "switch",
      "data-on-change": "toggle",
      "data-setting": "grid",
      "data-ref": "grid-switch",
    });
  });

  it("passes disabled through to the input, and emits nothing at all when it is not set", async () => {
    expect(attrsOf(await render(<Switch disabled />), INPUT)).toHaveProperty("disabled", "");
    expect(attrsOf(await render(<Switch />), INPUT)).not.toHaveProperty("disabled");
  });

  it("appends a caller class after its own on the wrapper, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Switch class='extra-class' />)).at(-1)).toBe("extra-class");
  });

  it("wires the input's id and name from the field descriptor, so a label and a form post both resolve", async () => {
    expect(attrsOf(await render(<Switch field={{ name: "grid" }} />), INPUT)).toEqual({
      "data-slot": "switch-input",
      type: "checkbox",
      role: "switch",
      id: "field-grid",
      name: "grid",
    });
  });

  it("points the input at its own error message when the field is invalid", async () => {
    expect(attrsOf(await render(<Switch field={{ name: "grid", invalid: true }} />), INPUT)).toEqual({
      "data-slot": "switch-input",
      type: "checkbox",
      role: "switch",
      id: "field-grid",
      name: "grid",
      "aria-describedby": "field-grid-error",
      "aria-invalid": "true",
    });
  });

  it("puts the label text after the track by default, with no reversal on the wrapper", async () => {
    const html = await render(<Switch>Snap to grid</Switch>);

    expect(html.endsWith("Snap to grid</label>")).toBe(true);
    expect(classesOf(html)).not.toContain("flex-row-reverse");
  });

  it("emits no value attribute by default, and the caller's when one is given", async () => {
    expect(attrsOf(await render(<Switch />), INPUT)).not.toHaveProperty("value");
    expect(attrsOf(await render(<Switch value='on' />), INPUT)).toHaveProperty("value", "on");
  });

  it("reverses the wrapper when the label sits before the track, and says so on the attribute", async () => {
    const html = await render(<Switch labelPlacement='before' />);

    expect(attrsOf(html)["data-label-position"]).toBe("before");
    expect(variantClasses(html, await render(<Switch />))).toEqual({ added: ["flex-row-reverse"], dropped: [] });
  });
});

describe("Switch — size, invalid and busy", () => {
  it("shrinks the track, the thumb and the thumb's travel together at the sm size", async () => {
    const html = await render(<Switch size='sm' />);

    expect(attrsOf(html)["data-size"]).toBe("sm");
    expect(variantClasses(html, await render(<Switch />), TRACK)).toEqual({ added: ["h-4", "w-7"], dropped: ["h-5", "w-9"] });
    expect(variantClasses(html, await render(<Switch />), THUMB)).toEqual({
      added: ["size-3", `${CHECKED_TRACK}translate-x-3`, `${CHECKED_TRACK}rtl:-translate-x-3`],
      dropped: ["size-4", `${CHECKED_TRACK}translate-x-4`, `${CHECKED_TRACK}rtl:-translate-x-4`],
    });
  });

  it("grows the track, the thumb and the thumb's travel together at the lg size", async () => {
    const html = await render(<Switch size='lg' />);

    expect(attrsOf(html)["data-size"]).toBe("lg");
    expect(variantClasses(html, await render(<Switch />), TRACK)).toEqual({ added: ["h-6", "w-11"], dropped: ["h-5", "w-9"] });
    expect(variantClasses(html, await render(<Switch />), THUMB)).toEqual({
      added: ["size-5", `${CHECKED_TRACK}translate-x-5`, `${CHECKED_TRACK}rtl:-translate-x-5`],
      dropped: ["size-4", `${CHECKED_TRACK}translate-x-4`, `${CHECKED_TRACK}rtl:-translate-x-4`],
    });
  });

  it("stamps data-invalid beside aria-invalid on the input, so CSS and a reader agree", async () => {
    expect(attrsOf(await render(<Switch invalid />), INPUT)).toEqual({
      "data-slot": "switch-input",
      type: "checkbox",
      role: "switch",
      "data-invalid": "",
      "aria-invalid": "true",
    });
  });

  it("stamps data-busy beside aria-busy on the input, so CSS and a reader agree", async () => {
    expect(attrsOf(await render(<Switch busy />), INPUT)).toEqual({
      "data-slot": "switch-input",
      type: "checkbox",
      role: "switch",
      "data-busy": "",
      "aria-busy": "true",
    });
  });
});
