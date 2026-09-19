/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { CheckboxGroup } from "./checkbox-group";

const INPUT = 'data-slot="checkbox-group-input"';
const DESCRIPTION = 'data-slot="field-description"';
const ERROR = 'data-slot="field-error"';

const ROOT = { "data-slot": "checkbox-group", "data-size": "md", "data-orientation": "vertical" };
const ITEM = { type: "checkbox", "data-slot": "checkbox-group-input" };

function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("CheckboxGroup", () => {
  it("renders the whole item exactly, its label text and a forwarded value escaped", async () => {
    expect(
      await render(
        <CheckboxGroup.Item name='toppings' value='cheese' data-note="R&D's">
          {`Cheese & "extra" <x>`}
        </CheckboxGroup.Item>,
      ),
    ).toBe(
      '<label data-slot="checkbox-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="checkbox"' +
        ' data-slot="checkbox-group-input" id="field-toppings-cheese" name="toppings" value="cheese" class="state-busy state-disabled' +
        ' shrink-0 appearance-none rounded border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4"' +
        ' data-note="R&amp;D&#39;s">Cheese &amp; &quot;extra&quot; &lt;x&gt;</label>',
    );
  });
});

describe("CheckboxGroup — aria-describedby names only what renders", () => {
  it("a group with no description emits no aria-describedby at all", async () => {
    expect(
      attrsOf(
        await render(
          <CheckboxGroup name='toppings'>
            <CheckboxGroup.Item name='toppings' value='cheese'>
              Cheese
            </CheckboxGroup.Item>
          </CheckboxGroup>,
        ),
      ),
    ).toEqual(ROOT);
  });

  it("a declared description wires the IDREF, and the description element carries that id", async () => {
    const html = await render(
      <CheckboxGroup name='toppings' description>
        <CheckboxGroup.Description name='toppings'>Pick as many as you like.</CheckboxGroup.Description>
      </CheckboxGroup>,
    );

    expect(attrsOf(html)).toEqual({ ...ROOT, "aria-describedby": "field-toppings-description" });
    expect(attrsOf(html, DESCRIPTION)).toEqual({ "data-slot": "field-description", id: "field-toppings-description" });
  });

  it("an invalid group with no description names the error alone, and the error announces itself", async () => {
    const html = await render(
      <CheckboxGroup name='toppings' invalid>
        <CheckboxGroup.Error name='toppings'>Pick at least one.</CheckboxGroup.Error>
      </CheckboxGroup>,
    );

    expect(attrsOf(html)).toEqual({ ...ROOT, "aria-describedby": "field-toppings-error", "data-invalid": "" });
    expect(attrsOf(html, ERROR)).toEqual({ "data-slot": "field-error", id: "field-toppings-error", role: "alert" });
  });

  it("an invalid group with a description names both, description first", async () => {
    const html = await render(
      <CheckboxGroup name='toppings' description invalid>
        <CheckboxGroup.Description name='toppings'>Pick as many as you like.</CheckboxGroup.Description>
        <CheckboxGroup.Error name='toppings'>Pick at least one.</CheckboxGroup.Error>
      </CheckboxGroup>,
    );

    expect(attrOf(html, "aria-describedby")).toBe("field-toppings-description field-toppings-error");
    expect(idsAndRefs(html)).toEqual(["field-toppings-description", "field-toppings-error", "field-toppings-description", "field-toppings-error"]);
  });
});

describe("CheckboxGroup — a name must be a single id token", () => {
  it("an item value containing a space declares no id, while the value itself passes through verbatim", async () => {
    expect(
      attrsOf(
        await render(
          <CheckboxGroup name='pets'>
            <CheckboxGroup.Item name='pets' value='a b'>
              A B
            </CheckboxGroup.Item>
          </CheckboxGroup>,
        ),
        INPUT,
      ),
    ).toEqual({ ...ITEM, name: "pets", value: "a b" });
  });

  it("a group name containing a space suppresses its items' ids too", async () => {
    const html = await render(
      <CheckboxGroup name='fav pet'>
        <CheckboxGroup.Item name='fav pet' value='cat'>
          Cat
        </CheckboxGroup.Item>
      </CheckboxGroup>,
    );

    expect(attrsOf(html, INPUT)).toEqual({ ...ITEM, name: "fav pet", value: "cat" });
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

    expect(attrsOf(html, INPUT)).toEqual({ ...ITEM, name: "toppings", value: "cheese" });
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
    const html = await render(
      <CheckboxGroup name='fav pet' description>
        <CheckboxGroup.Description name='fav pet'>Pick one.</CheckboxGroup.Description>
      </CheckboxGroup>,
    );

    expect(attrsOf(html)).toEqual(ROOT);
    expect(attrsOf(html, DESCRIPTION)).toEqual({ "data-slot": "field-description" });
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

describe("CheckboxGroup — size, invalid and busy", () => {
  it("names the size it was given on the attribute a stylesheet and a reader both key on", async () => {
    expect([
      attrsOf(await render(<CheckboxGroup name='c' />)),
      attrsOf(await render(<CheckboxGroup name='c' size='sm' />)),
      attrsOf(await render(<CheckboxGroup name='c' size='lg' />)),
    ]).toEqual([ROOT, { ...ROOT, "data-size": "sm" }, { ...ROOT, "data-size": "lg" }]);
  });

  it("stamps invalidity for a stylesheet but keeps aria-invalid off, which the group role forbids", async () => {
    expect(attrsOf(await render(<CheckboxGroup name='c' invalid />))).toEqual({ ...ROOT, "aria-describedby": "field-c-error", "data-invalid": "" });
  });

  it("stamps busyness for a stylesheet but keeps aria-busy off, which the group role forbids", async () => {
    expect(attrsOf(await render(<CheckboxGroup name='c' busy />))).toEqual({ ...ROOT, "data-busy": "" });
  });

  it("a caller's own aria attribute survives the state spread", async () => {
    expect(attrsOf(await render(<CheckboxGroup name='c' invalid aria-label='Plan' />))).toEqual({
      ...ROOT,
      "aria-describedby": "field-c-error",
      "data-invalid": "",
      "aria-label": "Plan",
    });
  });

  it("an Item sizes its own box rather than inheriting the group's", async () => {
    expect(
      variantClasses(
        await render(<CheckboxGroup.Item name='c' value='a' size='lg' />),
        await render(<CheckboxGroup.Item name='c' value='a' />),
        INPUT,
      ),
    ).toEqual({ added: ["size-5"], dropped: ["size-4"] });
  });

  it("an Item carries its own invalid and busy state, where the role does allow the aria", async () => {
    expect(attrsOf(await render(<CheckboxGroup.Item name='c' value='a' invalid busy />), INPUT)).toEqual({
      ...ITEM,
      id: "field-c-a",
      name: "c",
      value: "a",
      "data-invalid": "",
      "data-busy": "",
      "aria-invalid": "true",
      "aria-busy": "true",
    });
  });
});
