import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, tagOf } from "./core.fixture";
import { createIcon, Icon } from "./icon";
import type { ForgeIcon } from "./types";

const symbolRef = (html: string) => /<use href="([^"]*)"/.exec(html)?.[1] ?? "";

describe("Icon component", () => {
  it("renders the whole icon exactly — an svg wrapping one sprite reference, decorative by default", async () => {
    expect(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' />)).toBe(
      '<svg data-slot="icon" class="" aria-hidden="true"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("combines the sprite and the symbol into one href, which is what the browser fetches", async () => {
    const html = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' />);

    expect(tagOf(html).startsWith("<svg ")).toBe(true);
    expect(symbolRef(html)).toBe("/assets/svg/sprite.svg#icon-phone");
  });

  it("names itself and takes role=img once given a label, dropping the aria-hidden that would silence it", async () => {
    expect(attrsOf(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' aria-label='Phone number' />))).toEqual({
      "data-slot": "icon",
      "aria-label": "Phone number",
      role: "img",
    });
  });

  it("passes through width, height, and viewBox", async () => {
    const html = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' width={80} height={80} viewBox='0 0 80 80' />);

    expect([attrOf(html, "width"), attrOf(html, "height"), attrOf(html, "viewBox")]).toEqual(["80", "80", "0 0 80 80"]);
  });

  it("passes through the class attribute", async () => {
    expect(classesOf(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' class='my-icon' />))).toEqual(["my-icon"]);
  });

  it("passes through stroke attributes, which is how a sheet of outline glyphs is themed", async () => {
    expect(
      attrsOf(
        await render(
          <Icon
            symbol='icon-phone'
            sprite='/assets/svg/sprite.svg'
            stroke='#163030'
            stroke-width={2}
            stroke-linecap='round'
            stroke-linejoin='round'
          />,
        ),
      ),
    ).toEqual({
      "data-slot": "icon",
      "aria-hidden": "true",
      stroke: "#163030",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  });

  it("renders with a fragment-only href when no sprite is provided", async () => {
    expect(symbolRef(await render(<Icon symbol='icon-logo' />))).toBe("#icon-logo");
  });
});

describe("createIcon", () => {
  it("binds a sprite + meta and resolves the viewBox from meta", async () => {
    const AppIcon = createIcon("/assets/sprite.svg", { "icon-phone": "0 0 24 24" });
    const html = await render(<AppIcon name='phone' />);

    expect(symbolRef(html)).toBe("/assets/sprite.svg#icon-phone");
    expect(attrOf(html, "viewBox")).toBe("0 0 24 24");
  });

  it("without meta accepts any name and resolves the viewBox from the prop", async () => {
    const AppIcon = createIcon("/assets/sprite.svg");
    const html = await render(<AppIcon name='dynamic-tool' viewBox='0 0 32 32' />);

    expect(symbolRef(html)).toBe("/assets/sprite.svg#icon-dynamic-tool");
    expect(attrOf(html, "viewBox")).toBe("0 0 32 32");
  });

  it("yields a ForgeIcon<string> assignable to a narrower ForgeIcon (contravariance)", () => {
    const wide = createIcon("/assets/sprite.svg");
    const narrow: ForgeIcon<"chevron-down"> = wide;
    expect(typeof narrow).toBe("function");
  });

  it("narrows a multi-symbol sheet to the union of its meta names, each with its own viewBox", async () => {
    const AppIcon = createIcon("/assets/sprite.svg", { "icon-chevron-down": "0 0 24 24", "icon-plus": "0 0 16 16" });
    const Narrowed: ForgeIcon<"chevron-down" | "plus"> = AppIcon;
    const html = await render(<Narrowed name='plus' />);

    expect(symbolRef(html)).toBe("/assets/sprite.svg#icon-plus");
    expect(attrOf(html, "viewBox")).toBe("0 0 16 16");
  });

  it("rejects a name absent from the sheet's meta, which would otherwise render an empty symbol", async () => {
    const AppIcon = createIcon("/assets/sprite.svg", { "icon-chevron-down": "0 0 24 24", "icon-plus": "0 0 16 16" });
    const html = await render(
      <AppIcon
        // @ts-expect-error — "typo" is not a symbol in the bound sheet
        name='typo'
      />,
    );

    expect(symbolRef(html)).toBe("/assets/sprite.svg#icon-typo");
    expect(attrOf(html, "viewBox")).toBe("");
  });
});
