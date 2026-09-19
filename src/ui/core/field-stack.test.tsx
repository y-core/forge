import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Field } from "./field-stack";

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
