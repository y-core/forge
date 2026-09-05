/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import type { Appearance, Size } from "../contracts/vocabulary";
import { buttonVariants } from "./button";
import { Filter } from "./filter";

const ROOT_CLASS = "group/filter m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0";

const ITEM_STATE =
  "cursor-pointer has-[:checked]:border-primary group-has-[:checked]/filter:not-has-[:checked]:hidden " +
  "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary";

const RESET_STATE = "hidden group-has-[:checked]/filter:inline-flex";

function itemClass(size: Size = "sm", appearance: Appearance = "ghost", extra = ""): string {
  return buttonVariants({ tone: "neutral", appearance, size, class: `${ITEM_STATE}${extra}` }).replaceAll("&", "&amp;");
}

function resetClass(size: Size = "sm", extra = ""): string {
  return buttonVariants({ tone: "neutral", appearance: "ghost", size, shape: "circle", class: `${RESET_STATE}${extra}` }).replaceAll("&", "&amp;");
}

describe("Filter", () => {
  it("root is its own form, so the reset button has a form owner without nesting", async () => {
    expect(await render(<Filter aria-label='Category' />)).toBe(`<form data-slot="filter" class="${ROOT_CLASS}" aria-label="Category"></form>`);
  });

  it("nested renders a fieldset for a filter inside the consumer's form, merging a caller class last and escaping forwarded values", async () => {
    expect(await render(<Filter nested class='w-40' id='x' data-slot='facets' data-note='a&b' />)).toBe(
      `<fieldset data-slot="filter facets" class="${ROOT_CLASS} w-40" id="x" data-note="a&amp;b"></fieldset>`,
    );
  });

  it("an item is a chip-painted label over a visually hidden radio, hidden by the first group-has-[:checked] variant in the repo once a sibling is chosen", async () => {
    expect(
      await render(
        <Filter.Item name='f' value='a'>
          A
        </Filter.Item>,
      ),
    ).toBe(
      `<label data-slot="filter-item" class="${itemClass()}"><input data-slot="filter-input" type="radio" name="f" value="a" class="sr-only">A</label>`,
    );
  });

  it("checked stamps the native attribute, which is the state the reset restores", async () => {
    expect(
      await render(
        <Filter.Item name='f' value='a' checked>
          A
        </Filter.Item>,
      ),
    ).toBe(
      `<label data-slot="filter-item" class="${itemClass()}"><input data-slot="filter-input" type="radio" name="f" value="a" class="sr-only" checked>A</label>`,
    );
  });

  it("size and appearance repaint the chip; a caller class merges last and forwarded attributes land on the radio, escaped", async () => {
    expect(
      await render(
        <Filter.Item name='f' value='a' size='md' appearance='soft' class='p-99' data-slot='chip' disabled data-note='a&b'>
          {`R&D's`}
        </Filter.Item>,
      ),
    ).toBe(
      `<label data-slot="filter-item" class="${itemClass("md", "soft", " p-99")}">` +
        `<input data-slot="filter-input chip" type="radio" name="f" value="a" class="sr-only" disabled data-note="a&amp;b">R&amp;D&#39;s</label>`,
    );
  });

  it("the reset is a type=reset circle shown by group-has-[:checked], named by an sr-only Clear beside a hidden glyph", async () => {
    expect(await render(<Filter.Reset />)).toBe(
      `<button type="reset" data-slot="filter-reset" class="${resetClass()}"><span class="sr-only">Clear</span><span aria-hidden="true">×</span></button>`,
    );
  });

  it("an aria-label on the reset replaces the sr-only text; size, class and forwarded attributes apply", async () => {
    expect(await render(<Filter.Reset aria-label={`R&D's`} size='lg' class='p-99' data-slot='x' data-note='a&b' />)).toBe(
      `<button type="reset" data-slot="filter-reset x" aria-label="R&amp;D&#39;s" class="${resetClass("lg", " p-99")}" data-note="a&amp;b"><span aria-hidden="true">×</span></button>`,
    );
  });

  it("caller children replace the reset's default content", async () => {
    expect(await render(<Filter.Reset>Clear</Filter.Reset>)).toBe(
      `<button type="reset" data-slot="filter-reset" class="${resetClass()}">Clear</button>`,
    );
  });

  it("composes reset and items inside the form", async () => {
    expect(
      await render(
        <Filter>
          <Filter.Reset />
          <Filter.Item name='f' value='a' checked>
            A
          </Filter.Item>
          <Filter.Item name='f' value='b'>
            B
          </Filter.Item>
        </Filter>,
      ),
    ).toBe(
      `<form data-slot="filter" class="${ROOT_CLASS}">` +
        `<button type="reset" data-slot="filter-reset" class="${resetClass()}"><span class="sr-only">Clear</span><span aria-hidden="true">×</span></button>` +
        `<label data-slot="filter-item" class="${itemClass()}"><input data-slot="filter-input" type="radio" name="f" value="a" class="sr-only" checked>A</label>` +
        `<label data-slot="filter-item" class="${itemClass()}"><input data-slot="filter-input" type="radio" name="f" value="b" class="sr-only">B</label>` +
        `</form>`,
    );
  });
});
