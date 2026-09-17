import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "./core.fixture";
import { FormField } from "./field-layout";

const contentOf = (html: string): string => html.slice(tagOf(html).length, html.lastIndexOf("<"));

describe("Field.Set", () => {
  it("is a real fieldset, so the grouping survives without CSS", async () => {
    const html = await render(
      <FormField.Set>
        <span>inner</span>
      </FormField.Set>,
    );

    expect(tagOf(html).startsWith("<fieldset ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "field-set" });
    expect(contentOf(html)).toBe("<span>inner</span>");
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<FormField.Set class='custom-class'>child</FormField.Set>)).at(-1)).toBe("custom-class");
  });
});

describe("Field.Legend", () => {
  it("is a real legend naming its group, wearing the legend type scale by default", async () => {
    const html = await render(<FormField.Legend>Legend text</FormField.Legend>);

    expect(tagOf(html).startsWith("<legend ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "field-legend", "data-as": "legend" });
    expect(contentOf(html)).toBe("Legend text");
  });

  it("drops to the label type scale when asked to read as a label, and says so on the attribute", async () => {
    const html = await render(<FormField.Legend as='label'>Label text</FormField.Legend>);

    expect(attrOf(html, "data-as")).toBe("label");
    expect(variantClasses(html, await render(<FormField.Legend>Legend text</FormField.Legend>))).toEqual({
      added: ["text-sm"],
      dropped: ["text-base"],
    });
  });
});

describe("Field.Group", () => {
  it("wraps its children in a container-query scope of its own", async () => {
    const html = await render(
      <FormField.Group>
        <span>inner</span>
      </FormField.Group>,
    );

    expect(attrsOf(html)).toEqual({ "data-slot": "field-group" });
    expect(classesOf(html).filter((token) => token.startsWith("@container"))).toEqual(["@container/field-group"]);
    expect(contentOf(html)).toBe("<span>inner</span>");
  });
});

describe("Field.Content", () => {
  it("carries the children it was given under its own slot token", async () => {
    const html = await render(
      <FormField.Content>
        <p>content</p>
      </FormField.Content>,
    );

    expect(attrsOf(html)).toEqual({ "data-slot": "field-content" });
    expect(contentOf(html)).toBe("<p>content</p>");
  });
});

describe("Field.Title", () => {
  it("carries the title it was given under its own slot token", async () => {
    const html = await render(<FormField.Title>My Title</FormField.Title>);

    expect(attrsOf(html)).toEqual({ "data-slot": "field-title" });
    expect(contentOf(html)).toBe("My Title");
  });
});

describe("Field.Separator", () => {
  it("renders the whole labelled rule exactly, the caption escaped", async () => {
    expect(await render(<FormField.Separator>{`R&D's "or" <x>`}</FormField.Separator>)).toBe(
      '<div data-content="true" data-slot="field-separator" class="relative h-5 text-sm">' +
        '<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border absolute inset-0 top-1/2">' +
        '<span data-slot="field-separator-content" class="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">' +
        "R&amp;D&#39;s &quot;or&quot; &lt;x&gt;</span></div>",
    );
  });

  it("marks itself as captioned only when it has a caption, so the bare rule needs no cut-out", async () => {
    const html = await render(<FormField.Separator />);

    expect(attrsOf(html)).toEqual({ "data-slot": "field-separator" });
    expect(html).not.toContain("field-separator-content");
  });
});
