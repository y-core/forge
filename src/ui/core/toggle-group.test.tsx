import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import type { Size } from "../contracts/types";
import { ToggleGroup } from "./toggle-group";

const ITEM_INPUT = 'data-slot="toggle-group-input"';

const ITEM_SIZES: { size: Size; added: string[]; dropped: string[] }[] = [
  { size: "md", added: ["h-control-md", "px-4"], dropped: ["h-control-sm", "px-3"] },
  { size: "lg", added: ["h-control-lg", "px-6", "text-base"], dropped: ["h-control-sm", "px-3", "text-sm"] },
];

const item = (props: Parameters<typeof ToggleGroup.Item>[0]) => render(<ToggleGroup.Item {...props} />);

describe("ToggleGroup", () => {
  it("root is a fieldset carrying the scope its roving focus resumes from", async () => {
    expect(attrsOf(await render(<ToggleGroup aria-label='Projection' data-ref='projection-group' />))).toEqual({
      "data-slot": "toggle-group",
      "data-scope": "toggle-group",
      "data-orientation": "horizontal",
      "aria-label": "Projection",
      "data-ref": "projection-group",
    });
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<ToggleGroup class='extra-root' />)).at(-1)).toBe("extra-root");
  });

  it("stacks a vertical group rather than laying a second axis over the horizontal one", async () => {
    expect(variantClasses(await render(<ToggleGroup orientation='vertical' />), await render(<ToggleGroup />))).toEqual({
      added: ["flex-col"],
      dropped: [],
    });
  });

  it("gives the group neither a role nor an aria-orientation, on either axis", async () => {
    for (const orientation of ["horizontal", "vertical"] as const) {
      expect(attrsOf(await render(<ToggleGroup orientation={orientation} aria-label='Projection' />))).toEqual({
        "data-slot": "toggle-group",
        "data-scope": "toggle-group",
        "data-orientation": orientation,
        "aria-label": "Projection",
      });
    }
  });

  it("type=multiple marks the group, which is what makes its items checkboxes and mounts roving focus", async () => {
    expect(attrsOf(await render(<ToggleGroup type='multiple' />))).toEqual({
      "data-slot": "toggle-group",
      "data-scope": "toggle-group",
      "data-multiple": "",
      "data-orientation": "horizontal",
    });
  });
});

describe("ToggleGroup.Item", () => {
  it("renders the whole item exactly, caller class merged last and children escaped", async () => {
    expect(await render(<ToggleGroup.Item name='n' value='v' class='extra-cls'>{`R&D's <view>`}</ToggleGroup.Item>)).toBe(
      '<label data-slot="toggle-group-item" class="state-busy state-disabled inline-flex items-center justify-center gap-2 border-field' +
        " font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)]" +
        " [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)]" +
        " [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] [--focus-ring:var(--color-ring)] text-foreground" +
        " hover:bg-accent bg-transparent border-input border-s-0 cursor-pointer rounded-none first:rounded-s-field first:border-s" +
        " last:rounded-e-field hover:text-accent-foreground [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-s" +
        " [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0" +
        " [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none" +
        " [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t" +
        " [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-field" +
        " [[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-field has-[:checked]:bg-primary" +
        ' has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary extra-cls">' +
        '<input data-slot="toggle-group-input" type="radio" name="n" value="v" class="sr-only">R&amp;D&#39;s &lt;view&gt;</label>',
    );
  });

  it("wraps a real radio the label hides, so a bare group submits with no script", async () => {
    const html = await item({ name: "view", value: "perspective", children: "Label" });

    expect(attrsOf(html, ITEM_INPUT)).toEqual({ "data-slot": "toggle-group-input", type: "radio", name: "view", value: "perspective" });
    expect(classesOf(html, ITEM_INPUT)).toEqual(["sr-only"]);
  });

  it("type=multiple renders a checkbox instead, so several items can be chosen at once", async () => {
    expect(attrsOf(await item({ name: "overlay", value: "grid", type: "multiple", pressed: true, children: "Grid" }), ITEM_INPUT)).toEqual({
      "data-slot": "toggle-group-input",
      type: "checkbox",
      name: "overlay",
      value: "grid",
      checked: "",
    });
  });

  // No `data-pressed` and no `aria-pressed`: the input is a real radio, so `:checked` is the state,
  // and the label's own `has-[:checked]` hooks are what paint from it.
  it("carries a pressed item's state as the input's checkedness and nothing else", async () => {
    const pressed = await item({ name: "n", value: "v", pressed: true, children: "X" });
    const unpressed = await item({ name: "n", value: "v", children: "X" });

    expect(attrsOf(pressed, ITEM_INPUT)).toEqual({ ...attrsOf(unpressed, ITEM_INPUT), checked: "" });
    expect(attrsOf(pressed)).toEqual(attrsOf(unpressed));
    expect(classesOf(pressed)).toEqual(classesOf(unpressed));
  });

  it("takes core/Button's box at the size the caller names, swapping the sm default out rather than layering on it", async () => {
    const small = await item({ name: "n", value: "v", children: "X" });

    for (const { size, added, dropped } of ITEM_SIZES) {
      expect(variantClasses(await item({ name: "n", value: "v", size, children: "X" }), small)).toEqual({ added, dropped });
    }
  });

  it("spreads delegation and test attributes onto the input, where a controller reads them", async () => {
    expect(
      attrsOf(
        await item({ name: "n", value: "v", "data-on-click": "cameraMode", "data-ref": "cam-perspective", title: "Perspective", children: "P" }),
        ITEM_INPUT,
      ),
    ).toEqual({
      "data-slot": "toggle-group-input",
      type: "radio",
      name: "n",
      value: "v",
      "data-on-click": "cameraMode",
      "data-ref": "cam-perspective",
      title: "Perspective",
    });
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    const html = await item({ name: "n", value: "v", "data-slot": "rail-tool" });

    expect(attrOf(html, "data-slot")).toBe("toggle-group-item");
    expect(attrOf(html, "data-slot", 'type="radio"')).toBe("toggle-group-input rail-tool");
  });

  it("renders a whole group in one tree, the shared name binding its items into one choice", async () => {
    const html = await render(
      <ToggleGroup aria-label='Views'>
        <ToggleGroup.Item name='view' value='perspective' pressed>
          Perspective
        </ToggleGroup.Item>
        <ToggleGroup.Item name='view' value='parallel'>
          Parallel
        </ToggleGroup.Item>
      </ToggleGroup>,
    );

    expect([...html.matchAll(/<input[^>]*>/g)].map((match) => attrsOf(match[0] as string))).toEqual([
      { "data-slot": "toggle-group-input", type: "radio", name: "view", value: "perspective", checked: "" },
      { "data-slot": "toggle-group-input", type: "radio", name: "view", value: "parallel" },
    ]);
  });
});
