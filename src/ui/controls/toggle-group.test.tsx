import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { ToggleGroup } from "./toggle-group";

const GROUP_CLASS = "flex justify-center min-w-0 border-0 m-0 p-0";

const ITEM_CLASS =
  "inline-flex items-center justify-center font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm " +
  "bg-transparent border border-input border-s-0 cursor-pointer rounded-none first:border-s first:rounded-s-md " +
  "last:rounded-e-md hover:text-accent-foreground " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-s " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:border-t-0 " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:rounded-none " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:border-t " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:first:rounded-t-md " +
  "[[data-slot~=toggle-group][data-orientation=vertical]_&amp;]:last:rounded-b-md " +
  "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50";

const GROUP_OPEN = `<fieldset data-slot="toggle-group" data-scope="toggle-group" data-orientation="horizontal" class="${GROUP_CLASS}"`;

describe("controls/ToggleGroup.Item", () => {
  it("stamps data-field and data-value on the input bindControls reads", async () => {
    expect(
      await render(
        <ToggleGroup aria-label='Projection'>
          <ToggleGroup.Item bind='projection' value='perspective' pressed>
            Perspective
          </ToggleGroup.Item>
        </ToggleGroup>,
      ),
    ).toBe(
      `${GROUP_OPEN} aria-label="Projection">` +
        `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="projection" value="perspective" class="sr-only" checked ' +
        'data-field="projection" data-value="perspective">Perspective</label></fieldset>',
    );
  });

  it("defaults the input's name to the bound field, so the two cannot drift apart", async () => {
    const out = await render(<ToggleGroup.Item bind='align' value='left' />);

    expect(out).toContain('name="align"');
    expect(out).toContain('data-field="align"');
  });

  it("lets a caller name the group explicitly when it differs from the field", async () => {
    expect(await render(<ToggleGroup.Item bind='align' name='alignment' value='left' />)).toContain('name="alignment"');
  });

  it("does not forward bind as an attribute of its own", async () => {
    const out = await render(<ToggleGroup.Item bind='projection' value='perspective' />);

    expect(out).not.toContain('bind="');
  });

  it("passes pressed, title and data-ref through to the input", async () => {
    const out = await render(
      <ToggleGroup.Item bind='p' value='v' pressed title='Perspective' data-ref='cam-perspective'>
        P
      </ToggleGroup.Item>,
    );

    expect(out).toContain('title="Perspective"');
    expect(out).toContain('data-ref="cam-perspective"');
    expect(out).toContain(" checked ");
  });

  it("forwards an arbitrary data-* attribute, HTML-escaped", async () => {
    expect(await render(<ToggleGroup.Item bind='b' value='v' data-test-hook={`R&D's "v"`} />)).toContain(
      'data-test-hook="R&amp;D&#39;s &quot;v&quot;"',
    );
  });

  it("renders text children beside the visually hidden input", async () => {
    expect(await render(<ToggleGroup.Item bind='b' value='v'>{`R&D's <view>`}</ToggleGroup.Item>)).toBe(
      `<label data-slot="toggle-group-item" class="${ITEM_CLASS}">` +
        '<input data-slot="toggle-group-input" type="radio" name="b" value="v" class="sr-only" data-field="b" data-value="v">' +
        "R&amp;D&#39;s &lt;view&gt;</label>",
    );
  });

  it("root group passes aria-label and data-ref through", async () => {
    expect(await render(<ToggleGroup aria-label='Projection' data-ref='projection-group' />)).toBe(
      `${GROUP_OPEN} aria-label="Projection" data-ref="projection-group"></fieldset>`,
    );
  });
});
