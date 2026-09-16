import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { FileInput } from "./file-input";
import { attrsOf, classesOf, variantClasses } from "./test-support";

describe("FileInput", () => {
  it("renders the whole control exactly when it is invalid and busy, caller class merged last", async () => {
    expect(await render(<FileInput invalid busy class='p-99' data-note='a&b' />)).toBe(
      '<input type="file" data-slot="file-input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring' +
        ' file:me-3 file:h-full file:border-0 file:bg-transparent file:font-medium file:text-foreground h-control-md text-sm p-99"' +
        ' data-note="a&amp;b" data-invalid="" data-busy="" aria-invalid="true" aria-busy="true">',
    );
  });

  it("stamps its type and size as attributes, so a variant is readable without reading a class list", async () => {
    expect(attrsOf(await render(<FileInput />))).toEqual({ type: "file", "data-slot": "file-input", "data-size": "md" });
  });

  it("names the size it was given on the attribute a stylesheet and a reader both key on", async () => {
    expect(attrsOf(await render(<FileInput size='lg' />))).toEqual({ type: "file", "data-slot": "file-input", "data-size": "lg" });
  });

  it("exchanges the control height and type step at lg rather than stacking a second pair", async () => {
    expect(variantClasses(await render(<FileInput size='lg' />), await render(<FileInput />))).toEqual({
      added: ["h-control-lg", "text-base"],
      dropped: ["h-control-md", "text-sm"],
    });
  });

  it("derives id, name, and aria-describedby from a field descriptor, so a caller wires none of them", async () => {
    expect(attrsOf(await render(<FileInput field={{ name: "avatar", description: true, invalid: true }} />))).toEqual({
      type: "file",
      "data-slot": "file-input",
      "data-size": "md",
      id: "field-avatar",
      name: "avatar",
      "aria-describedby": "field-avatar-description field-avatar-error",
      "aria-invalid": "true",
    });
  });

  it("passes accept, multiple, and required through to the native control", async () => {
    expect(attrsOf(await render(<FileInput accept='image/png' multiple required />))).toEqual({
      type: "file",
      "data-slot": "file-input",
      "data-size": "md",
      accept: "image/png",
      multiple: "",
      required: "",
    });
  });

  it("keeps state-invalid when a caller's own ring would once have evicted it, leaving a control that announced aria-invalid while looking valid", async () => {
    expect(variantClasses(await render(<FileInput class='ring-primary' />), await render(<FileInput />))).toEqual({
      added: ["ring-primary"],
      dropped: [],
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<FileInput class='ring-primary' />)).at(-1)).toBe("ring-primary");
  });
});
