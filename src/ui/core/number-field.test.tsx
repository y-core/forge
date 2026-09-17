import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, variantClasses } from "./core.fixture";
import { NumberField } from "./number-field";

const textOf = (html: string) => html.replaceAll(/<[^>]*>/g, "");
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]);

describe("NumberField", () => {
  it("renders the whole root exactly, with spread data-* and aria-* values escaped", async () => {
    expect(await render(<NumberField data-note={`R&D's "count" <n>`} aria-label={`R&D's count`} />)).toBe(
      '<div data-slot="number-field" data-scope="number-field" class="inline-flex items-center gap-1" ' +
        'data-note="R&amp;D&#39;s &quot;count&quot; &lt;n&gt;" aria-label="R&amp;D&#39;s count"></div>',
    );
  });

  it("carries the scope the controller resumes on, under its own slot token", async () => {
    expect(attrsOf(await render(<NumberField />))).toEqual({ "data-slot": "number-field", "data-scope": "number-field" });
  });

  it("appends a caller class after its own and keeps its slot token ahead of an inherited one", async () => {
    expect(classesOf(await render(<NumberField class='w-full' />)).at(-1)).toBe("w-full");
    expect(attrOf(await render(<NumberField data-slot='quantity' />), "data-slot")).toBe("number-field quantity");
  });

  it("orders the steppers around the input they drive, in one tree", async () => {
    expect(
      slotsOf(
        await render(
          <NumberField>
            <NumberField.Decrement />
            <NumberField.Input name='count' value='1' min='0' max='10' />
            <NumberField.Increment />
          </NumberField>,
        ),
      ),
    ).toEqual(["number-field", "number-field-decrement", "number-field-input", "number-field-increment"]);
  });

  it("keeps aria-readonly off the steppers even when the input beside them is readonly", async () => {
    const html = await render(
      <NumberField>
        <NumberField.Decrement />
        <NumberField.Input name='count' value='1' readonly />
        <NumberField.Increment />
      </NumberField>,
    );

    expect(attrsOf(html, 'data-slot="number-field-input"')).toEqual({
      type: "number",
      "data-slot": "number-field-input",
      "data-size": "md",
      name: "count",
      value: "1",
      readonly: "",
    });
    expect([attrsOf(html, 'data-slot="number-field-decrement"'), attrsOf(html, 'data-slot="number-field-increment"')]).toEqual([
      { type: "button", "data-slot": "number-field-decrement", "aria-label": "Decrement" },
      { type: "button", "data-slot": "number-field-increment", "aria-label": "Increment" },
    ]);
  });
});

describe("NumberField.Input", () => {
  it("is a native number input at the md size, and claims nothing it was not given", async () => {
    expect(attrsOf(await render(<NumberField.Input />))).toEqual({ type: "number", "data-slot": "number-field-input", "data-size": "md" });
  });

  it("passes the platform's own range attributes straight through", async () => {
    expect(attrsOf(await render(<NumberField.Input name='count' value='3' min='0' max='10' step='2' required />))).toEqual({
      type: "number",
      "data-slot": "number-field-input",
      "data-size": "md",
      name: "count",
      value: "3",
      min: "0",
      max: "10",
      step: "2",
      required: "",
    });
  });

  it("lets a caller's width evict its own rather than sit beside it, and appends an inherited slot token", async () => {
    const html = await render(<NumberField.Input class='w-32' data-slot='quantity-input' />);

    expect(variantClasses(html, await render(<NumberField.Input />))).toEqual({ added: ["w-32"], dropped: ["w-20"] });
    expect(attrOf(html, "data-slot")).toBe("number-field-input quantity-input");
  });

  it("stamps the size it was given and swaps the control height it comes with", async () => {
    const sizes = ["sm", "lg"] as const;
    const md = await render(<NumberField.Input />);
    const rendered = await Promise.all(sizes.map((size) => render(<NumberField.Input size={size} />)));

    expect(rendered.map((html) => attrOf(html, "data-size"))).toEqual([...sizes]);
    expect(rendered.map((html) => variantClasses(html, md))).toEqual([
      { added: ["h-control-sm"], dropped: ["h-control-md"] },
      { added: ["h-control-lg", "text-base"], dropped: ["h-control-md", "text-sm"] },
    ]);
  });

  it("stamps data-invalid beside aria-invalid, so CSS and a screen reader read the same state", async () => {
    expect(attrsOf(await render(<NumberField.Input invalid />))).toEqual({
      type: "number",
      "data-slot": "number-field-input",
      "data-size": "md",
      "data-invalid": "",
      "aria-invalid": "true",
    });
  });

  it("stamps data-busy beside aria-busy, so CSS and a screen reader read the same state", async () => {
    expect(attrsOf(await render(<NumberField.Input busy />))).toEqual({
      type: "number",
      "data-slot": "number-field-input",
      "data-size": "md",
      "data-busy": "",
      "aria-busy": "true",
    });
  });

  it("keeps state-invalid when the caller supplies a ring, which once shared its conflict group", async () => {
    expect(variantClasses(await render(<NumberField.Input class='ring-primary' />), await render(<NumberField.Input />))).toEqual({
      added: ["ring-primary"],
      dropped: [],
    });
  });
});

describe("NumberField.Decrement", () => {
  it("defaults to a minus-sign glyph behind an explicit label, since the glyph names nothing", async () => {
    const html = await render(<NumberField.Decrement />);

    expect(attrsOf(html)).toEqual({ type: "button", "data-slot": "number-field-decrement", "aria-label": "Decrement" });
    expect(textOf(html)).toBe("−");
  });

  it("takes caller children in place of the glyph, and passes disabled through", async () => {
    const html = await render(<NumberField.Decrement disabled>Less</NumberField.Decrement>);

    expect(textOf(html)).toBe("Less");
    expect(attrsOf(html)).toEqual({ type: "button", "data-slot": "number-field-decrement", "aria-label": "Decrement", disabled: "" });
  });

  it("lets a caller replace the label in place and override the size utility it conflicts with", async () => {
    const html = await render(<NumberField.Decrement aria-label={`Fewer R&D's`} class='size-6' data-slot='quantity-down' />);

    expect(attrOf(html, "aria-label")).toBe("Fewer R&amp;D&#39;s");
    expect(attrOf(html, "data-slot")).toBe("number-field-decrement quantity-down");
    expect(variantClasses(html, await render(<NumberField.Decrement />))).toEqual({ added: ["size-6"], dropped: ["size-8"] });
  });
});

describe("NumberField.Increment", () => {
  it("defaults to a plus glyph behind an explicit label, since the glyph names nothing", async () => {
    const html = await render(<NumberField.Increment />);

    expect(attrsOf(html)).toEqual({ type: "button", "data-slot": "number-field-increment", "aria-label": "Increment" });
    expect(textOf(html)).toBe("+");
  });

  it("takes caller children in place of the glyph and escapes them", async () => {
    expect(textOf(await render(<NumberField.Increment>{`R&D's <up>`}</NumberField.Increment>))).toBe("R&amp;D&#39;s &lt;up&gt;");
  });
});
