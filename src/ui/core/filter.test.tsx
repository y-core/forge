/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Button } from "./button";
import { attrsOf, classesOf, tagOf, variantClasses } from "./core.fixture";
import { Filter } from "./filter";

type ItemProps = Parameters<typeof Filter.Item>[0];
type ResetProps = Parameters<typeof Filter.Reset>[0];
type ButtonProps = Parameters<typeof Button>[0];

const item = (props: Omit<Partial<ItemProps>, "name" | "value"> = {}) =>
  render(
    <Filter.Item name='f' value='a' {...props}>
      A
    </Filter.Item>,
  );
const reset = (props: ResetProps = {}) => render(<Filter.Reset {...props} />);
const chip = (props: ButtonProps = {}) => render(<Button tone='neutral' appearance='ghost' size='sm' {...props} />);
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1]);
const textNodes = (html: string) => html.split(/<[^>]+>/).filter(Boolean);

describe("Filter", () => {
  it("renders the nested fieldset exactly — the filter inside a consumer's own form — with forwarded values escaped", async () => {
    expect(await render(<Filter nested class='w-40' id='x' data-slot='facets' data-note={`R&D's <x>`} />)).toBe(
      '<fieldset data-slot="filter facets" class="group/filter m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0 w-40"' +
        ' id="x" data-note="R&amp;D&#39;s &lt;x&gt;"></fieldset>',
    );
  });

  it("is its own form by default, so the reset button has a form owner without nesting one", async () => {
    const html = await render(<Filter aria-label='Category' />);

    expect(tagOf(html).startsWith("<form ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "filter", "aria-label": "Category" });
  });

  it("an item is a label wrapping a visually hidden radio, so the chip itself is the hit target", async () => {
    const html = await item();

    expect(tagOf(html).startsWith("<label ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "filter-item" });
    expect(attrsOf(html, 'data-slot="filter-input"')).toEqual({ "data-slot": "filter-input", type: "radio", name: "f", value: "a" });
    expect(classesOf(html, 'data-slot="filter-input"')).toEqual(["sr-only"]);
  });

  it("paints the chip as a ghost button plus the rules that hide the unchosen and light the chosen", async () => {
    expect(variantClasses(await item(), await chip())).toEqual({
      added: [
        "cursor-pointer",
        "has-[:checked]:border-primary",
        "group-has-[:checked]/filter:not-has-[:checked]:hidden",
        "has-[:checked]:bg-primary",
        "has-[:checked]:text-primary-foreground",
        "has-[:checked]:hover:bg-primary",
      ],
      dropped: [],
    });
  });

  it("checked stamps the native attribute, which is the state the reset restores", async () => {
    expect(attrsOf(await item({ checked: true }), 'data-slot="filter-input"')).toEqual({
      "data-slot": "filter-input",
      type: "radio",
      name: "f",
      value: "a",
      checked: "",
    });
  });

  it("moves the chip along the button's own size and appearance scales rather than a second one", async () => {
    expect(variantClasses(await item({ size: "md", appearance: "soft" }), await item())).toEqual(
      variantClasses(await chip({ size: "md", appearance: "soft" }), await chip()),
    );
  });

  it("merges a caller class last and lands forwarded attributes on the radio, escaped", async () => {
    const html = await render(
      <Filter.Item name='f' value='a' class='p-99' data-slot='chip' disabled data-note='a&b'>
        {`R&D's`}
      </Filter.Item>,
    );

    expect(classesOf(html).at(-1)).toBe("p-99");
    expect(attrsOf(html, 'data-slot="filter-input chip"')).toEqual({
      "data-slot": "filter-input chip",
      type: "radio",
      name: "f",
      value: "a",
      disabled: "",
      "data-note": "a&amp;b",
    });
    expect(textNodes(html)).toEqual(["R&amp;D&#39;s"]);
  });

  it("the reset is a native type=reset, named by an sr-only Clear beside a glyph no screen reader reads", async () => {
    const html = await reset();

    expect(attrsOf(html)).toEqual({ type: "reset", "data-slot": "filter-reset" });
    expect(textNodes(html)).toEqual(["Clear", "×"]);
    expect(attrsOf(html, 'aria-hidden="true"')).toEqual({ "aria-hidden": "true" });
  });

  it("keeps the reset out of the way until something is chosen, evicting the button's own display", async () => {
    expect(variantClasses(await reset(), await chip({ shape: "circle" }))).toEqual({
      added: ["hidden", "group-has-[:checked]/filter:inline-flex"],
      dropped: ["inline-flex"],
    });
  });

  it("sizes the reset on the button's own scale", async () => {
    expect(variantClasses(await reset({ size: "lg" }), await reset())).toEqual(
      variantClasses(await chip({ size: "lg", shape: "circle" }), await chip({ shape: "circle" })),
    );
  });

  it("an aria-label on the reset replaces the sr-only text rather than doubling it", async () => {
    const html = await reset({ "aria-label": `R&D's`, class: "p-99", "data-slot": "x", "data-note": "a&b" });

    expect(attrsOf(html)).toEqual({ type: "reset", "data-slot": "filter-reset x", "aria-label": "R&amp;D&#39;s", "data-note": "a&amp;b" });
    expect(textNodes(html)).toEqual(["×"]);
    expect(classesOf(html).at(-1)).toBe("p-99");
  });

  it("caller children replace the reset's default content entirely", async () => {
    const html = await reset({ children: "Clear" });

    expect(textNodes(html)).toEqual(["Clear"]);
    expect(attrsOf(html, 'aria-hidden="true"')).toEqual({});
  });

  it("composes the reset and its items as siblings inside the one form", async () => {
    const html = await render(
      <Filter>
        <Filter.Reset />
        <Filter.Item name='f' value='a' checked>
          A
        </Filter.Item>
        <Filter.Item name='f' value='b'>
          B
        </Filter.Item>
      </Filter>,
    );

    expect(slotsOf(html)).toEqual(["filter", "filter-reset", "filter-item", "filter-input", "filter-item", "filter-input"]);
    expect(textNodes(html)).toEqual(["Clear", "×", "A", "B"]);
  });
});
