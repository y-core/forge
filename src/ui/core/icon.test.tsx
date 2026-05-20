import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { Icon } from "./icon";
import { IconSpriteProvider } from "./icon-context";

async function render(element: Child): Promise<string> {
  const app = new Hono();
  app.get("/", (c) =>
    c.html(<IconSpriteProvider sprite="/assets/svg/sprite.svg">{element}</IconSpriteProvider>),
  );
  const res = await app.request("/");
  return res.text();
}

describe("Icon component", () => {
  it("renders an svg with a use href pointing to the default sprite and symbol", async () => {
    const out = await render(<Icon symbol="icon-phone" />);
    expect(out).toContain("<svg");
    expect(out).toContain('href="/assets/svg/sprite.svg#icon-phone"');
  });

  it("sets aria-hidden=true by default", async () => {
    const out = await render(<Icon symbol="icon-phone" />);
    expect(out).toContain('aria-hidden="true"');
  });

  it("omits aria-hidden and sets aria-label when aria-label is provided", async () => {
    const out = await render(<Icon symbol="icon-phone" aria-label="Phone number" />);
    expect(out).toContain('aria-label="Phone number"');
    expect(out).not.toContain("aria-hidden");
  });

  it("passes through width, height, and viewBox", async () => {
    const out = await render(
      <Icon symbol="icon-phone" width={80} height={80} viewBox="0 0 80 80" />,
    );
    expect(out).toContain('width="80"');
    expect(out).toContain('height="80"');
    expect(out).toContain('viewBox="0 0 80 80"');
  });

  it("passes through the class attribute", async () => {
    const out = await render(<Icon symbol="icon-phone" class="my-icon" />);
    expect(out).toContain('class="my-icon"');
  });

  it("passes through stroke attributes", async () => {
    const out = await render(
      <Icon
        symbol="icon-phone"
        stroke="#163030"
        stroke-width={2}
        stroke-linecap="round"
        stroke-linejoin="round"
      />,
    );
    expect(out).toContain('stroke="#163030"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke-linecap="round"');
    expect(out).toContain('stroke-linejoin="round"');
  });

  it("uses a custom sprite path when provided", async () => {
    const out = await render(
      <Icon symbol="illus-hero" sprite="/assets/svg/custom.svg" />,
    );
    expect(out).toContain('href="/assets/svg/custom.svg#illus-hero"');
    expect(out).not.toContain("sprite.svg");
  });
});
