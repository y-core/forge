/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { Field } from "./field-layout";

describe("Field.Set", () => {
  it("renders a fieldset element with data-slot='field-set'", () => {
    const html = renderToString(<Field.Set>child</Field.Set>);
    expect(html).toContain("<fieldset");
    expect(html).toContain('data-slot="field-set"');
  });

  it("includes flex flex-col gap-6 in the class", () => {
    const html = renderToString(<Field.Set>child</Field.Set>);
    expect(html).toContain("flex");
    expect(html).toContain("flex-col");
    expect(html).toContain("gap-6");
  });

  it("renders children inside the fieldset", () => {
    const html = renderToString(<Field.Set><span>inner</span></Field.Set>);
    expect(html).toContain("<span>inner</span>");
  });

  it("merges a custom class with the default classes", () => {
    const html = renderToString(<Field.Set class="custom-class">child</Field.Set>);
    expect(html).toContain("custom-class");
    expect(html).toContain("flex-col");
  });
});

describe("Field.Legend", () => {
  it("renders a legend element with data-slot='field-legend'", () => {
    const html = renderToString(<Field.Legend>Legend text</Field.Legend>);
    expect(html).toContain("<legend");
    expect(html).toContain('data-slot="field-legend"');
  });

  it("defaults to variant='legend' and includes data-variant='legend'", () => {
    const html = renderToString(<Field.Legend>Legend text</Field.Legend>);
    expect(html).toContain('data-variant="legend"');
  });

  it("default legend variant includes text-base class", () => {
    const html = renderToString(<Field.Legend>Legend text</Field.Legend>);
    expect(html).toContain("text-base");
  });

  it("variant='label' sets data-variant='label'", () => {
    const html = renderToString(<Field.Legend variant="label">Label text</Field.Legend>);
    expect(html).toContain('data-variant="label"');
  });

  it("variant='label' includes text-sm class instead of text-base", () => {
    const html = renderToString(<Field.Legend variant="label">Label text</Field.Legend>);
    expect(html).toContain("text-sm");
    expect(html).not.toContain("text-base");
  });

  it("renders children inside the legend", () => {
    const html = renderToString(<Field.Legend>My legend</Field.Legend>);
    expect(html).toContain("My legend");
  });
});

describe("Field.Group", () => {
  it("renders a div element with data-slot='field-group'", () => {
    const html = renderToString(<Field.Group>child</Field.Group>);
    expect(html).toContain("<div");
    expect(html).toContain('data-slot="field-group"');
  });

  it("includes @container/field-group in the class", () => {
    const html = renderToString(<Field.Group>child</Field.Group>);
    expect(html).toContain("@container/field-group");
  });

  it("renders children inside the div", () => {
    const html = renderToString(<Field.Group><span>inner</span></Field.Group>);
    expect(html).toContain("<span>inner</span>");
  });
});

describe("Field.Content", () => {
  it("renders a div element with data-slot='field-content'", () => {
    const html = renderToString(<Field.Content>child</Field.Content>);
    expect(html).toContain("<div");
    expect(html).toContain('data-slot="field-content"');
  });

  it("includes flex-1 in the class", () => {
    const html = renderToString(<Field.Content>child</Field.Content>);
    expect(html).toContain("flex-1");
  });

  it("renders children inside the div", () => {
    const html = renderToString(<Field.Content><p>content</p></Field.Content>);
    expect(html).toContain("<p>content</p>");
  });
});

describe("Field.Title", () => {
  it("renders a div element with data-slot='field-title'", () => {
    const html = renderToString(<Field.Title>Title</Field.Title>);
    expect(html).toContain("<div");
    expect(html).toContain('data-slot="field-title"');
  });

  it("renders children inside the div", () => {
    const html = renderToString(<Field.Title>My Title</Field.Title>);
    expect(html).toContain("My Title");
  });
});

describe("Field.Separator", () => {
  it("renders with data-slot='field-separator'", () => {
    const html = renderToString(<Field.Separator />);
    expect(html).toContain('data-slot="field-separator"');
  });

  it("does NOT render data-content attribute when no children are provided", () => {
    const html = renderToString(<Field.Separator />);
    expect(html).not.toContain("data-content");
  });

  it("renders data-content='true' when children are provided", () => {
    const html = renderToString(<Field.Separator>or</Field.Separator>);
    expect(html).toContain('data-content="true"');
  });

  it("renders child text inside the separator when children are provided", () => {
    const html = renderToString(<Field.Separator>or</Field.Separator>);
    expect(html).toContain("or");
  });

  it("includes the separator span slot when children are present", () => {
    const html = renderToString(<Field.Separator>and</Field.Separator>);
    expect(html).toContain('data-slot="field-separator-content"');
  });

  it("does not render the content span when no children are given", () => {
    const html = renderToString(<Field.Separator />);
    expect(html).not.toContain('data-slot="field-separator-content"');
  });
});
