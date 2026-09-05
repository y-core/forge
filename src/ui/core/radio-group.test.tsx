/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { RadioGroup } from "./radio-group";

function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("RadioGroup — aria-describedby names only what renders", () => {
  it("a group with no description emits no aria-describedby at all", async () => {
    expect(
      await render(
        <RadioGroup name='plan'>
          <RadioGroup.Item name='plan' value='free'>
            Free
          </RadioGroup.Item>
        </RadioGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" id="field-plan-free" name="plan" value="free" class="state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4">Free</label></fieldset>',
    );
  });

  it("a declared description wires the IDREF, and the description element carries that id", async () => {
    expect(
      await render(
        <RadioGroup name='plan' description>
          <RadioGroup.Description name='plan'>Change it any time.</RadioGroup.Description>
        </RadioGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" aria-describedby="field-plan-description" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-plan-description">Change it any time.</p></fieldset>',
    );
  });

  it("an invalid group with no description names the error alone", async () => {
    expect(
      await render(
        <RadioGroup name='plan' invalid>
          <RadioGroup.Error name='plan'>Choose a plan.</RadioGroup.Error>
        </RadioGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" aria-describedby="field-plan-error" data-size="md" data-invalid="" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-plan-error" role="alert">Choose a plan.</p></fieldset>',
    );
  });

  it("an invalid group with a description names both, description first", async () => {
    const html = await render(
      <RadioGroup name='plan' description invalid>
        <RadioGroup.Description name='plan'>Change it any time.</RadioGroup.Description>
        <RadioGroup.Error name='plan'>Choose a plan.</RadioGroup.Error>
      </RadioGroup>,
    );

    expect(html).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" aria-describedby="field-plan-description field-plan-error" data-size="md" data-invalid="" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-plan-description">Change it any time.</p><p data-slot="field-error" class="text-sm font-normal text-destructive-text" id="field-plan-error" role="alert">Choose a plan.</p></fieldset>',
    );
    expect(idsAndRefs(html)).toEqual(["field-plan-description", "field-plan-error", "field-plan-description", "field-plan-error"]);
  });
});

describe("RadioGroup — a name must be a single id token", () => {
  it("an item value containing a space declares no id, while the value itself passes through verbatim", async () => {
    expect(
      await render(
        <RadioGroup name='pets'>
          <RadioGroup.Item name='pets' value='a b'>
            A B
          </RadioGroup.Item>
        </RadioGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" name="pets" value="a b" class="state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4">A B</label></fieldset>',
    );
  });

  it("a group name containing a space suppresses its items' ids too", async () => {
    const html = await render(
      <RadioGroup name='fav pet'>
        <RadioGroup.Item name='fav pet' value='cat'>
          Cat
        </RadioGroup.Item>
      </RadioGroup>,
    );

    expect(html).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" name="fav pet" value="cat" class="state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4">Cat</label></fieldset>',
    );
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

    expect(html).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" name="plan" value="free" class="state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4">Free</label></fieldset>',
    );
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
    expect(
      await render(
        <RadioGroup name='fav pet' description>
          <RadioGroup.Description name='fav pet'>Pick one.</RadioGroup.Description>
        </RadioGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground">Pick one.</p></fieldset>',
    );
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
  it("stamps data-size=md on the root by default", async () => {
    expect(await render(<RadioGroup name='r' />)).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"></fieldset>',
    );
  });

  it("size='sm' stamps data-size=sm on the root", async () => {
    expect(await render(<RadioGroup name='r' size='sm' />)).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="sm" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"></fieldset>',
    );
  });

  it("size='lg' stamps data-size=lg on the root", async () => {
    expect(await render(<RadioGroup name='r' size='lg' />)).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="lg" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"></fieldset>',
    );
  });

  it("invalid stamps data-invalid on the root, and no aria-invalid, which the group role forbids", async () => {
    expect(await render(<RadioGroup name='r' invalid />)).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" aria-describedby="field-r-error" data-size="md" data-invalid="" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"></fieldset>',
    );
  });

  it("busy stamps data-busy on the root, and no aria-busy, which the group role forbids", async () => {
    expect(await render(<RadioGroup name='r' busy />)).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" data-size="md" data-busy="" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col"></fieldset>',
    );
  });

  it("a caller's own aria attribute survives the state spread", async () => {
    expect(await render(<RadioGroup name='r' invalid aria-label='Plan' />)).toBe(
      '<fieldset data-slot="radio-group" role="radiogroup" aria-describedby="field-r-error" data-size="md" data-invalid="" data-orientation="vertical" class="state-busy m-0 flex gap-2 border-0 state-invalid p-0 flex-col" aria-label="Plan"></fieldset>',
    );
  });

  it("an Item sizes its own box", async () => {
    expect(await render(<RadioGroup.Item name='r' value='a' size='lg' />)).toBe(
      '<label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" id="field-r-a" name="r" value="a" class="state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-5"></label>',
    );
  });

  it("an Item carries its own invalid and busy state", async () => {
    expect(await render(<RadioGroup.Item name='r' value='a' invalid busy />)).toBe(
      '<label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" id="field-r-a" name="r" value="a" class="state-busy state-disabled shrink-0 appearance-none rounded-full border state-invalid border-input bg-background focus-ring-outset checked:bg-primary size-4" data-invalid="" data-busy="" aria-invalid="true" aria-busy="true"></label>',
    );
  });
});
