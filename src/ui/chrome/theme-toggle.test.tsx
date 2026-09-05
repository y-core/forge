/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { renderToString } from "../../jsx/render-to-string";
import { THEME_SCOPE } from "../contracts/theme-toggle-contract";
import { createIcon } from "../core/icon";
import { ThemeToggle } from "./theme-toggle";

const icon = createIcon("/sprite.svg", { "icon-sun": "0 0 24 24", "icon-moon": "0 0 24 24", "icon-monitor": "0 0 24 24" });

describe("ThemeToggle", () => {
  it("renders the resumable theme scope with the cycleTheme button and sun/moon/monitor sprite icons", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} />));
    expect(html).toBe(
      `<div data-scope="${THEME_SCOPE}" data-island-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" class="rounded-field p-2 text-foreground focus-ring hover:bg-accent motion-safe:transition" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg><span class="sr-only">Switch theme — currently light</span></span><span class="theme-dark-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg><span class="sr-only">Switch theme — currently dark</span></span><span class="theme-system-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg><span class="sr-only">Switch theme — currently system</span></span></button></div>`,
    );
  });

  it("renders a 16px icon at size sm", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} size='sm' />));
    expect(html).toBe(
      `<div data-scope="${THEME_SCOPE}" data-island-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" class="rounded-field p-2 text-foreground focus-ring hover:bg-accent motion-safe:transition" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="16" height="16" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg><span class="sr-only">Switch theme — currently light</span></span><span class="theme-dark-icon"><svg data-slot="icon" width="16" height="16" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg><span class="sr-only">Switch theme — currently dark</span></span><span class="theme-system-icon"><svg data-slot="icon" width="16" height="16" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg><span class="sr-only">Switch theme — currently system</span></span></button></div>`,
    );
  });

  it("renders a 20px icon at size md, the default", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} size='md' />));
    expect(html).toBe(
      `<div data-scope="${THEME_SCOPE}" data-island-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" class="rounded-field p-2 text-foreground focus-ring hover:bg-accent motion-safe:transition" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg><span class="sr-only">Switch theme — currently light</span></span><span class="theme-dark-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg><span class="sr-only">Switch theme — currently dark</span></span><span class="theme-system-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg><span class="sr-only">Switch theme — currently system</span></span></button></div>`,
    );
  });

  it("renders a 24px icon at size lg", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} size='lg' />));
    expect(html).toBe(
      `<div data-scope="${THEME_SCOPE}" data-island-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" class="rounded-field p-2 text-foreground focus-ring hover:bg-accent motion-safe:transition" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="24" height="24" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg><span class="sr-only">Switch theme — currently light</span></span><span class="theme-dark-icon"><svg data-slot="icon" width="24" height="24" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg><span class="sr-only">Switch theme — currently dark</span></span><span class="theme-system-icon"><svg data-slot="icon" width="24" height="24" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg><span class="sr-only">Switch theme — currently system</span></span></button></div>`,
    );
  });

  it("merges a custom class onto the button", async () => {
    const html = String(await renderToString(<ThemeToggle icon={icon} class='ms-2' />));
    expect(html).toBe(
      `<div data-scope="${THEME_SCOPE}" data-island-state="{&quot;pref&quot;:&quot;system&quot;}"><button type="button" class="rounded-field p-2 text-foreground focus-ring hover:bg-accent motion-safe:transition ms-2" data-on-click="cycleTheme"><span class="theme-light-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-sun"></use></svg><span class="sr-only">Switch theme — currently light</span></span><span class="theme-dark-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-moon"></use></svg><span class="sr-only">Switch theme — currently dark</span></span><span class="theme-system-icon"><svg data-slot="icon" width="20" height="20" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-monitor"></use></svg><span class="sr-only">Switch theme — currently system</span></span></button></div>`,
    );
  });
});
