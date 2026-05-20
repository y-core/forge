import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { html } from "hono/html";
import { IconSpriteProvider, useIconSprite } from "./icon-context";

async function render(element: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(html`${element}`));
  const res = await app.request("/");
  return res.text();
}

function SpritePath() {
  return <span class="sprite-path">{useIconSprite()}</span>;
}

describe("IconSpriteProvider", () => {
  it("provides the sprite path to child components via context", async () => {
    const out = await render(
      <IconSpriteProvider sprite="/custom/sprite.svg">
        <SpritePath />
      </IconSpriteProvider>,
    );
    expect(out).toContain("/custom/sprite.svg");
  });

  it("returns an empty string when no provider wraps the component", async () => {
    const out = await render(<SpritePath />);
    expect(out).toContain('class="sprite-path"');
    expect(out).not.toContain("/sprite.svg");
  });
});
