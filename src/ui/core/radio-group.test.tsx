/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { RadioGroup } from "./radio-group";

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
      '<label data-slot="radio-group-item" class="inline-flex min-h-control-sm items-center gap-2 text-sm text-foreground"><input type="radio"' +
        ' data-slot="radio-group-input" id="field-plan-free" name="plan" value="free" class="state-busy state-disabled shrink-0' +
        ' appearance-none rounded-full border-field state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4"' +
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

  it("an invalid group with no description names the error alone, and the error claims no live-region role", async () => {
    const html = await render(
      <RadioGroup name='plan' error='Choose a plan.'>
        <RadioGroup.Error name='plan'>Choose a plan.</RadioGroup.Error>
      </RadioGroup>,
    );

    expect(attrsOf(html)).toEqual({ ...ROOT, "aria-describedby": "field-plan-error", "data-invalid": "" });
    expect(attrsOf(html, ERROR)).toEqual({ "data-slot": "field-error", id: "field-plan-error" });
  });

  it("an invalid group with a description names both, description first", async () => {
    const html = await render(
      <RadioGroup name='plan' description error='Choose a plan.'>
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
    expect(attrsOf(await render(<RadioGroup name='r' error='Required' />))).toEqual({
      ...ROOT,
      "aria-describedby": "field-r-error",
      "data-invalid": "",
    });
  });

  it("stamps busyness for a stylesheet but keeps aria-busy off, which the radiogroup role forbids", async () => {
    expect(attrsOf(await render(<RadioGroup name='r' busy />))).toEqual({ ...ROOT, "data-busy": "" });
  });

  it("a caller's own aria attribute survives the state spread", async () => {
    expect(attrsOf(await render(<RadioGroup name='r' error='Required' aria-label='Plan' />))).toEqual({
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

describe("RadioGroup — an item value never takes a group message's id", () => {
  const levels = () =>
    render(
      <RadioGroup name='level' description error='Choose a level.'>
        <RadioGroup.Item name='level' value='error'>
          Error
        </RadioGroup.Item>
        <RadioGroup.Item name='level' value='description'>
          Description
        </RadioGroup.Item>
        <RadioGroup.Item name='level' value='warn'>
          Warn
        </RadioGroup.Item>
        <RadioGroup.Description name='level'>Which entries to keep.</RadioGroup.Description>
        <RadioGroup.Error name='level'>Choose a level.</RadioGroup.Error>
      </RadioGroup>,
    );

  it("declares every id on the page once", async () => {
    const declared = [...(await levels()).matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);

    expect(declared).toEqual([...new Set(declared)]);
  });

  it("gives the items valued 'error' and 'description' no id, and the other item its derived one", async () => {
    const items = [...(await levels()).matchAll(/<input[^>]*>/g)].map((match) => attrsOf(match[0]));

    expect(items).toEqual([
      { ...ITEM, name: "level", value: "error" },
      { ...ITEM, name: "level", value: "description" },
      { ...ITEM, id: "field-level-warn", name: "level", value: "warn" },
    ]);
  });

  it("points the group's error reference at the error message and nothing else", async () => {
    const html = await levels();
    const holders = [...html.matchAll(/<(\w+)[^>]*\sid="field-level-error"/g)].map((match) => match[1]);

    expect([holders, attrOf(html, "id", ERROR)]).toEqual([["p"], "field-level-error"]);
  });
});

describe("RadioGroup — a caller's aria-describedby joins the derived ids rather than replacing them", () => {
  it("lists the caller's id ahead of the description and the error", async () => {
    expect(
      attrOf(
        await render(
          <RadioGroup name='plan' description error='x' aria-describedby='hint'>
            <RadioGroup.Description name='plan'>Help</RadioGroup.Description>
            <RadioGroup.Error name='plan'>x</RadioGroup.Error>
          </RadioGroup>,
        ),
        "aria-describedby",
      ),
    ).toBe("hint field-plan-description field-plan-error");
  });

  it("names a derived id the caller already wrote once, in the caller's position", async () => {
    expect(
      attrOf(
        await render(
          <RadioGroup name='plan' description error='x' aria-describedby='field-plan-error'>
            <RadioGroup.Description name='plan'>Help</RadioGroup.Description>
            <RadioGroup.Error name='plan'>x</RadioGroup.Error>
          </RadioGroup>,
        ),
        "aria-describedby",
      ),
    ).toBe("field-plan-error field-plan-description");
  });

  it("emits no aria-describedby for an empty caller value when nothing derived renders", async () => {
    expect(attrsOf(await render(<RadioGroup name='plan' aria-describedby='' />))).toEqual(ROOT);
  });
});

describe("RadioGroup — the root's size reaches its items", () => {
  it("sizes each input from the root, and an item's own size wins", async () => {
    const html = await render(
      <RadioGroup name='r' size='lg'>
        <RadioGroup.Item name='r' value='a' />
        <RadioGroup.Item name='r' value='b' size='sm' />
      </RadioGroup>,
    );

    expect([classesOf(html, 'value="a"').at(-1), classesOf(html, 'value="b"').at(-1)]).toEqual(["size-5", "size-3.5"]);
  });
});
