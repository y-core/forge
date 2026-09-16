import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Input } from "./input";
import { attrOf, attrsOf, classesOf, variantClasses } from "./test-support";

const SIZE_CLASSES = [
  { size: "sm", added: ["h-control-sm"], dropped: ["h-control-md"] },
  { size: "lg", added: ["h-control-lg", "text-base"], dropped: ["h-control-md", "text-sm"] },
] as const;

const PAINTED = [
  { format: "#### #### #### ####", value: "4111111111111111", expected: "4111 1111 1111 1111" },
  { format: "##/##", value: 1226, expected: "12/26" },
] as const;

describe("Input", () => {
  it("renders the whole control exactly, a template of HTML-significant characters escaped", async () => {
    expect(await render(<Input format='<#&#>' />)).toBe(
      '<input data-slot="input" data-scope="input-format" data-format="&lt;#&amp;#&gt;" data-size="md"' +
        ' class="state-busy state-disabled state-invalid field-chrome focus-ring h-control-md text-sm">',
    );
  });

  it("carries only the slot and the size a stylesheet keys on when the caller sets nothing", async () => {
    expect(attrsOf(await render(<Input />))).toEqual({ "data-slot": "input", "data-size": "md" });
  });

  it("forwards every native attribute the caller set, a boolean one bare", async () => {
    expect(
      attrsOf(
        await render(
          <Input
            id='email'
            name='email'
            type='email'
            placeholder='Enter email'
            required
            disabled
            aria-describedby='help-text'
            aria-invalid='true'
          />,
        ),
      ),
    ).toEqual({
      "data-slot": "input",
      "data-size": "md",
      id: "email",
      name: "email",
      type: "email",
      placeholder: "Enter email",
      required: "",
      disabled: "",
      "aria-describedby": "help-text",
      "aria-invalid": "true",
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Input class='my-input' />)).at(-1)).toBe("my-input");
  });
});

describe("Input — format", () => {
  it("stamps the scope its controller resumes from and the template, and never a format attribute", async () => {
    expect(attrsOf(await render(<Input format='#### ####' />))).toEqual({
      "data-slot": "input",
      "data-scope": "input-format",
      "data-format": "#### ####",
      "data-size": "md",
    });
  });

  it("emits neither attribute for an empty template, which is the unformatted render", async () => {
    expect(attrsOf(await render(<Input format='' />))).toEqual({ "data-slot": "input", "data-size": "md" });
  });

  it("paints the value through the template on the server, so the no-JS render already reads grouped", async () => {
    for (const { format, value, expected } of PAINTED) {
      expect(attrOf(await render(<Input format={format} value={value} />), "value")).toBe(expected);
    }
  });

  it("repaints an already formatted value to itself rather than accumulating separators", async () => {
    expect(attrOf(await render(<Input format='#### #### #### ####' value='4111 1111 1111 1111' />), "value")).toBe("4111 1111 1111 1111");
  });

  it("emits no value at all when the caller passed none", async () => {
    expect(attrsOf(await render(<Input format='##/##' name='expiry' />))).toEqual({
      "data-slot": "input",
      "data-scope": "input-format",
      "data-format": "##/##",
      "data-size": "md",
      name: "expiry",
    });
  });

  it("lets a caller's own scope and template win the spread, which is the forwarding contract", async () => {
    expect(attrOf(await render(<Input format='##/##' data-scope='mine' />), "data-scope")).toBe("mine");
    expect(attrOf(await render(<Input format='##/##' data-format='##-##' />), "data-format")).toBe("##-##");
  });
});

describe("Input — size, invalid and busy", () => {
  it("names its size on the attribute a caller and a stylesheet both read", async () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(attrOf(await render(<Input size={size} />), "data-size")).toBe(size);
    }
  });

  it("swaps the control height for the size it was given rather than stacking a second one", async () => {
    const md = await render(<Input />);

    for (const { size, added, dropped } of SIZE_CLASSES) {
      expect(variantClasses(await render(<Input size={size} />), md)).toEqual({ added, dropped });
    }
  });

  it("stamps data-invalid beside the aria attribute, so the stylesheet and the reader agree", async () => {
    expect(attrsOf(await render(<Input invalid />))).toEqual({
      "data-slot": "input",
      "data-size": "md",
      "data-invalid": "",
      "aria-invalid": "true",
    });
  });

  it("stamps data-busy beside the aria attribute while it waits", async () => {
    expect(attrsOf(await render(<Input busy />))).toEqual({ "data-slot": "input", "data-size": "md", "data-busy": "", "aria-busy": "true" });
  });

  it("the explicit invalid boolean wins over a descriptor that says otherwise", async () => {
    expect(attrsOf(await render(<Input field={{ name: "email" }} invalid />))).toEqual({
      "data-slot": "input",
      "data-size": "md",
      id: "field-email",
      name: "email",
      "aria-invalid": "true",
      "data-invalid": "",
    });
  });

  // `state-invalid` sets `border-color` *and* `--tw-ring-color`, so without a group key of its own
  // it shares `ring-*`'s slot and a caller's ring deletes it.
  it("keeps state-invalid when the caller supplies a ring of their own", async () => {
    expect(variantClasses(await render(<Input class='ring-primary' />), await render(<Input />))).toEqual({ added: ["ring-primary"], dropped: [] });
  });
});
