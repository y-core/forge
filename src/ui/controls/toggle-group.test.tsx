import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { buttonVariants } from "../core/button";
import { ToggleGroup } from "./toggle-group";

const GROUP_CLASS = "group/toggle-group flex justify-center min-w-0 border-0 m-0 p-0";

const ITEM_SEGMENT =
  "bg-transparent border-input cursor-pointer rounded-none hover:text-accent-foreground " +
  "group-data-[orientation=horizontal]/toggle-group:border-s-0 " +
  "group-data-[orientation=horizontal]/toggle-group:first:border-s " +
  "group-data-[orientation=horizontal]/toggle-group:first:rounded-s-field " +
  "group-data-[orientation=horizontal]/toggle-group:last:rounded-e-field " +
  "group-data-[orientation=vertical]/toggle-group:border-t-0 " +
  "group-data-[orientation=vertical]/toggle-group:first:border-t " +
  "group-data-[orientation=vertical]/toggle-group:first:rounded-t-field " +
  "group-data-[orientation=vertical]/toggle-group:last:rounded-b-field";

const ITEM_STATE = "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary";

const ITEM_CLASS = buttonVariants({ tone: "neutral", appearance: "ghost", size: "sm", class: `${ITEM_SEGMENT} ${ITEM_STATE}` }).replaceAll(
  "&",
  "&amp;",
);

const GROUP_OPEN = `<fieldset aria-label="Projection" data-slot="toggle-group" data-scope="toggle-group" data-orientation="horizontal" class="${GROUP_CLASS}"`;

describe("controls/ToggleGroup.Item", () => {
  it("stamps data-field and data-value on the input bindControls reads", async () => {
    expect(
      await render(
        <ToggleGroup label='Projection'>
          <ToggleGroup.Item bind='projection' value='perspective' pressed>
            Perspective
          </ToggleGroup.Item>
        </ToggleGroup>,
      ),
    ).toBe(
      `${GROUP_OPEN}>` +
        `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="projection" value="perspective" class="sr-only" checked data-field="projection" data-value="perspective">Perspective</label></fieldset>',
    );
  });

  it("defaults the input's name to the bound field, so the two cannot drift apart", async () => {
    expect(await render(<ToggleGroup.Item bind='align' value='left' />)).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="align" value="left" class="sr-only" ' +
        'data-field="align" data-value="left"></label>',
    );
  });

  it("lets a caller name the group explicitly when it differs from the field", async () => {
    expect(await render(<ToggleGroup.Item bind='align' name='alignment' value='left' />)).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="alignment" value="left" class="sr-only" ' +
        'data-field="align" data-value="left"></label>',
    );
  });

  it("spends bind on data-field and name, forwarding no attribute of its own", async () => {
    expect(await render(<ToggleGroup.Item bind='projection' value='perspective' />)).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="projection" value="perspective" class="sr-only" ' +
        'data-field="projection" data-value="perspective"></label>',
    );
  });

  it("passes pressed, title and data-ref through to the input", async () => {
    expect(
      await render(
        <ToggleGroup.Item bind='p' value='v' pressed title='Perspective' data-ref='cam-perspective'>
          P
        </ToggleGroup.Item>,
      ),
    ).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="p" value="v" class="sr-only" checked ' +
        'title="Perspective" data-ref="cam-perspective" data-field="p" data-value="v">P</label>',
    );
  });

  it("forwards an arbitrary data-* attribute, HTML-escaped", async () => {
    expect(await render(<ToggleGroup.Item bind='b' value='v' data-test-hook={`R&D's "v"`} />)).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="b" value="v" class="sr-only" ' +
        'data-test-hook="R&amp;D&#39;s &quot;v&quot;" data-field="b" data-value="v"></label>',
    );
  });

  it("renders text children beside the visually hidden input", async () => {
    expect(await render(<ToggleGroup.Item bind='b' value='v'>{`R&D's <view>`}</ToggleGroup.Item>)).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="b" value="v" class="sr-only" data-field="b" data-value="v">R&amp;D&#39;s &lt;view&gt;</label>',
    );
  });

  it("root group passes aria-label and data-ref through", async () => {
    expect(await render(<ToggleGroup label='Projection' data-ref='projection-group' />)).toBe(
      `${GROUP_OPEN} data-ref="projection-group"></fieldset>`,
    );
  });
});
