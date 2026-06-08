import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { createIcon } from "../core/icon";
import { ThemeToggle } from "./theme-toggle";

const icon = createIcon("/sprite.svg", { "icon-sun": "0 0 24 24", "icon-moon": "0 0 24 24", "icon-monitor": "0 0 24 24" });

describe("ThemeToggle", () => {
  it("renders the theme-toggle button hook", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} />));
    expect(html).toContain('data-ref="theme-toggle"');
    expect(html).toContain('aria-label="Toggle theme"');
  });

  it("renders the three icon-visibility spans the theme CSS keys off", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} />));
    expect(html).toContain('class="theme-light-icon"');
    expect(html).toContain('class="theme-dark-icon"');
    expect(html).toContain('class="theme-system-icon"');
  });

  it("renders sun, moon, and monitor via sprite <use> references", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} />));
    expect(html).toContain('href="/sprite.svg#icon-sun"');
    expect(html).toContain('href="/sprite.svg#icon-moon"');
    expect(html).toContain('href="/sprite.svg#icon-monitor"');
  });

  it("merges a custom class onto the button", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} class='ml-2' />));
    expect(html).toContain("ml-2");
    expect(html).toContain("rounded-lg");
  });
});
