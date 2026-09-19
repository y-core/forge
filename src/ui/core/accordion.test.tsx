/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrsOf, classesOf, tagOf } from "../../testing/markup";
import { render } from "../../testing/render";
import { Accordion } from "./accordion";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg");
const narrowIcon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 24 24", "icon-phone": "0 0 24 24" });

const spriteRefs = (html: string) => [...html.matchAll(/<use href="([^"]*)"/g)].map((match) => match[1]);
const textNodes = (html: string) => html.split(/<[^>]+>/).filter(Boolean);

describe("Accordion", () => {
  it("renders the whole root exactly, forwarded attributes escaped", async () => {
    expect(
      await render(
        <Accordion id='acc1' data-testid='accordion' data-note={`R&D's <x>`}>
          content
        </Accordion>,
      ),
    ).toBe('<div data-slot="accordion" class="flex flex-col" id="acc1" data-testid="accordion" data-note="R&amp;D&#39;s &lt;x&gt;">content</div>');
  });

  it("stacks its items in a column, carrying nothing but its slot", async () => {
    const html = await render(<Accordion>content</Accordion>);

    expect(attrsOf(html)).toEqual({ "data-slot": "accordion" });
    expect(textNodes(html)).toEqual(["content"]);
  });

  it("appends a caller class after its own, so the caller's wins a conflict", async () => {
    expect(classesOf(await render(<Accordion class='my-accordion'>content</Accordion>)).at(-1)).toBe("my-accordion");
  });

  it("forwards attributes onto the trigger summary rather than swallowing them", async () => {
    const html = await render(
      <Accordion.Trigger icon={icon} id='trg1' data-testid='trigger'>
        Section
      </Accordion.Trigger>,
    );

    expect(tagOf(html).startsWith("<summary ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "accordion-trigger", id: "trg1", "data-testid": "trigger" });
  });

  it("forwards attributes onto the content, escaped", async () => {
    expect(
      attrsOf(
        await render(
          <Accordion.Content id='cnt1' data-note='a&b'>
            Body
          </Accordion.Content>,
        ),
      ),
    ).toEqual({ "data-slot": "accordion-content", id: "cnt1", "data-note": "a&amp;b" });
  });

  it("renders a closed item, which is a details element carrying no open attribute", async () => {
    const html = await render(<Accordion.Item>Body</Accordion.Item>);

    expect(tagOf(html).startsWith("<details ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "accordion-item" });
  });

  it("emits the native open attribute for an open item, which is what actually holds it open", async () => {
    expect(attrsOf(await render(<Accordion.Item open>Body</Accordion.Item>))).toEqual({ "data-slot": "accordion-item", open: "" });
  });
});

describe("Accordion.Trigger glyph typing", () => {
  it("accepts a sheet narrowed to iconName plus its own chevron-down, uncast, and leads with that glyph", async () => {
    const html = await render(
      <Accordion.Trigger icon={narrowIcon} iconName='phone'>
        Section
      </Accordion.Trigger>,
    );

    expect(spriteRefs(html)).toEqual(["/sprite.svg#icon-phone", "/sprite.svg#icon-chevron-down"]);
    expect(textNodes(html)).toEqual(["Section"]);
  });

  it("rejects an iconName outside the sheet the trigger is parameterised with", async () => {
    const html = await render(
      <Accordion.Trigger<"phone">
        icon={narrowIcon}
        // @ts-expect-error — "printer" is not a glyph in the narrowed sheet
        iconName='printer'>
        Section
      </Accordion.Trigger>,
    );

    expect(spriteRefs(html)).toEqual(["/sprite.svg#icon-printer", "/sprite.svg#icon-chevron-down"]);
  });
});
