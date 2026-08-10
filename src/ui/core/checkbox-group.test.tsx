/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { CheckboxGroup } from "./checkbox-group";

/** Every id the rendered markup declares or references, in document order. */
function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("CheckboxGroup — aria-describedby names only what renders", () => {
  it("a group with no description emits no aria-describedby at all", async () => {
    // The group used to emit `aria-describedby="field-toppings-description"` unconditionally, so a
    // group without a `Description` child pointed at nothing. A dangling IDREF is not a no-op:
    // assistive technology reports it as an error rather than ignoring it.
    expect(
      await render(
        <CheckboxGroup name='toppings'>
          <CheckboxGroup.Item name='toppings' value='cheese'>
            Cheese
          </CheckboxGroup.Item>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox" data-slot="checkbox-group-input" id="field-toppings-cheese" name="toppings" value="cheese" class="size-4 rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring">Cheese</label></fieldset>',
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
      '<fieldset data-slot="checkbox-group" aria-describedby="field-toppings-error" data-invalid="" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-toppings-error" role="alert">Pick at least one.</p></fieldset>',
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
  it("an item value containing a space still declares its id, because nothing references it", async () => {
    // Pinned deliberately rather than left to chance. The input is wrapped in its `<label>`, so no
    // `for` and no `aria-describedby` ever names this id — a declared id no IDREF resolves is inert,
    // and the `value` is caller data that must round-trip to the server verbatim. Gating it through
    // the id-token predicate would be a change to make only if something ever referenced it.
    expect(
      await render(
        <CheckboxGroup name='pets'>
          <CheckboxGroup.Item name='pets' value='a b'>
            A B
          </CheckboxGroup.Item>
        </CheckboxGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="checkbox-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox" data-slot="checkbox-group-input" id="field-pets-a b" name="pets" value="a b" class="size-4 rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring">A B</label></fieldset>',
    );
  });

  it("a group name containing a space emits no aria-describedby, and its description no id", async () => {
    // Both halves in one render: an id of `field-fav pet-description` splits into two tokens the
    // browser can resolve neither of, so the group must reference nothing and the description must
    // declare nothing. Either half alone would leave the pair able to disagree.
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

    // Two `field-toppings-cheese` inputs is the unrecorded half: a `<label for>` or a click on the
    // second one resolves to the first, so the wrong checkbox toggles.
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
    // Each id appears exactly twice at most (declaration + reference), never across groups.
    expect(new Set(ids).size).toBe(4);
  });
});
