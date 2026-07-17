import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon, type ForgeIcon, Icon } from "./icon";

describe("Icon component", () => {
  it("renders an svg with a use href combining the sprite and symbol", async () => {
    expect(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' />)).toBe(
      '<svg data-slot="icon" class="" aria-hidden="true"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("sets aria-hidden=true and no role by default (decorative)", async () => {
    expect(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' />)).toBe(
      '<svg data-slot="icon" class="" aria-hidden="true"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("omits aria-hidden and sets aria-label + role=img when aria-label is provided", async () => {
    expect(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' aria-label='Phone number' />)).toBe(
      '<svg data-slot="icon" class="" aria-label="Phone number" role="img"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("passes through width, height, and viewBox", async () => {
    expect(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' width={80} height={80} viewBox='0 0 80 80' />)).toBe(
      '<svg data-slot="icon" width="80" height="80" viewBox="0 0 80 80" class="" aria-hidden="true"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("passes through the class attribute", async () => {
    expect(await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' class='my-icon' />)).toBe(
      '<svg data-slot="icon" class="my-icon" aria-hidden="true"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("passes through stroke attributes", async () => {
    expect(
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
    ).toBe(
      '<svg data-slot="icon" class="" aria-hidden="true" stroke="#163030" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="/assets/svg/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("renders with a fragment-only href when no sprite is provided", async () => {
    expect(await render(<Icon symbol='icon-logo' />)).toBe('<svg data-slot="icon" class="" aria-hidden="true"><use href="#icon-logo"></use></svg>');
  });
});

describe("createIcon", () => {
  it("binds a sprite + meta and resolves the viewBox from meta", async () => {
    const AppIcon = createIcon("/assets/sprite.svg", { "icon-phone": "0 0 24 24" });
    expect(await render(<AppIcon name='phone' />)).toBe(
      '<svg data-slot="icon" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/assets/sprite.svg#icon-phone"></use></svg>',
    );
  });

  it("without meta accepts any name and resolves the viewBox from the prop", async () => {
    const AppIcon = createIcon("/assets/sprite.svg");
    expect(await render(<AppIcon name='dynamic-tool' viewBox='0 0 32 32' />)).toBe(
      '<svg data-slot="icon" viewBox="0 0 32 32" class="" aria-hidden="true"><use href="/assets/sprite.svg#icon-dynamic-tool"></use></svg>',
    );
  });

  it("yields a ForgeIcon<string> assignable to a narrower ForgeIcon (contravariance)", () => {
    const wide = createIcon("/assets/sprite.svg");
    const narrow: ForgeIcon<"chevron-down"> = wide;
    expect(typeof narrow).toBe("function");
  });
});
