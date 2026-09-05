import { expect, type Page, test } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "../core/icon";
import { Navbar } from "./navbar";
import type { NavDefinition } from "./navbar-items";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeChromeClient: "./ui/chrome/client" } };

const icon = createIcon("/sprite.svg", {
  "icon-chevron-down": "0 0 16 16",
  "icon-hamburger": "0 0 22 22",
  "icon-close": "0 0 22 22",
  "icon-panel-open": "0 0 24 24",
  "icon-panel-close": "0 0 24 24",
});

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

// Chromium wraps a closed `<details>`'s content in `::details-content { content-visibility: hidden }`,
// an ancestor gate that suppresses the desktop bar whatever its own `display` says.
const DETAILS_CONTENT_RULE = '<style>[data-slot~="navbar"]::details-content { content-visibility: visible }</style>';

async function mountNavbar(page: Page, config: NavDefinition = CONFIG): Promise<void> {
  const html = await render(Navbar({ config, resolveHref: (key: string) => `#${key}`, icon }));
  await mount(page, `${DETAILS_CONTENT_RULE}<a id="before" href="#before">before</a>${html}`, EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

async function mountRail(page: Page): Promise<void> {
  const html = await render(Navbar({ config: CONFIG, resolveHref: (key: string) => `#${key}`, icon, collapsible: "always", placement: "left" }));
  await mount(page, `${DETAILS_CONTENT_RULE}${html}`, EXPOSE);
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
      barLink: document.querySelector("[data-slot~='navbar-link']")?.getAttribute("role"),
    }));

    expect(roles).toEqual({ menubar: 0, menus: 2, barLink: null });
  });

  test("a bar menu's popup reports its open state to the platform's own selector", async ({ page }) => {
    await mountNavbar(page);

    const reportsOpen = () => page.evaluate(() => document.querySelector("#navbar-menu-top-0")?.matches(":popover-open"));

    expect(await reportsOpen()).toBe(false);
    await page.click("[data-slot~='menu-trigger']");
    expect(await reportsOpen()).toBe(true);
  });

  test("a nested leaf is a menu item and still a real link", async ({ page }) => {
    await mountNavbar(page);

    const leaf = await page.evaluate(() => {
      const el = document.querySelector("#navbar-menu-top-0 [data-slot~='menu-link-item']");
      return { tag: el?.tagName, role: el?.getAttribute("role"), href: el?.getAttribute("href") };
    });

    expect(leaf).toEqual({ tag: "A", role: "menuitem", href: "#new" });
  });
});

test.describe("Navbar — keyboard", () => {
  test("opening a bar menu focuses its first row", async ({ page }) => {
    await mountNavbar(page);

    await page.click("[data-slot~='menu-trigger']");

    await expect.poll(() => focusedText(page)).toBe("New");
  });

  test("arrow keys walk the menu, including the submenu trigger", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedText(page)).toBe("New");

    await page.keyboard.press("ArrowDown");
    expect(await focusedText(page)).toBe("Open");
    await page.keyboard.press("ArrowDown");
    expect(await focusedText(page)).toBe("Recent");
    await page.keyboard.press("ArrowDown");
    expect(await focusedText(page)).toBe("Quit");
  });

  test("Escape returns focus to the bar trigger", async ({ page }) => {
    await mountNavbar(page);
    await page.focus("[data-slot~='menu-trigger']");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedText(page)).toBe("New");

    await page.keyboard.press("Escape");

    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? [])).toContain("menu-trigger");
  });
});

test.describe("Navbar — submenus", () => {
  test("opening a submenu leaves its parent open", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot~='menu-trigger']");

    await page.click("[data-slot~='menu-submenu-trigger']");

    await expect.poll(() => isOpen(page, "navbar-menu-top-1")).toBe(true);
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(true);
  });

  test("Escape closes only the innermost menu", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot~='menu-trigger']");
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedText(page)).toBe("alpha");

    await page.keyboard.press("Escape");

    await expect.poll(() => isOpen(page, "navbar-menu-top-1")).toBe(false);
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(true);
  });
});

test.describe("Navbar — light dismiss", () => {
  test("a click outside closes the menu, with no outside-click listener of forge's own", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot~='menu-trigger']");
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(true);

    await page.click("#before");

    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(false);
  });

  test("closing the parent closes the submenu with it", async ({ page }) => {
    await mountNavbar(page);
    await page.click("[data-slot~='menu-trigger']");
    await page.click("[data-slot~='menu-submenu-trigger']");
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

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedText(page)).toBe("New");
    await page.keyboard.press("ArrowDown");

    expect(await focusedText(page)).toBe("Quit");
  });
});

// The harness runs no Tailwind build, so the `max-md:` utilities the drawer names style nothing
// unless the spec supplies them; without these rules a case would measure the browser's defaults.
const DRAWER_STYLE = `<style>
  body { margin: 0 }
  .hidden { display: none }
  #page { height: 3000px; background: #eee }
  @media (max-width: 47.99rem) {
    .max-md\\:fixed { position: fixed }
    .max-md\\:relative { position: relative }
    .max-md\\:inset-y-0 { top: 0; bottom: 0 }
    .max-md\\:inset-0 { top: 0; right: 0; bottom: 0; left: 0 }
    .max-md\\:start-0 { inset-inline-start: 0 }
    .max-md\\:z-50 { z-index: 50 }
    .max-md\\:z-40 { z-index: 40 }
    .max-md\\:z-30 { z-index: 30 }
    .max-md\\:flex { display: flex }
    .max-md\\:block { display: block }
    .max-md\\:w-72 { width: 18rem }
    .max-md\\:flex-col { flex-direction: column }
    .max-md\\:bg-background { background: #fff }
    .max-md\\:bg-foreground\\/40 { background: rgba(0, 0, 0, 0.4) }
    .max-md\\:invisible { visibility: hidden }
    .max-md\\:opacity-0 { opacity: 0 }
    .max-md\\:-translate-x-full { transform: translateX(-100%) }
    [open] .max-md\\:group-open\\:visible { visibility: visible }
    [open] .max-md\\:group-open\\:opacity-100 { opacity: 1 }
    [open] .max-md\\:group-open\\:translate-x-0 { transform: translateX(0) }
  }
</style>`;

const PANEL = "[data-slot~='navbar-backdrop'] + div";
const BACKDROP = "[data-slot~='navbar-backdrop']";
const TOGGLE = "[data-slot~='navbar-toggle']";

// Flat, for the trap tests alone: a collapsed nested disclosure leaves its links in the DOM and
// unfocusable, so "the last panel item" would name an element no keyboard can reach.
const FLAT: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Home", href: "home" },
        { label: "Docs", href: "docs" },
        { label: "About", href: "about" },
      ],
    },
  ],
};

async function mountDrawer(page: Page, config: NavDefinition = CONFIG): Promise<void> {
  const html = await render(Navbar({ config, resolveHref: (key: string) => `#${key}`, icon, collapsedAs: "drawer" }));
  // Reduced motion keeps this a geometry assertion: a settled rect, whatever transition the panel gains later.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A focusable ahead of the drawer, so an untrapped Shift+Tab out of the summary has somewhere to
  // land other than the document's own wrap-around.
  await mount(
    page,
    `${DETAILS_CONTENT_RULE}${DRAWER_STYLE}<a id="before" href="#before">before</a>${html}<div id="page">page content</div>`,
    EXPOSE,
  );
  await page.evaluate(() => window.forgeResume.resume());
}

const isDrawerOpen = (page: Page) => page.evaluate(() => document.querySelector<HTMLDetailsElement>("[data-slot~='navbar']")?.open ?? null);

/** The trap's own candidate list, resolved against the live panel rather than restated as a label. */
const PANEL_FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";

/** Focuses the panel's last focusable item and reports its text, so no test hardcodes which it is. */
const focusLastPanelItem = (page: Page): Promise<string | undefined> =>
  page.evaluate(
    ([selector, focusable]) => {
      const panel = document.querySelector(selector);
      const items = [...(panel?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter((n) => !n.hidden);
      const last = items.at(-1);
      if (last === undefined) throw new Error("the drawer panel holds no focusable item");
      last.focus();
      return last.textContent?.trim();
    },
    [PANEL, PANEL_FOCUSABLE] as [string, string],
  );

const focusedSlot = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);

/** Where the page content sits, and where the panel sits over it. */
function geometry(page: Page, panel: string) {
  return page.evaluate((selector) => {
    const content = document.getElementById("page");
    const drawer = document.querySelector(selector);
    if (content === null || drawer === null) throw new Error("the drawer fixture is not on the page");
    const box = drawer.getBoundingClientRect();
    return {
      contentY: Math.round(content.getBoundingClientRect().top),
      panel: { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) },
      panelVisibility: getComputedStyle(drawer).visibility,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, panel);
}

test.describe("Navbar — the drawer at phone width", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("overlays the content from the leading edge without moving a pixel of it", async ({ page }) => {
    await mountDrawer(page);
    const closed = await geometry(page, PANEL);
    expect({ visibility: closed.panelVisibility, open: await isDrawerOpen(page) }).toEqual({ visibility: "hidden", open: false });

    await page.click(TOGGLE);

    const open = await geometry(page, PANEL);
    // The defect this mode exists to fix: an in-flow panel pushes the content down by its height.
    expect(open.contentY).toBe(closed.contentY);
    expect({ visibility: open.panelVisibility, x: open.panel.x, width: open.panel.width }).toEqual({ visibility: "visible", x: 0, width: 288 });
    expect(open.panel.height).toBe(open.viewport.height);
  });

  // The panel starts at the same edge as the toggle, so an equal stacking order buried the one
  // control that shuts the drawer with JavaScript off. The toggle sits above both layers.
  test("keeps its own toggle clickable while open, which is the JavaScript-off way back out", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    expect(await isDrawerOpen(page)).toBe(true);

    await page.click(TOGGLE);

    await expect.poll(() => isDrawerOpen(page)).toBe(false);
  });

  test("closes from a click on the backdrop", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    expect(await isDrawerOpen(page)).toBe(true);

    await page.click(BACKDROP, { position: { x: 340, y: 400 } });

    await expect.poll(() => isDrawerOpen(page)).toBe(false);
  });

  test("closes on Escape, and hands focus back to the toggle", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");

    await page.keyboard.press("Escape");

    await expect.poll(() => isDrawerOpen(page)).toBe(false);
    // Polled, not read once: `open` flips synchronously under Escape but `toggle` — and so the
    // focus restore listening on it — is dispatched a task later.
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? [])).toContain("navbar-toggle");
  });

  // A wheel, not `scrollTo`: `overflow: hidden` stops the reader's scroll and permits a scripted
  // one, so a programmatic scroll would measure nothing about the lock.
  test("holds the page behind it still while it is open, and gives the scroll back on close", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    await page.mouse.move(340, 400);

    await page.mouse.wheel(0, 500);

    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);

    await page.keyboard.press("Escape");
    await expect.poll(() => isDrawerOpen(page)).toBe(false);

    // The wheel is re-sent on each attempt: the unlock and the compositor's next frame are not the
    // same instant, and a single wheel swallowed by the locked frame would never be retried.
    const wheelThenScrollY = async () => {
      await page.mouse.wheel(0, 100);
      return page.evaluate(() => Math.round(window.scrollY));
    };
    await expect.poll(wheelThenScrollY).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("overflow"))).toBe("");
  });

  // The summary is a sibling of the panel and draws the only visible way out, so a trap scoped to
  // the panel leaves a reader who does not know Escape with no exit at all — WCAG 2.1.2.
  test("cycles Tab through its own toggle, so the visible close is reachable", async ({ page }) => {
    await mountDrawer(page, FLAT);
    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");

    await focusLastPanelItem(page);
    await page.keyboard.press("Tab");

    expect(await focusedSlot(page)).toContain("navbar-toggle");
  });

  test("cycles Shift+Tab back from its toggle to the last panel item", async ({ page }) => {
    await mountDrawer(page, FLAT);
    await page.click(TOGGLE);
    // The open handler moves focus into the panel a task later; taking the toggle before it lands
    // would make this a race rather than an assertion about the trap.
    await expect.poll(() => focusedText(page)).toBe("Home");
    const last = await focusLastPanelItem(page);
    await page.focus(TOGGLE);

    await page.keyboard.press("Shift+Tab");

    expect(await focusedText(page)).toBe(last);
  });

  test("closes from its own toggle once the keyboard reaches it", async ({ page }) => {
    await mountDrawer(page, FLAT);
    await page.click(TOGGLE);
    expect(await isDrawerOpen(page)).toBe(true);
    // Same wait as the two trap tests above: the open handler moves focus into the panel a task
    // later, so taking the last item before it lands lets it steal focus back to "Home" — Tab then
    // reaches the second link and Enter follows it, leaving the drawer open with nothing to say why.
    await expect.poll(() => focusedText(page)).toBe("Home");

    await focusLastPanelItem(page);
    await page.keyboard.press("Tab");
    expect(await focusedSlot(page)).toContain("navbar-toggle");
    await page.keyboard.press("Enter");

    await expect.poll(() => isDrawerOpen(page)).toBe(false);
  });
});

test.describe("Navbar — the rail keeps its disclosure at desktop width", () => {
  test("a rail's summary opens and closes it, with no controller of forge's own", async ({ page }) => {
    await mountRail(page);
    const isRailOpen = () => page.evaluate(() => document.querySelector<HTMLDetailsElement>("[data-slot~='navbar']")?.open ?? null);

    expect(await isRailOpen()).toBe(false);

    await page.click("[data-slot~='navbar-toggle']");
    await expect.poll(isRailOpen).toBe(true);

    await page.click("[data-slot~='navbar-toggle']");
    await expect.poll(isRailOpen).toBe(false);
  });
});

const MEGA: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Home", href: "home" },
        {
          label: "Products",
          groups: [
            { heading: "Build", group: [{ label: "Forge", href: "forge" }] },
            { heading: "Ship", group: [{ label: "Deploy", href: "deploy" }] },
          ],
        },
      ],
    },
  ],
};

const MEGA_EXPOSE = { expose: { ...EXPOSE.expose, forgeCoreClient: "./ui/core/client" } };

async function mountMega(page: Page): Promise<void> {
  const html = await render(Navbar({ config: MEGA, resolveHref: (key: string) => `#${key}`, icon }));
  await mount(page, `${DETAILS_CONTENT_RULE}<a id="before" href="#before">before</a>${html}`, MEGA_EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

test.describe("Navbar — megamenu", () => {
  test("opens on the popover API and Tab reaches its first link", async ({ page }) => {
    await mountMega(page);
    expect(await isOpen(page, "navbar-menu-top-0")).toBe(false);

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(true);
    await expect.poll(() => page.getAttribute("[data-slot~='popover-trigger']", "aria-expanded")).toBe("true");

    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Forge");
  });

  test("Escape closes it and returns focus to the trigger", async ({ page }) => {
    await mountMega(page);
    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(true);
    await page.keyboard.press("Tab");

    await page.keyboard.press("Escape");
    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(false);
    expect(await focusedText(page)).toBe("Products");
  });

  test("a click outside closes it, with no listener of forge's own", async ({ page }) => {
    await mountMega(page);
    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(true);

    await page.click("#before");
    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(false);
  });
});
