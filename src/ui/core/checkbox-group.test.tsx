/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { CheckboxGroup } from "./checkbox-group";

function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("CheckboxGroup — aria-describedby names only what renders", () => {
  it("a group with no description emits no aria-describedby at all", async () => {
    expect(
      await render(
        <CheckboxGroup name='toppings'>
          <CheckboxGroup.Item name='toppings' value='cheese'>
            Cheese
          </CheckboxGroup.Item>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox" data-slot="checkbox-group-input" id="field-toppings-cheese" name="toppings" value="cheese" class="size-4 shrink-0 appearance-none rounded border border-input bg-background checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">Cheese</label></fieldset>',
    );
  });

  it("a declared description wires the IDREF, and the description element carries that id", async () => {
    expect(
      await render(
        <CheckboxGroup name='toppings' description>
          <CheckboxGroup.Description name='toppings'>Pick as many as you like.</CheckboxGroup.Description>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" aria-describedby="field-toppings-description" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-toppings-description">Pick as many as you like.</p></fieldset>',
    );
  });

  it("an invalid group with no description names the error alone", async () => {
    expect(
      await render(
        <CheckboxGroup name='toppings' invalid>
          <CheckboxGroup.Error name='toppings'>Pick at least one.</CheckboxGroup.Error>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" aria-describedby="field-toppings-error" data-invalid="" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><p data-slot="field-error" class="text-sm font-normal text-destructive" id="field-toppings-error" role="alert">Pick at least one.</p></fieldset>',
    );
  });

  it("an invalid group with a description names both, description first", async () => {
    const html = await render(
      <CheckboxGroup name='toppings' description invalid>
        <CheckboxGroup.Description name='toppings'>Pick as many as you like.</CheckboxGroup.Description>
        <CheckboxGroup.Error name='toppings'>Pick at least one.</CheckboxGroup.Error>
      </CheckboxGroup>,
    );

    expect(html).toContain('aria-describedby="field-toppings-description field-toppings-error"');
    const ids = idsAndRefs(html);
    expect(ids).toEqual(["field-toppings-description", "field-toppings-error", "field-toppings-description", "field-toppings-error"]);
  });
});

describe("CheckboxGroup — a name must be a single id token", () => {
  it("an item value containing a space declares no id, while the value itself passes through verbatim", async () => {
    expect(
      await render(
        <CheckboxGroup name='pets'>
          <CheckboxGroup.Item name='pets' value='a b'>
            A B
          </CheckboxGroup.Item>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox" data-slot="checkbox-group-input" name="pets" value="a b" class="size-4 shrink-0 appearance-none rounded border border-input bg-background checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">A B</label></fieldset>',
    );
  });

  it("a group name containing a space suppresses its items' ids too", async () => {
    const html = await render(
      <CheckboxGroup name='fav pet'>
        <CheckboxGroup.Item name='fav pet' value='cat'>
          Cat
        </CheckboxGroup.Item>
      </CheckboxGroup>,
    );

    expect(html).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox" data-slot="checkbox-group-input" name="fav pet" value="cat" class="size-4 shrink-0 appearance-none rounded border border-input bg-background checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">Cat</label></fieldset>',
    );
    expect(idsAndRefs(html)).toEqual([]);
  });

  it("a scope containing a space suppresses the item id rather than emitting a two-token one", async () => {
    const html = await render(
      <CheckboxGroup name='toppings' scope='a b'>
        <CheckboxGroup.Item name='toppings' scope='a b' value='cheese'>
          Cheese
        </CheckboxGroup.Item>
      </CheckboxGroup>,
    );

    expect(html).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox" data-slot="checkbox-group-input" name="toppings" value="cheese" class="size-4 shrink-0 appearance-none rounded border border-input bg-background checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">Cheese</label></fieldset>',
    );
    expect(idsAndRefs(html)).toEqual([]);
  });

  it("a tab or newline in the value suppresses the id just as a space does", async () => {
    const html = await render(
      <CheckboxGroup name='pets'>
        <CheckboxGroup.Item name='pets' value={"a\tb"}>
          A B
        </CheckboxGroup.Item>
        <CheckboxGroup.Item name='pets' value={"c\nd"}>
          C D
        </CheckboxGroup.Item>
      </CheckboxGroup>,
    );

    expect(idsAndRefs(html)).toEqual([]);
  });

  it("a group name containing a space emits no aria-describedby, and its description no id", async () => {
    expect(
      await render(
        <CheckboxGroup name='fav pet' description>
          <CheckboxGroup.Description name='fav pet'>Pick one.</CheckboxGroup.Description>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground">Pick one.</p></fieldset>',
    );
  });
});

describe("CheckboxGroup — two same-named groups on one page", () => {
  const twoGroups = (scoped: boolean) => {
    const group = (scope: string) => {
      const naming = scoped ? { name: "toppings", scope } : { name: "toppings" };
      return (
        <CheckboxGroup {...naming} description>
          <CheckboxGroup.Description {...naming}>Pick as many as you like.</CheckboxGroup.Description>
          <CheckboxGroup.Item {...naming} value='cheese'>
            Cheese
          </CheckboxGroup.Item>
        </CheckboxGroup>
      );
    };
    return (
      <div>
        {group("lunch")}
        {group("dinner")}
      </div>
    );
  };

  it("collides on every id — item as well as description — without a scope", async () => {
    const ids = idsAndRefs(await render(twoGroups(false)));

    expect(ids).toEqual([
      "field-toppings-description",
      "field-toppings-description",
      "field-toppings-cheese",
      "field-toppings-description",
      "field-toppings-description",
      "field-toppings-cheese",
    ]);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps every id distinct once each group carries a scope", async () => {
    const ids = idsAndRefs(await render(twoGroups(true)));

    expect(ids).toEqual([
      "field-lunch-toppings-description",
      "field-lunch-toppings-description",
      "field-lunch-toppings-cheese",
      "field-dinner-toppings-description",
      "field-dinner-toppings-description",
      "field-dinner-toppings-cheese",
    ]);
    expect(new Set(ids).size).toBe(4);
  });
});
