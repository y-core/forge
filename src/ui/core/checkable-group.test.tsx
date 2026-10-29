/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { createCheckableGroup } from "./checkable-group";
import { FieldDescription, FieldError } from "./field";

const Radio = createCheckableGroup("radio");
const Checkbox = createCheckableGroup("checkbox");

const ROOT = { "data-size": "md", "data-orientation": "vertical" };

describe("createCheckableGroup — the root", () => {
  it("a radio group is a radiogroup", async () => {
    expect(attrsOf(await render(<Radio name='plan' />))).toEqual({ ...ROOT, "data-slot": "radio-group", role: "radiogroup" });
  });

  it("a checkbox group carries no role, leaving the fieldset's own group role", async () => {
    expect(attrsOf(await render(<Checkbox name='plan' />))).toEqual({ ...ROOT, "data-slot": "checkbox-group" });
  });
});

describe("createCheckableGroup — the item", () => {
  for (const input of ["radio", "checkbox"] as const) {
    it(`a ${input} group's item input has that type`, async () => {
      const Group = createCheckableGroup(input);

      expect(attrOf(await render(<Group.Item name='plan' value='free' />), "type", 'name="plan"')).toBe(input);
    });
  }

  it("a radio input is round and a checkbox input is square, and no other class token differs", async () => {
    const radio = await render(<Radio.Item name='plan' value='free' />);
    const checkbox = await render(<Checkbox.Item name='plan' value='free' />);

    expect(variantClasses(radio, checkbox, 'name="plan"')).toEqual({ added: ["rounded-full"], dropped: ["rounded-sm"] });
  });
});

describe("createCheckableGroup — slot tokens carry the input type as their prefix", () => {
  for (const { input, slots } of [
    { input: "radio", slots: ["radio-group", "radio-group-label", "radio-group-item", "radio-group-input"] },
    { input: "checkbox", slots: ["checkbox-group", "checkbox-group-label", "checkbox-group-item", "checkbox-group-input"] },
  ] as const) {
    it(input, async () => {
      const Group = createCheckableGroup(input);
      const html = await render(
        <Group name='plan'>
          <Group.Label>Plan</Group.Label>
          <Group.Item name='plan' value='free'>
            Free
          </Group.Item>
        </Group>,
      );

      expect([...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1])).toEqual([...slots]);
    });
  }
});

describe("createCheckableGroup — the root's size reaches its own Item", () => {
  for (const input of ["radio", "checkbox"] as const) {
    it(input, async () => {
      const Group = createCheckableGroup(input);
      const grouped = await render(
        <Group name='plan' size='lg'>
          <Group.Item name='plan' value='free' />
        </Group>,
      );
      const sizedAlone = await render(<Group.Item name='plan' value='free' size='lg' />);
      const unsized = await render(<Group.Item name='plan' value='free' />);

      expect(classesOf(grouped, 'name="plan"')).toEqual(classesOf(sizedAlone, 'name="plan"'));
      expect(classesOf(grouped, 'name="plan"')).not.toEqual(classesOf(unsized, 'name="plan"'));
    });
  }

  it("an Item from a different group call is not sized by this root", async () => {
    const html = await render(
      <Radio name='plan' size='lg'>
        <Checkbox.Item name='plan' value='free' />
      </Radio>,
    );

    expect(classesOf(html, 'name="plan"')).toEqual(classesOf(await render(<Checkbox.Item name='plan' value='free' />), 'name="plan"'));
  });
});

describe("createCheckableGroup — description and error", () => {
  for (const [input, Group] of [
    ["radio", Radio],
    ["checkbox", Checkbox],
  ] as const) {
    it(`a ${input} group's Description and Error are the field's own`, () => {
      expect(Group.Description).toBe(FieldDescription);
      expect(Group.Error).toBe(FieldError);
    });
  }
});
