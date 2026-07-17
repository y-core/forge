/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { renderToString } from "../../jsx/render-to-string";
import { createIcon } from "../core/icon";
import { ThemeToggle } from "./theme-toggle";

const icon = createIcon("/sprite.svg", { "icon-sun": "0 0 24 24", "icon-moon": "0 0 24 24", "icon-monitor": "0 0 24 24" });

describe("ThemeToggle", () => {
  it("renders the resumable theme scope with the cycleTheme button and sun/moon/monitor sprite icons", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} />));
    expect(html).toBe(
      '<div data-scope="theme" data-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" aria-label="Toggle theme" class="rounded-lg p-2 text-foreground transition hover:bg-accent" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg></span><span class="theme-dark-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg></span><span class="theme-system-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg></span></button></div>',
    );
  });

  it("merges a custom class onto the button", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} class='ml-2' />));
    expect(html).toBe(
      '<div data-scope="theme" data-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" aria-label="Toggle theme" class="rounded-lg p-2 text-foreground transition hover:bg-accent ml-2" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg></span><span class="theme-dark-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg></span><span class="theme-system-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg></span></button></div>',
    );
  });
});
