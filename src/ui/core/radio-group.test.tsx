/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { RadioGroup } from "./radio-group";

/** Every id the rendered markup declares or references, in document order. */
function idsAndRefs(html: string): string[] {
  return [...html.matchAll(/(?:^|\s)(?:id|for|aria-describedby)="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
}

describe("RadioGroup — aria-describedby names only what renders", () => {
  it("a group with no description emits no aria-describedby at all", async () => {
    // Same defect as `CheckboxGroup` and the same consequence: the shipped catalog page rendered
    // this group with no `Description` child and pointed `aria-describedby` at a missing element.
    expect(
      await render(
        <RadioGroup name='plan'>
          <RadioGroup.Item name='plan' value='free'>
            Free
          </RadioGroup.Item>
        </RadioGroup>,
      ),
    ).toBe(
      '<fieldset data-slot="radio-group" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><label data-slot="radio-group-item" class="inline-flex items-center gap-2 text-sm text-foreground"><input type="radio" data-slot="radio-group-input" id="field-plan-free" name="plan" value="free" class="size-4 border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring">Free</label></fieldset>',
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
      '<fieldset data-slot="radio-group" aria-describedby="field-plan-description" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><p data-slot="field-description" class="text-sm leading-normal text-muted-foreground" id="field-plan-description">Change it any time.</p></fieldset>',
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
      '<fieldset data-slot="radio-group" aria-describedby="field-plan-error" data-invalid="" data-orientation="vertical" class="flex gap-2 border-0 m-0 p-0 flex-col"><p data-slot="field-error" class="text-sm font-normal text-red-600" id="field-plan-error" role="alert">Choose a plan.</p></fieldset>',
    );
  });

  it("an invalid group with a description names both, description first", async () => {
    const html = await render(
      <RadioGroup name='plan' description invalid>
        <RadioGroup.Description name='plan'>Change it any time.</RadioGroup.Description>
        <RadioGroup.Error name='plan'>Choose a plan.</RadioGroup.Error>
      </RadioGroup>,
    );

    expect(html).toContain('aria-describedby="field-plan-description field-plan-error"');
    expect(idsAndRefs(html)).toEqual(["field-plan-description", "field-plan-error", "field-plan-description", "field-plan-error"]);
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
