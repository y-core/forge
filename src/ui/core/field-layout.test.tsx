/** @jsxImportSource @y-core/forge */
import { describe, expect, it } from "bun:test";
import { renderToString } from "hono/jsx/dom/server";
import { FieldContent, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "./field-layout";

describe("FieldSet", () => {
  it("renders a fieldset element with data-slot='field-set'", () => {
    const html = renderToString(<FieldSet>child</FieldSet>);
    expect(html).toContain("<fieldset");
    expect(html).toContain('data-slot="field-set"');
  });

  it("includes flex flex-col gap-6 in the class", () => {
    const html = renderToString(<FieldSet>child</FieldSet>);
    expect(html).toContain("flex");
    expect(html).toContain("flex-col");
    expect(html).toContain("gap-6");
  });

  it("renders children inside the fieldset", () => {
    const html = renderToString(<FieldSet><span>inner</span></FieldSet>);
    expect(html).toContain("<span>inner</span>");
  });

  it("merges a custom class with the default classes", () => {
    const html = renderToString(<FieldSet class="custom-class">child</FieldSet>);
    expect(html).toContain("custom-class");
    expect(html).toContain("flex-col");
  });
});

describe("FieldLegend", () => {
  it("renders a legend element with data-slot='field-legend'", () => {
    const html = renderToString(<FieldLegend>Legend text</FieldLegend>);
    expect(html).toContain("<legend");
    expect(html).toContain('data-slot="field-legend"');
  });

  it("defaults to variant='legend' and includes data-variant='legend'", () => {
    const html = renderToString(<FieldLegend>Legend text</FieldLegend>);
    expect(html).toContain('data-variant="legend"');
  });

  it("default legend variant includes text-base class", () => {
    const html = renderToString(<FieldLegend>Legend text</FieldLegend>);
    expect(html).toContain("text-base");
  });

  it("variant='label' sets data-variant='label'", () => {
    const html = renderToString(<FieldLegend variant="label">Label text</FieldLegend>);
    expect(html).toContain('data-variant="label"');
  });

  it("variant='label' includes text-sm class instead of text-base", () => {
    const html = renderToString(<FieldLegend variant="label">Label text</FieldLegend>);
    expect(html).toContain("text-sm");
    expect(html).not.toContain("text-base");
  });

  it("renders children inside the legend", () => {
    const html = renderToString(<FieldLegend>My legend</FieldLegend>);
    expect(html).toContain("My legend");
  });
});

describe("FieldGroup", () => {
  it("renders a div element with data-slot='field-group'", () => {
    const html = renderToString(<FieldGroup>child</FieldGroup>);
    expect(html).toContain("<div");
    expect(html).toContain('data-slot="field-group"');
  });

  it("includes @container/field-group in the class", () => {
    const html = renderToString(<FieldGroup>child</FieldGroup>);
    expect(html).toContain("@container/field-group");
  });

  it("renders children inside the div", () => {
    const html = renderToString(<FieldGroup><span>inner</span></FieldGroup>);
    expect(html).toContain("<span>inner</span>");
  });
});

describe("FieldContent", () => {
  it("renders a div element with data-slot='field-content'", () => {
    const html = renderToString(<FieldContent>child</FieldContent>);
    expect(html).toContain("<div");
    expect(html).toContain('data-slot="field-content"');
  });

  it("includes flex-1 in the class", () => {
    const html = renderToString(<FieldContent>child</FieldContent>);
    expect(html).toContain("flex-1");
  });

  it("renders children inside the div", () => {
    const html = renderToString(<FieldContent><p>content</p></FieldContent>);
    expect(html).toContain("<p>content</p>");
  });
});

describe("FieldTitle", () => {
  it("renders a div element with data-slot='field-title'", () => {
    const html = renderToString(<FieldTitle>Title</FieldTitle>);
    expect(html).toContain("<div");
    expect(html).toContain('data-slot="field-title"');
  });

  it("renders children inside the div", () => {
    const html = renderToString(<FieldTitle>My Title</FieldTitle>);
    expect(html).toContain("My Title");
  });
});

describe("FieldSeparator", () => {
  it("renders with data-slot='field-separator'", () => {
    const html = renderToString(<FieldSeparator />);
    expect(html).toContain('data-slot="field-separator"');
  });

  it("does NOT render data-content attribute when no children are provided", () => {
    const html = renderToString(<FieldSeparator />);
    expect(html).not.toContain("data-content");
  });

  it("renders data-content='true' when children are provided", () => {
    const html = renderToString(<FieldSeparator>or</FieldSeparator>);
    expect(html).toContain('data-content="true"');
  });

  it("renders child text inside the separator when children are provided", () => {
    const html = renderToString(<FieldSeparator>or</FieldSeparator>);
    expect(html).toContain("or");
  });

  it("includes the separator span slot when children are present", () => {
    const html = renderToString(<FieldSeparator>and</FieldSeparator>);
    expect(html).toContain('data-slot="field-separator-content"');
  });

  it("does not render the content span when no children are given", () => {
    const html = renderToString(<FieldSeparator />);
    expect(html).not.toContain('data-slot="field-separator-content"');
  });
});
