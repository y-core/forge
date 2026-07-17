import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { FormField } from "./field-layout";

describe("Field.Set", () => {
  it("renders a fieldset element with data-slot='field-set'", async () => {
    expect(String(await renderToString(<FormField.Set>child</FormField.Set>))).toBe(
      '<fieldset data-slot="field-set" class="flex flex-col gap-6">child</fieldset>',
    );
  });

  it("renders children inside the fieldset", async () => {
    expect(
      String(
        await renderToString(
          <FormField.Set>
            <span>inner</span>
          </FormField.Set>,
        ),
      ),
    ).toBe('<fieldset data-slot="field-set" class="flex flex-col gap-6"><span>inner</span></fieldset>');
  });

  it("merges a custom class with the default classes", async () => {
    expect(String(await renderToString(<FormField.Set class='custom-class'>child</FormField.Set>))).toBe(
      '<fieldset data-slot="field-set" class="flex flex-col gap-6 custom-class">child</fieldset>',
    );
  });
});

describe("Field.Legend", () => {
  it("renders a legend element with data-slot='field-legend' and default variant", async () => {
    expect(String(await renderToString(<FormField.Legend>Legend text</FormField.Legend>))).toBe(
      '<legend data-slot="field-legend" data-variant="legend" class="mb-3 font-medium text-base text-foreground">Legend text</legend>',
    );
  });

  it("variant='label' sets data-variant='label' and uses text-sm", async () => {
    expect(String(await renderToString(<FormField.Legend variant='label'>Label text</FormField.Legend>))).toBe(
      '<legend data-slot="field-legend" data-variant="label" class="mb-3 font-medium text-sm text-foreground">Label text</legend>',
    );
  });

  it("renders children inside the legend", async () => {
    expect(String(await renderToString(<FormField.Legend>My legend</FormField.Legend>))).toBe(
      '<legend data-slot="field-legend" data-variant="legend" class="mb-3 font-medium text-base text-foreground">My legend</legend>',
    );
  });
});

describe("Field.Group", () => {
  it("renders a div element with data-slot='field-group'", async () => {
    expect(String(await renderToString(<FormField.Group>child</FormField.Group>))).toBe(
      '<div data-slot="field-group" class="@container/field-group flex w-full flex-col gap-6">child</div>',
    );
  });

  it("renders children inside the div", async () => {
    expect(
      String(
        await renderToString(
          <FormField.Group>
            <span>inner</span>
          </FormField.Group>,
        ),
      ),
    ).toBe('<div data-slot="field-group" class="@container/field-group flex w-full flex-col gap-6"><span>inner</span></div>');
  });
});

describe("Field.Content", () => {
  it("renders a div element with data-slot='field-content'", async () => {
    expect(String(await renderToString(<FormField.Content>child</FormField.Content>))).toBe(
      '<div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug">child</div>',
    );
  });

  it("renders children inside the div", async () => {
    expect(
      String(
        await renderToString(
          <FormField.Content>
            <p>content</p>
          </FormField.Content>,
        ),
      ),
    ).toBe('<div data-slot="field-content" class="flex flex-1 flex-col gap-1.5 leading-snug"><p>content</p></div>');
  });
});

describe("Field.Title", () => {
  it("renders a div element with data-slot='field-title'", async () => {
    expect(String(await renderToString(<FormField.Title>Title</FormField.Title>))).toBe(
      '<div data-slot="field-title" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">Title</div>',
    );
  });

  it("renders children inside the div", async () => {
    expect(String(await renderToString(<FormField.Title>My Title</FormField.Title>))).toBe(
      '<div data-slot="field-title" class="flex w-fit items-center gap-2 text-sm font-medium leading-snug text-foreground group-data-[disabled=true]/field:opacity-50">My Title</div>',
    );
  });
});

describe("Field.Separator", () => {
  it("renders without content span or data-content attribute when no children are provided", async () => {
    expect(String(await renderToString(<FormField.Separator />))).toBe(
      '<div data-slot="field-separator" class="relative h-5 text-sm"><hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border absolute inset-0 top-1/2"></div>',
    );
  });

  it("renders data-content='true' and the content span when children are provided", async () => {
    expect(String(await renderToString(<FormField.Separator>or</FormField.Separator>))).toBe(
      '<div data-content="true" data-slot="field-separator" class="relative h-5 text-sm"><hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border absolute inset-0 top-1/2"><span data-slot="field-separator-content" class="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">or</span></div>',
    );
  });

  it("includes the separator content span with child text", async () => {
    expect(String(await renderToString(<FormField.Separator>and</FormField.Separator>))).toBe(
      '<div data-content="true" data-slot="field-separator" class="relative h-5 text-sm"><hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border absolute inset-0 top-1/2"><span data-slot="field-separator-content" class="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">and</span></div>',
    );
  });
});
