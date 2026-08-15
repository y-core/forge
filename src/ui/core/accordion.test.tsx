/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Accordion } from "./accordion";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg");
const narrowIcon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 24 24", "icon-phone": "0 0 24 24" });

const TRIGGER_CLS =
  "flex items-center gap-2 cursor-pointer list-none select-none py-2 px-1 rounded text-sm font-medium outline-none " +
  "hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring";

const CHEVRON =
  '<svg data-slot="icon" viewBox="0 0 24 24" class="size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-200 ' +
  'group-open/accordion-item:rotate-180" aria-hidden="true"><use href="/sprite.svg#icon-chevron-down"></use></svg>';

const leadGlyph = (name: string) =>
  `<svg data-slot="icon" viewBox="0 0 24 24" class="size-4 shrink-0 text-muted-foreground" aria-hidden="true"><use href="/sprite.svg#icon-${name}"></use></svg>`;

describe("Accordion", () => {
  it("renders the root with data-slot=accordion", async () => {
    expect(await render(<Accordion>content</Accordion>)).toBe('<div data-slot="accordion" class="flex flex-col">content</div>');
  });

  it("merges a custom class on the root", async () => {
    expect(await render(<Accordion class='my-accordion'>content</Accordion>)).toBe(
      '<div data-slot="accordion" class="flex flex-col my-accordion">content</div>',
    );
  });

  it("forwards id and data-* attributes on the root with HTML-escaped values", async () => {
    expect(
      await render(
        <Accordion id='acc1' data-testid='accordion' data-note='a&b'>
          content
        </Accordion>,
      ),
    ).toBe('<div data-slot="accordion" class="flex flex-col" id="acc1" data-testid="accordion" data-note="a&amp;b">content</div>');
  });

  it("forwards id and data-* attributes on the trigger summary", async () => {
    expect(
      await render(
        <Accordion.Trigger icon={icon} id='trg1' data-testid='trigger'>
          Section
        </Accordion.Trigger>,
      ),
    ).toBe(
      '<summary data-slot="accordion-trigger" class="flex items-center gap-2 cursor-pointer list-none select-none py-2 px-1 rounded text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring" id="trg1" data-testid="trigger"><span class="flex-1 ps-1">Section</span><svg data-slot="icon" viewBox="0 0 24 24" class="size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-200 group-open/accordion-item:rotate-180" aria-hidden="true"><use href="/sprite.svg#icon-chevron-down"></use></svg></summary>',
    );
  });

  it("forwards id and data-* attributes on the content", async () => {
    expect(
      await render(
        <Accordion.Content id='cnt1' data-note='a&b'>
          Body
        </Accordion.Content>,
      ),
    ).toBe('<div data-slot="accordion-content" class="px-1 pb-3 pt-1" id="cnt1" data-note="a&amp;b">Body</div>');
  });

  it("renders a closed item carrying only its slot and class", async () => {
    expect(await render(<Accordion.Item>Body</Accordion.Item>)).toBe(
      '<details data-slot="accordion-item" class="group/accordion-item border-b border-border last:border-b-0">Body</details>',
    );
  });

  it("emits the native open attribute for an open item", async () => {
    expect(await render(<Accordion.Item open>Body</Accordion.Item>)).toBe(
      '<details data-slot="accordion-item" open class="group/accordion-item border-b border-border last:border-b-0">Body</details>',
    );
  });
});

describe("Accordion.Trigger glyph typing", () => {
  it("accepts a sheet narrowed to iconName plus its own chevron-down, uncast", async () => {
    expect(
      await render(
        <Accordion.Trigger icon={narrowIcon} iconName='phone'>
          Section
        </Accordion.Trigger>,
      ),
    ).toBe(
      `<summary data-slot="accordion-trigger" class="${TRIGGER_CLS}">${leadGlyph("phone")}` +
        `<span class="flex-1 ps-1">Section</span>${CHEVRON}</summary>`,
    );
  });

  it("rejects an iconName outside the sheet the trigger is parameterised with", async () => {
    expect(
      await render(
        <Accordion.Trigger<"phone">
          icon={narrowIcon}
          // @ts-expect-error — "printer" is not a glyph in the narrowed sheet
          iconName='printer'>
          Section
        </Accordion.Trigger>,
      ),
    ).toBe(
      `<summary data-slot="accordion-trigger" class="${TRIGGER_CLS}">${leadGlyph("printer")}` +
        `<span class="flex-1 ps-1">Section</span>${CHEVRON}</summary>`,
    );
  });
});
