import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Icon } from "./icon";

describe("Icon component", () => {
  it("renders an svg with a use href combining the sprite and symbol", async () => {
    const out = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' />);
    expect(out).toContain("<svg");
    expect(out).toContain('href="/assets/svg/sprite.svg#icon-phone"');
  });

  it("sets aria-hidden=true by default", async () => {
    const out = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' />);
    expect(out).toContain('aria-hidden="true"');
  });

  it("omits aria-hidden and sets aria-label when aria-label is provided", async () => {
    const out = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' aria-label='Phone number' />);
    expect(out).toContain('aria-label="Phone number"');
    expect(out).not.toContain("aria-hidden");
  });

  it("passes through width, height, and viewBox", async () => {
    const out = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' width={80} height={80} viewBox='0 0 80 80' />);
    expect(out).toContain('width="80"');
    expect(out).toContain('height="80"');
    expect(out).toContain('viewBox="0 0 80 80"');
  });

  it("passes through the class attribute", async () => {
    const out = await render(<Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' class='my-icon' />);
    expect(out).toContain('class="my-icon"');
  });

  it("passes through stroke attributes", async () => {
    const out = await render(
      <Icon symbol='icon-phone' sprite='/assets/svg/sprite.svg' stroke='#163030' stroke-width={2} stroke-linecap='round' stroke-linejoin='round' />,
    );
    expect(out).toContain('stroke="#163030"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke-linecap="round"');
    expect(out).toContain('stroke-linejoin="round"');
  });

  it("renders with a fragment-only href when no sprite is provided", async () => {
    const out = await render(<Icon symbol='icon-logo' />);
    expect(out).toContain('href="#icon-logo"');
  });
});
