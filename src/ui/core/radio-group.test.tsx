/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { RadioGroup } from "./radio-group";
import { attrOf, attrsOf, variantClasses } from "./test-support";

const INPUT = 'data-slot="radio-group-input"';
const DESCRIPTION = 'data-slot="field-description"';
const ERROR = 'data-slot="field-error"';

const ROOT = { "data-slot": "radio-group", role: "radiogroup", "data-size": "md", "data-orientation": "vertical" };
const ITEM = { type: "radio", "data-slot": "radio-group-input" };

function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("RadioGroup", () => {
  it("renders the whole item exactly, its label text and a forwarded value escaped", async () => {
    expect(
      await render(
        <RadioGroup.Item name='plan' value='free' data-note="R&D's">
          {`Free & "easy" <x>`}
        </RadioGroup.Item>,
      ),
    ).toBe(
      '<label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio"' +
        ' data-slot="radio-group-input" id="field-plan-free" name="plan" value="free" class="state-busy state-disabled shrink-0' +
        ' appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4"' +
        ' data-note="R&amp;D&#39;s">Free &amp; &quot;easy&quot; &lt;x&gt;</label>',
    );
  });
});

describe("RadioGroup — aria-describedby names only what renders", () => {
  it("a group with no description emits no aria-describedby at all", async () => {
    expect(
      attrsOf(
        await render(
          <RadioGroup name='plan'>
            <RadioGroup.Item name='plan' value='free'>
              Free
            </RadioGroup.Item>
          </RadioGroup>,
        ),
      ),
    ).toEqual(ROOT);
  });

  it("a declared description wires the IDREF, and the description element carries that id", async () => {
    const html = await render(
      <RadioGroup name='plan' description>
        <RadioGroup.Description name='plan'>Change it any time.</RadioGroup.Description>
      </RadioGroup>,
    );

    expect(attrsOf(html)).toEqual({ ...ROOT, "aria-describedby": "field-plan-description" });
    expect(attrsOf(html, DESCRIPTION)).toEqual({ "data-slot": "field-description", id: "field-plan-description" });
  });

  it("an invalid group with no description names the error alone, and the error announces itself", async () => {
    const html = await render(
      <RadioGroup name='plan' invalid>
        <RadioGroup.Error name='plan'>Choose a plan.</RadioGroup.Error>
      </RadioGroup>,
    );

    expect(attrsOf(html)).toEqual({ ...ROOT, "aria-describedby": "field-plan-error", "data-invalid": "" });
    expect(attrsOf(html, ERROR)).toEqual({ "data-slot": "field-error", id: "field-plan-error", role: "alert" });
  });

  it("an invalid group with a description names both, description first", async () => {
    const html = await render(
      <RadioGroup name='plan' description invalid>
        <RadioGroup.Description name='plan'>Change it any time.</RadioGroup.Description>
        <RadioGroup.Error name='plan'>Choose a plan.</RadioGroup.Error>
      </RadioGroup>,
    );

    expect(attrOf(html, "aria-describedby")).toBe("field-plan-description field-plan-error");
    expect(idsAndRefs(html)).toEqual(["field-plan-description", "field-plan-error", "field-plan-description", "field-plan-error"]);
  });
});

describe("RadioGroup — a name must be a single id token", () => {
  it("an item value containing a space declares no id, while the value itself passes through verbatim", async () => {
    expect(
      attrsOf(
        await render(
          <RadioGroup name='pets'>
            <RadioGroup.Item name='pets' value='a b'>
              A B
            </RadioGroup.Item>
          </RadioGroup>,
        ),
        INPUT,
      ),
    ).toEqual({ ...ITEM, name: "pets", value: "a b" });
  });

  it("a group name containing a space suppresses its items' ids too", async () => {
    const html = await render(
      <RadioGroup name='fav pet'>
        <RadioGroup.Item name='fav pet' value='cat'>
          Cat
        </RadioGroup.Item>
      </RadioGroup>,
    );

    expect(attrsOf(html, INPUT)).toEqual({ ...ITEM, name: "fav pet", value: "cat" });
    expect(idsAndRefs(html)).toEqual([]);
  });

  it("a scope containing a space suppresses the item id rather than emitting a two-token one", async () => {
    const html = await render(
      <RadioGroup name='plan' scope='a b'>
        <RadioGroup.Item name='plan' scope='a b' value='free'>
          Free
        </RadioGroup.Item>
      </RadioGroup>,
    );

    expect(attrsOf(html, INPUT)).toEqual({ ...ITEM, name: "plan", value: "free" });
    expect(idsAndRefs(html)).toEqual([]);
  });

  it("a tab or newline in the value suppresses the id just as a space does", async () => {
    const html = await render(
      <RadioGroup name='pets'>
        <RadioGroup.Item name='pets' value={"a\tb"}>
          A B
        </RadioGroup.Item>
        <RadioGroup.Item name='pets' value={"c\nd"}>
          C D
        </RadioGroup.Item>
      </RadioGroup>,
    );

    expect(idsAndRefs(html)).toEqual([]);
  });

  it("a group name containing a space emits no aria-describedby, and its description no id", async () => {
    const html = await render(
      <RadioGroup name='fav pet' description>
        <RadioGroup.Description name='fav pet'>Pick one.</RadioGroup.Description>
      </RadioGroup>,
    );

    expect(attrsOf(html)).toEqual(ROOT);
    expect(attrsOf(html, DESCRIPTION)).toEqual({ "data-slot": "field-description" });
  });
});

describe("RadioGroup — two same-named groups on one page", () => {
  const twoGroups = (scoped: boolean) => {
    const group = (scope: string) => {
      const naming = scoped ? { name: "plan", scope } : { name: "plan" };
      return (
        <RadioGroup {...naming} description>
          <RadioGroup.Description {...naming}>Change it any time.</RadioGroup.Description>
          <RadioGroup.Item {...naming} value='free'>
            Free
          </RadioGroup.Item>
        </RadioGroup>
      );
    };
    return (
      <div>
        {group("personal")}
        {group("team")}
      </div>
    );
  };

  it("collides on every id — item as well as description — without a scope", async () => {
    const ids = idsAndRefs(await render(twoGroups(false)));

    expect(ids).toEqual([
      "field-plan-description",
      "field-plan-description",
      "field-plan-free",
      "field-plan-description",
      "field-plan-description",
      "field-plan-free",
    ]);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps every id distinct once each group carries a scope", async () => {
    const ids = idsAndRefs(await render(twoGroups(true)));

    expect(ids).toEqual([
      "field-personal-plan-description",
      "field-personal-plan-description",
      "field-personal-plan-free",
      "field-team-plan-description",
      "field-team-plan-description",
      "field-team-plan-free",
    ]);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("RadioGroup — size, invalid and busy", () => {
  it("names the size it was given on the attribute a stylesheet and a reader both key on", async () => {
    expect([
      attrsOf(await render(<RadioGroup name='r' />)),
      attrsOf(await render(<RadioGroup name='r' size='sm' />)),
      attrsOf(await render(<RadioGroup name='r' size='lg' />)),
    ]).toEqual([ROOT, { ...ROOT, "data-size": "sm" }, { ...ROOT, "data-size": "lg" }]);
  });

  it("stamps invalidity for a stylesheet but keeps aria-invalid off, which the radiogroup role forbids", async () => {
    expect(attrsOf(await render(<RadioGroup name='r' invalid />))).toEqual({ ...ROOT, "aria-describedby": "field-r-error", "data-invalid": "" });
  });

  it("stamps busyness for a stylesheet but keeps aria-busy off, which the radiogroup role forbids", async () => {
    expect(attrsOf(await render(<RadioGroup name='r' busy />))).toEqual({ ...ROOT, "data-busy": "" });
  });

  it("a caller's own aria attribute survives the state spread", async () => {
    expect(attrsOf(await render(<RadioGroup name='r' invalid aria-label='Plan' />))).toEqual({
      ...ROOT,
      "aria-describedby": "field-r-error",
      "data-invalid": "",
      "aria-label": "Plan",
    });
  });

  it("an Item sizes its own box rather than inheriting the group's", async () => {
    expect(
      variantClasses(await render(<RadioGroup.Item name='r' value='a' size='lg' />), await render(<RadioGroup.Item name='r' value='a' />), INPUT),
    ).toEqual({ added: ["size-5"], dropped: ["size-4"] });
  });

  it("an Item carries its own invalid and busy state, where the role does allow the aria", async () => {
    expect(attrsOf(await render(<RadioGroup.Item name='r' value='a' invalid busy />), INPUT)).toEqual({
      ...ITEM,
      id: "field-r-a",
      name: "r",
      value: "a",
      "data-invalid": "",
      "data-busy": "",
      "aria-invalid": "true",
      "aria-busy": "true",
    });
  });
});
