import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { ToggleGroup } from "./toggle-group";

const GROUP_CLASS = "flex justify-center min-w-0 border-0 m-0 p-0";

const ITEM_BOX =
  "inline-flex items-center justify-center font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent";

const ITEM_SEGMENT =
  "bg-transparent border border-input border-s-0 cursor-pointer rounded-none first:border-s first:rounded-s-md " +
  "last:rounded-e-md hover:text-accent-foreground " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-s " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md";

const ITEM_STATE =
  "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50";

function itemClass(size = "h-8 px-3 text-sm", extra = ""): string {
  return `${ITEM_BOX} ${size} ${ITEM_SEGMENT} ${ITEM_STATE}${extra}`;
}

describe("ToggleGroup", () => {
  it("root is a fieldset carrying the scope its roving focus resumes from", async () => {
    expect(await render(<ToggleGroup aria-label='Projection' data-ref='projection-group' />)).toBe(
      `<fieldset data-slot="toggle-group" data-scope="toggle-group" data-orientation="horizontal" class="${GROUP_CLASS}" ` +
        'aria-label="Projection" data-ref="projection-group"></fieldset>',
    );
  });

  it("root merges a custom class with the base classes", async () => {
    expect(await render(<ToggleGroup class='extra-root' />)).toBe(
      `<fieldset data-slot="toggle-group" data-scope="toggle-group" data-orientation="horizontal" class="${GROUP_CLASS} extra-root"></fieldset>`,
    );
  });

  it("vertical orientation stamps data-orientation and adds flex-col to the group", async () => {
    expect(await render(<ToggleGroup orientation='vertical' />)).toBe(
      `<fieldset data-slot="toggle-group" data-scope="toggle-group" data-orientation="vertical" class="${GROUP_CLASS} flex-col"></fieldset>`,
    );
  });

  it("type=multiple marks the group, which is what makes its items checkboxes and mounts roving focus", async () => {
    expect(await render(<ToggleGroup type='multiple' />)).toBe(
      `<fieldset data-slot="toggle-group" data-scope="toggle-group" data-multiple="" data-orientation="horizontal" class="${GROUP_CLASS}"></fieldset>`,
    );
  });

  it("gives the group neither a role nor an aria-orientation, on either axis", async () => {
    const vertical = await render(<ToggleGroup orientation='vertical' aria-label='Projection' />);
    const horizontal = await render(<ToggleGroup orientation='horizontal' aria-label='Projection' />);

    for (const html of [vertical, horizontal]) {
      expect(html).not.toContain("role=");
      expect(html).not.toContain("aria-orientation");
    }
  });

  it("item is a label wrapping a real radio, so a bare group submits with no script", async () => {
    expect(
      await render(
        <ToggleGroup.Item name='view' value='perspective'>
          Label
        </ToggleGroup.Item>,
      ),
    ).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass()}">` +
        '<input data-slot="toggle-group-input" type="radio" name="view" value="perspective" class="sr-only">Label</label>',
    );
  });

  it("type=multiple renders a checkbox instead, so several items can be chosen at once", async () => {
    expect(
      await render(
        <ToggleGroup.Item name='overlay' value='grid' type='multiple' pressed>
          Grid
        </ToggleGroup.Item>,
      ),
    ).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass()}">` +
        '<input data-slot="toggle-group-input" type="checkbox" name="overlay" value="grid" class="sr-only" checked>Grid</label>',
    );
  });

  it("pressed becomes the input's own checkedness, which the label's has-[:checked] hooks paint from", async () => {
    const pressed = await render(
      <ToggleGroup.Item name='n' value='v' pressed>
        X
      </ToggleGroup.Item>,
    );
    const unpressed = await render(
      <ToggleGroup.Item name='n' value='v'>
        X
      </ToggleGroup.Item>,
    );

    expect(pressed.replace(" checked>", ">")).toBe(unpressed);
    expect(pressed).not.toContain("aria-pressed");
    expect(pressed).not.toContain("data-pressed");
  });

  it("item takes core/Button's ghost box at the size the caller names", async () => {
    expect(
      await render(
        <ToggleGroup.Item name='n' value='v' size='lg'>
          X
        </ToggleGroup.Item>,
      ),
    ).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass("h-12 px-6 text-base")}">` +
        '<input data-slot="toggle-group-input" type="radio" name="n" value="v" class="sr-only">X</label>',
    );
  });

  it("item at size=icon-sm renders the 32px square box", async () => {
    expect(
      await render(
        <ToggleGroup.Item name='n' value='v' size='icon-sm'>
          X
        </ToggleGroup.Item>,
      ),
    ).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass("size-8 p-0")}">` +
        '<input data-slot="toggle-group-input" type="radio" name="n" value="v" class="sr-only">X</label>',
    );
  });

  it("item spreads delegation and test attributes onto the input, where a controller reads them", async () => {
    expect(
      await render(
        <ToggleGroup.Item name='n' value='v' data-on-click='cameraMode' data-ref='cam-perspective' title='Perspective'>
          P
        </ToggleGroup.Item>,
      ),
    ).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass()}">` +
        '<input data-slot="toggle-group-input" type="radio" name="n" value="v" class="sr-only" data-on-click="cameraMode" ' +
        'data-ref="cam-perspective" title="Perspective">P</label>',
    );
  });

  it("item merges a custom class onto the label and escapes its children", async () => {
    expect(await render(<ToggleGroup.Item name='n' value='v' class='extra-cls'>{`R&D's <view>`}</ToggleGroup.Item>)).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass("h-8 px-3 text-sm", " extra-cls")}">` +
        '<input data-slot="toggle-group-input" type="radio" name="n" value="v" class="sr-only">R&amp;D&#39;s &lt;view&gt;</label>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<ToggleGroup.Item name='n' value='v' data-slot='rail-tool' />)).toBe(
      `<label data-slot="toggle-group-item" class="${itemClass()}">` +
        '<input data-slot="toggle-group-input rail-tool" type="radio" name="n" value="v" class="sr-only"></label>',
    );
  });

  it("renders a whole group in one tree, the shared name binding its items together", async () => {
    expect(
      await render(
        <ToggleGroup aria-label='Views'>
          <ToggleGroup.Item name='view' value='perspective' pressed>
            Perspective
          </ToggleGroup.Item>
          <ToggleGroup.Item name='view' value='parallel'>
            Parallel
          </ToggleGroup.Item>
        </ToggleGroup>,
      ),
    ).toBe(
      `<fieldset data-slot="toggle-group" data-scope="toggle-group" data-orientation="horizontal" class="${GROUP_CLASS}" aria-label="Views">` +
        `<label data-slot="toggle-group-item" class="${itemClass()}">` +
        '<input data-slot="toggle-group-input" type="radio" name="view" value="perspective" class="sr-only" checked>Perspective</label>' +
        `<label data-slot="toggle-group-item" class="${itemClass()}">` +
        '<input data-slot="toggle-group-input" type="radio" name="view" value="parallel" class="sr-only">Parallel</label></fieldset>',
    );
  });
});
