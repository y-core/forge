import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { FormField } from "./field-layout";
import { createIcon } from "./icon";
import { Select } from "./select";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });
const optionsOf = (html: string) => [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((match) => match[1]);

describe("Select", () => {
  it("renders the whole control exactly — wrapper, select, and a chevron drawn from the sprite", async () => {
    expect(
      await render(
        <Select icon={icon}>
          <Select.Option value='a'>Option A</Select.Option>
        </Select>,
      ),
    ).toBe(
      '<div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50">' +
        '<select data-slot="select" data-size="md" class="state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring' +
        ' h-control-md text-sm"><option data-slot="select-option" value="a">Option A</option></select>' +
        '<span aria-hidden="true" data-slot="select-icon" class="pointer-events-none absolute inset-y-0 end-3 flex items-center' +
        ' text-muted-foreground"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"' +
        ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<use href="/sprite.svg#icon-chevron-down"></use></svg></span></div>',
    );
  });

  it("renders every child option in the order it was given", async () => {
    expect(
      optionsOf(
        await render(
          <Select icon={icon}>
            <Select.Option value='a'>Option A</Select.Option>
            <Select.Option value='b'>Option B</Select.Option>
          </Select>,
        ),
      ),
    ).toEqual(["Option A", "Option B"]);
  });

  it("passes native attributes through to the select and the selected option, not to the wrapper", async () => {
    const html = await render(
      <Select icon={icon} id='my-select' name='choice' required value='b'>
        <Select.Option value='a'>A</Select.Option>
        <Select.Option value='b' selected>
          B
        </Select.Option>
      </Select>,
    );

    expect(attrsOf(html, 'data-slot="select"')).toEqual({
      "data-slot": "select",
      "data-size": "md",
      id: "my-select",
      name: "choice",
      required: "",
      value: "b",
    });
    expect(attrsOf(html.slice(html.lastIndexOf("<option")))).toEqual({ "data-slot": "select-option", value: "b", selected: "" });
    expect(attrsOf(html, 'data-slot="select-wrapper"')).toEqual({ "data-slot": "select-wrapper" });
  });

  it("wires the label's for to the id the field descriptor derived, so clicking the label focuses this select", async () => {
    const html = await render(
      <FormField name='choice'>
        <FormField.Label name='choice'>Choice</FormField.Label>
        <FormField.Content>
          <Select icon={icon} field={{ name: "choice" }}>
            <Select.Option value='a'>A</Select.Option>
          </Select>
        </FormField.Content>
      </FormField>,
    );

    expect(attrOf(html, "for", 'data-slot="field-label"')).toBe("field-choice");
    expect(attrOf(html, "id", 'data-slot="select"')).toBe("field-choice");
    expect(attrOf(html, "name", 'data-slot="select"')).toBe("choice");
  });

  it("dresses the wrapper with the caller's class, so a ring of theirs can never evict state-invalid", async () => {
    const withRing = await render(<Select icon={icon} class='ring-primary' />);

    expect(classesOf(withRing, 'data-slot="select-wrapper"').at(-1)).toBe("ring-primary");
    expect(variantClasses(withRing, await render(<Select icon={icon} />), 'data-slot="select"')).toEqual({ added: [], dropped: [] });
  });

  it("names an optgroup with its own slot and keeps its options inside it", async () => {
    const html = await render(
      <Select icon={icon}>
        <Select.OptGroup label='Group A'>
          <Select.Option value='a'>A</Select.Option>
        </Select.OptGroup>
      </Select>,
    );

    expect(attrsOf(html, 'data-slot="select-optgroup"')).toEqual({ "data-slot": "select-optgroup", label: "Group A" });
    expect([...html.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "select-wrapper",
      "select",
      "select-optgroup",
      "select-option",
      "select-icon",
      "icon",
    ]);
  });
});

describe("Select — size, invalid and busy", () => {
  it("stamps the size it was given and swaps the control height it comes with", async () => {
    const sizes = ["sm", "lg"] as const;
    const md = await render(<Select icon={icon} />);
    const rendered = await Promise.all(sizes.map((size) => render(<Select icon={icon} size={size} />)));

    expect([attrOf(md, "data-size", 'data-slot="select"'), ...rendered.map((html) => attrOf(html, "data-size", 'data-slot="select"'))]).toEqual([
      "md",
      ...sizes,
    ]);
    expect(rendered.map((html) => variantClasses(html, md, 'data-slot="select"'))).toEqual([
      { added: ["h-control-sm"], dropped: ["h-control-md"] },
      { added: ["h-control-lg", "text-base"], dropped: ["h-control-md", "text-sm"] },
    ]);
  });

  it("stamps data-invalid beside aria-invalid, so CSS and a screen reader read the same state", async () => {
    expect(attrsOf(await render(<Select icon={icon} invalid />), 'data-slot="select"')).toEqual({
      "data-slot": "select",
      "data-size": "md",
      "data-invalid": "",
      "aria-invalid": "true",
    });
  });

  it("stamps data-busy beside aria-busy, so CSS and a screen reader read the same state", async () => {
    expect(attrsOf(await render(<Select icon={icon} busy />), 'data-slot="select"')).toEqual({
      "data-slot": "select",
      "data-size": "md",
      "data-busy": "",
      "aria-busy": "true",
    });
  });
});
