import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "../core/icon";
import { Navbar, type NavDefinition } from "./navbar";

/**
 * `Navbar` driven as a consumer gets it: the real SSR markup, the real scopes, real keys.
 *
 * The SSR tests next door prove the server emitted the markup it promised. These prove the markup
 * *behaves* — that a bar menu is a real menu with arrow navigation and focus restoration, that a
 * submenu opens without taking its parent down with it, and that a nested leaf is still a link.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeChromeClient: "./ui/chrome/client" } };

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-hamburger": "0 0 22 22", "icon-close": "0 0 22 22" });

const CONFIG: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Home", href: "home" },
        {
          label: "File",
          items: [
            { label: "New", href: "new" },
            { label: "Open", href: "open" },
            {
              label: "Recent",
              items: [
                { label: "alpha", href: "alpha" },
                { label: "beta", href: "beta" },
              ],
            },
            { label: "Quit", href: "quit" },
          ],
        },
      ],
    },
  ],
};

/**
 * The one rule from `ui/assets/css/forge-ui.css` this component cannot work without.
 *
 * The navbar renders its desktop bar from a *closed* `<details>`, and Chromium wraps a closed
 * details' content in `::details-content { content-visibility: hidden }` — an ancestor-level gate
 * that suppresses the bar no matter what its own `display` says. Stating the rule here rather than
 * loading the whole stylesheet keeps the dependency visible: without it every case below fails on
 * "element is not visible", which is a fact about the UA, not about the navbar.
 */
const DETAILS_CONTENT_RULE = '<style>[data-slot="navbar"]::details-content { content-visibility: visible }</style>';

async function mountNavbar(page: Page, config: NavDefinition = CONFIG): Promise<void> {
  const html = await render(Navbar({ config, resolveHref: (key: string) => `#${key}`, icon }));
  await mount(page, `${DETAILS_CONTENT_RULE}<a id="before" href="#before">before</a>${html}`, EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

function focusedText(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.activeElement?.textContent?.trim());
}

function isOpen(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sel) => document.querySelector(sel)?.matches(":popover-open") ?? false, `#${id}`);
}

test.describe("Navbar — anatomy the bar actually claims", () => {
  test("the bar is not a menubar, because there is no controller to back one", async ({ page }) => {
    await mountNavbar(page);

    const roles = await page.evaluate(() => ({
      menubar: document.querySelectorAll("[role='menubar']").length,
      menus: document.querySelectorAll("[role='menu']").length,
      barLink: document.querySelector("[data-slot='navbar-link']")?.getAttribute("role"),
    }));

    // A bar link is a link, not a menu item; announcing a menubar without roving focus among its
    // triggers would promise a keyboard interface that is not there.
    expect(roles).toEqual({ menubar: 0, menus: 2, barLink: null });
  });

  test("a bar menu's popup publishes its open state, and the state updates", async ({ page }) => {
    await mountNavbar(page);

    const before = await page.evaluate(() => {
      const el = document.querySelector("#navbar-menu-top-0");
      return { open: el?.hasAttribute("data-open"), closed: el?.hasAttribute("data-closed") };
    });
    await page.click("[data-slot='menu-trigger']");
    const after = await page.evaluate(() => {
      const el = document.querySelector("#navbar-menu-top-0");
      return { open: el?.hasAttribute("data-open"), closed: el?.hasAttribute("data-closed") };
    });

    // Before the rebuild the popup carried a `data-closed` that nothing ever updated, because
    // nothing mounted transition state for it — the attribute was decoration, not state.
    expect(before).toEqual({ open: false, closed: true });
    expect(after).toEqual({ open: true, closed: false });
  });

  test("a nested leaf is a menu item and still a real link", async ({ page }) => {
    await mountNavbar(page);

    const leaf = await page.evaluate(() => {
      const el = document.querySelector("#navbar-menu-top-0 [data-slot='menu-link-item']");
      return { tag: el?.tagName, role: el?.getAttribute("role"), href: el?.getAttribute("href") };
    });

    expect(leaf).toEqual({ tag: "A", role: "menuitem", href: "#new" });
  });
});

test.describe("Navbar — keyboard", () => {
  test("opening a bar menu focuses its first row", async ({ page }) => {
    await mountNavbar(page);

    await page.click("[data-slot='menu-trigger']");

    await expect.poll(() => focusedText(page)).toBe("New");
  });

  test("arrow keys walk the menu, including the submenu trigger", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedText(page)).toBe("New");

    await page.keyboard.press("ArrowDown");
    expect(await focusedText(page)).toBe("Open");
    await page.keyboard.press("ArrowDown");
    expect(await focusedText(page)).toBe("Recent");
    await page.keyboard.press("ArrowDown");
    // The closed submenu's own rows are not in this ring — the visibility filter keeps them out.
    expect(await focusedText(page)).toBe("Quit");
  });

  test("Escape returns focus to the bar trigger", async ({ page }) => {
    await mountNavbar(page);
    await page.focus("[data-slot='menu-trigger']");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedText(page)).toBe("New");

    await page.keyboard.press("Escape");

    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-trigger");
  });
});

test.describe("Navbar — submenus", () => {
  test("opening a submenu leaves its parent open", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot='menu-trigger']");

    await page.click("[data-slot='menu-submenu-trigger']");

    await expect.poll(() => isOpen(page, "navbar-menu-top-1")).toBe(true);
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(true);
  });

  test("Escape closes only the innermost menu", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot='menu-trigger']");
    await page.click("[data-slot='menu-submenu-trigger']");
    await expect.poll(() => focusedText(page)).toBe("alpha");

    await page.keyboard.press("Escape");

    await expect.poll(() => isOpen(page, "navbar-menu-top-1")).toBe(false);
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(true);
  });
});

test.describe("Navbar — light dismiss", () => {
  test("a click outside closes the menu, with no outside-click listener of forge's own", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot='menu-trigger']");
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(true);

    await page.click("#before");

    // The Popover API's own light-dismiss. The scope installs no document click listener to do
    // this, which is a claim only expressible against real behaviour — an absent listener asserted
    // against a stub proves nothing about the browser.
    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(false);
  });

  test("closing the parent closes the submenu with it", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot='menu-trigger']");
    await page.click("[data-slot='menu-submenu-trigger']");
    await expect.poll(() => isOpen(page, "navbar-menu-top-1")).toBe(true);

    await page.click("#before");

    await expect.poll(() => isOpen(page, "navbar-menu-top-1")).toBe(false);
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(false);
  });
});

test.describe("Navbar — hidden items stay out of the keyboard ring", () => {
  test("a filtered-out row is skipped by the arrow keys", async ({ page }) => {
    await mountNavbar(page, {
      sections: [
        {
          items: [
            {
              label: "File",
              items: [
                { label: "New", href: "new" },
                { label: "Admin", href: "admin", filters: ["admin"] },
                { label: "Quit", href: "quit" },
              ],
            },
          ],
        },
      ],
    });

    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedText(page)).toBe("New");
    await page.keyboard.press("ArrowDown");

    // `Admin` is server-seeded `hidden` because no active token matches it. A hidden row that stayed
    // in the ring would swallow the keystroke and focus would appear to stick.
    expect(await focusedText(page)).toBe("Quit");
  });
});
