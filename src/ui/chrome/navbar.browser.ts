import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses, withCompiledCss } from "../client/browser.fixture";
import { Drawer } from "../core/drawer";
import { createIcon } from "../core/icon";
import { Navbar } from "./navbar";
import type { NavDefinition, NavPlacement } from "./types";

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

test.describe("Navbar — anatomy the bar actually claims", { tag: "@cross-engine" }, () => {
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

  test("a bar trigger stands as tall as a bar link, its button box giving way to the bar's own", async ({ page }) => {
    const config: NavDefinition = {
      sections: [
        { items: [...(CONFIG.sections[0]?.items ?? []), { label: "Products", groups: [{ heading: "G", group: [{ label: "l", href: "l" }] }] }] },
      ],
    };
    const html = await render(Navbar({ config, resolveHref: (key: string) => `#${key}`, icon }));
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, `${DETAILS_CONTENT_RULE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);

    const heights = await page.evaluate(() =>
      ["navbar-link", "menu-trigger", "popover-trigger"].map(
        (slot) => document.querySelector(`[data-slot~='navbar-section'] [data-slot~='${slot}']`)?.getBoundingClientRect().height,
      ),
    );

    expect(heights[0]).toBeGreaterThan(0);
    expect(heights).toEqual([heights[0], heights[0], heights[0]]);
  });
});

test.describe("Navbar — keyboard", { tag: "@cross-engine" }, () => {
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

test.describe("Navbar — submenus", { tag: "@cross-engine" }, () => {
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

test.describe("Navbar — light dismiss", { tag: "@cross-engine" }, () => {
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

test.describe("Navbar — hidden items stay out of the keyboard ring", { tag: "@cross-engine" }, () => {
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

const PANEL = "[data-slot~='navbar-backdrop'] + div";
const BACKDROP = "[data-slot~='navbar-backdrop']";
const TOGGLE = "[data-slot~='navbar-toggle']";

async function mountDrawer(page: Page, config: NavDefinition = CONFIG): Promise<void> {
  const html = await render(Navbar({ config, resolveHref: (key: string) => `#${key}`, icon, collapsedAs: "drawer" }));
  // Reduced motion keeps this a geometry assertion: a settled rect rather than one mid-slide.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A focusable ahead of the drawer, so an untrapped Shift+Tab out of the summary has somewhere to
  // land other than the document's own wrap-around.
  await mount(
    page,
    `${DETAILS_CONTENT_RULE}<style>${await compiledCss(renderedClasses(html))}</style><a id="before" href="#before">before</a>${html}<div id="page" style="height: 3000px">page content</div>`,
    EXPOSE,
  );
  await page.evaluate(() => window.forgeResume.resume());
}

const isDrawerOpen = (page: Page) => page.evaluate(() => document.querySelector<HTMLDetailsElement>("[data-slot~='navbar']")?.open ?? null);

/** The trap's own candidate list. */
const PANEL_FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";

/** Focuses the last panel item the browser renders and reports its text. */
const focusLastPanelItem = (page: Page): Promise<string | undefined> =>
  page.evaluate(
    ([selector, focusable]) => {
      const panel = document.querySelector(selector);
      const items = [...(panel?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter((n) => !n.hidden && n.checkVisibility());
      const last = items.at(-1);
      if (last === undefined) throw new Error("the drawer panel holds no focusable item");
      last.focus();
      return last.textContent?.trim();
    },
    [PANEL, PANEL_FOCUSABLE] as [string, string],
  );

/** How many links the panel holds inside a disclosure that is shut. */
const shutDisclosureLinks = (page: Page): Promise<number> =>
  page.evaluate((selector) => document.querySelectorAll(`${selector} details[data-slot~='navbar-disclosure']:not([open]) a[href]`).length, PANEL);

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

test.describe("Navbar — the drawer at phone width", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("overlays the content from the leading edge without moving a pixel of it", async ({ page }) => {
    await mountDrawer(page);
    const closed = await geometry(page, PANEL);
    expect({ visibility: closed.panelVisibility, open: await isDrawerOpen(page) }).toEqual({ visibility: "hidden", open: false });

    await page.click(TOGGLE);

    const open = await geometry(page, PANEL);
    expect(open.contentY).toBe(closed.contentY);
    expect({ visibility: open.panelVisibility, x: open.panel.x, width: open.panel.width }).toEqual({ visibility: "visible", x: 0, width: 288 });
    expect(open.panel.height).toBe(open.viewport.height);
  });

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

  test("cycles Tab through its own toggle, so the visible close is reachable", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");
    expect(await shutDisclosureLinks(page)).toBeGreaterThan(0);

    await focusLastPanelItem(page);
    await page.keyboard.press("Tab");

    expect(await focusedSlot(page)).toContain("navbar-toggle");
  });

  test("cycles Shift+Tab back from its toggle to the last panel item", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    // The open handler moves focus into the panel a task later; taking the toggle before it lands
    // would make this a race rather than an assertion about the trap.
    await expect.poll(() => focusedText(page)).toBe("Home");
    expect(await shutDisclosureLinks(page)).toBeGreaterThan(0);
    const last = await focusLastPanelItem(page);
    await page.focus(TOGGLE);

    await page.keyboard.press("Shift+Tab");

    expect(await focusedText(page)).toBe(last);
  });

  test("closes from its own toggle once the keyboard reaches it", async ({ page }) => {
    await mountDrawer(page);
    await page.click(TOGGLE);
    expect(await isDrawerOpen(page)).toBe(true);
    // Same wait as the trap tests above: the open handler moves focus into the panel a task
    // later, so taking the last item before it lands lets it steal focus back to "Home".
    await expect.poll(() => focusedText(page)).toBe("Home");

    await focusLastPanelItem(page);
    await page.keyboard.press("Tab");
    expect(await focusedSlot(page)).toContain("navbar-toggle");
    await page.keyboard.press("Enter");

    await expect.poll(() => isDrawerOpen(page)).toBe(false);
  });

  test("makes the page behind it inert while open, and gives it back on close and on dispose", async ({ page }) => {
    await mountDrawer(page);
    const outsideIsInert = () => page.evaluate(() => document.getElementById("page")?.inert ?? null);
    expect(await outsideIsInert()).toBe(false);

    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");
    expect(await outsideIsInert()).toBe(true);
    await page.evaluate(() => document.querySelector<HTMLAnchorElement>("#before")?.focus());
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("before");

    await page.click(TOGGLE);
    await expect.poll(() => outsideIsInert()).toBe(false);
  });
});

const INLINE: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Home", href: "home" },
        {
          label: "File",
          items: [
            { label: "New", href: "new" },
            { label: "Open", href: "open" },
          ],
        },
        { label: "About", href: "about" },
      ],
    },
  ],
};

const DISCLOSURE = "[data-slot~='navbar-disclosure']";
const DISCLOSURE_TRIGGER = "[data-slot~='navbar-disclosure-trigger']";

/** The drawer's disclosure, the links it holds and the item after it, measured against the panel. */
function disclosureLayout(page: Page) {
  return page.evaluate(
    ([panelSel, disclosureSel]) => {
      const panel = document.querySelector(panelSel)?.getBoundingClientRect();
      const disclosure = document.querySelector<HTMLDetailsElement>(disclosureSel);
      const about = document.querySelector(`${panelSel} a[href='#about']`);
      const content = disclosure?.querySelector("[data-slot~='navbar-disclosure-content']");
      if (panel === undefined || disclosure === null || about === null || content == null) throw new Error("the drawer fixture is not on the page");
      const links = [...content.querySelectorAll("a[href]")];
      return {
        open: disclosure.open,
        popoversOpen: document.querySelectorAll(":popover-open").length,
        linksRendered: links.map((link) => link.checkVisibility()),
        linksInsidePanel: links.map((link) => {
          const box = link.getBoundingClientRect();
          return box.left >= panel.left && box.right <= panel.right && box.top >= panel.top && box.bottom <= panel.bottom;
        }),
        aboutTop: about.getBoundingClientRect().top,
        contentHeight: content.getBoundingClientRect().height,
      };
    },
    [PANEL, DISCLOSURE] as [string, string],
  );
}

test.describe("Navbar — a menu in the drawer opens in the flow", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("a tap on a menu's summary opens its links inside the panel, with no popover", async ({ page }) => {
    await mountDrawer(page, INLINE);
    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");
    const shut = await disclosureLayout(page);

    await page.click(DISCLOSURE_TRIGGER);

    await expect.poll(async () => (await disclosureLayout(page)).open).toBe(true);
    const open = await disclosureLayout(page);
    expect({ shut: shut.linksRendered, open: open.linksRendered, inside: open.linksInsidePanel, popovers: open.popoversOpen }).toEqual({
      shut: [false, false],
      open: [true, true],
      inside: [true, true],
      popovers: 0,
    });
  });

  test("pushes the item below it down by exactly the height of what it opened", async ({ page }) => {
    await mountDrawer(page, INLINE);
    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");
    const shut = await disclosureLayout(page);

    await page.click(DISCLOSURE_TRIGGER);

    await expect.poll(async () => (await disclosureLayout(page)).open).toBe(true);
    const open = await disclosureLayout(page);
    expect(open.contentHeight).toBeGreaterThan(0);
    expect(open.aboutTop - shut.aboutTop).toBeCloseTo(open.contentHeight, 0);
  });

  test("Tab walks into an opened disclosure's links rather than past them", async ({ page }) => {
    await mountDrawer(page, INLINE);
    await page.click(TOGGLE);
    await expect.poll(() => focusedText(page)).toBe("Home");
    await page.click(DISCLOSURE_TRIGGER);
    await expect.poll(async () => (await disclosureLayout(page)).open).toBe(true);

    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("New");
    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Open");
    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("About");
  });
});

const LEADING = "#pages";
const TRAILING = "#toc";
const LEADING_TOGGLE = `${LEADING} > ${TOGGLE}`;
const LEADING_PANEL = `${LEADING} > ${PANEL}`;

/** Two server-open drawer rails under a sticky header, styled by Tailwind. */
async function mountStyledRails(page: Page): Promise<void> {
  const rail = (id: string, placement: "left" | "right") =>
    render(
      Navbar({
        config: CONFIG,
        resolveHref: (key: string) => `#${key}`,
        icon,
        collapsible: "always",
        collapsedAs: "drawer",
        defaultOpen: true,
        id,
        placement,
      }),
    );
  const rails = `${await rail("pages", "left")}${await rail("toc", "right")}`;
  const css = await compiledCss(renderedClasses(rails));
  await mount(
    page,
    `${DETAILS_CONTENT_RULE}<style>html { scroll-behavior: smooth }</style><style>${css}</style><header style="position: sticky; top: 0; height: 79px"></header>${rails}<div id="page" style="height: 3000px"></div>`,
    EXPOSE,
  );
}

/** Whether focus sits on the first item the panel offers. */
const focusIsOnFirstPanelItem = (page: Page): Promise<boolean> =>
  page.evaluate(
    ([selector, focusable]) => {
      const first = document.querySelector(selector)?.querySelector(focusable);
      return first !== null && first !== undefined && document.activeElement === first;
    },
    [LEADING_PANEL, PANEL_FOCUSABLE] as [string, string],
  );

const runningTransitions = (page: Page): Promise<number> =>
  page.evaluate(() => document.getAnimations().filter((animation) => animation instanceof CSSTransition).length);

const scrollY = (page: Page): Promise<number> => page.evaluate(() => Math.round(window.scrollY));

test.describe("Navbar — the drawer under its real stylesheet", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 700 }, reducedMotion: "no-preference" });

  test("opening a drawer moves focus to its first link without scrolling the page", async ({ page }) => {
    await mountStyledRails(page);
    await page.evaluate(() => window.forgeResume.resume());
    await expect.poll(() => runningTransitions(page)).toBe(0);

    await page.click(LEADING_TOGGLE);

    await expect.poll(() => focusIsOnFirstPanelItem(page)).toBe(true);
    await page.evaluate(async (selector) => {
      await Promise.all((document.querySelector(selector)?.getAnimations() ?? []).map((animation) => animation.finished));
    }, LEADING_PANEL);
    expect(await scrollY(page)).toBe(0);
  });

  test("shuts the server-open rails at load without playing a transition over the toggles", async ({ page }) => {
    await mountStyledRails(page);

    const loaded = await page.evaluate(
      ([leading, trailing, toggle]) => {
        window.forgeResume.resume();
        const bars = [leading, trailing].map((sel) => document.querySelector<HTMLDetailsElement>(sel));
        const transitions = bars.flatMap((bar) =>
          (bar?.getAnimations({ subtree: true }) ?? []).filter((animation) => "transitionProperty" in animation),
        );
        const summary = document.querySelector(toggle);
        if (summary === null) throw new Error("the leading toggle is not on the page");
        const box = summary.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { open: bars.map((bar) => bar?.open), transitions: transitions.length, hitsToggle: hit !== null && summary.contains(hit) };
      },
      [LEADING, TRAILING, LEADING_TOGGLE] as [string, string, string],
    );

    expect(loaded).toEqual({ open: [false, false], transitions: 0, hitsToggle: true });
  });

  test("a tap on a toggle straight after load opens its drawer and leaves the page where it was", async ({ page }) => {
    await mountStyledRails(page);
    await page.evaluate(() => window.forgeResume.resume());

    await page.click(LEADING_TOGGLE);

    await expect.poll(() => focusIsOnFirstPanelItem(page)).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((settle) => {
          window.addEventListener("scrollend", () => settle(), { once: true });
          setTimeout(settle, 1000);
        }),
    );
    expect(await scrollY(page)).toBe(0);
  });

  test("fades the panel in place when the reader asks for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mountStyledRails(page);
    await page.evaluate(() => window.forgeResume.resume());

    await page.click(LEADING_TOGGLE);
    const opening = await page.evaluate((selector) => {
      const panel = document.querySelector(selector);
      if (panel === null) throw new Error("the leading panel is not on the page");
      return {
        properties: panel.getAnimations().flatMap((animation) => (animation instanceof CSSTransition ? [animation.transitionProperty] : [])),
        x: Math.round(panel.getBoundingClientRect().x),
      };
    }, LEADING_PANEL);

    expect(opening.properties).toContain("opacity");
    expect(opening.properties).not.toContain("translate");
    expect(opening.x).toBe(0);
    await expect.poll(() => focusIsOnFirstPanelItem(page)).toBe(true);
  });

  test("slides the panel in on `translate`, the property Tailwind's offset utilities set", async ({ page }) => {
    await mountStyledRails(page);
    await page.evaluate(() => window.forgeResume.resume());
    await expect.poll(() => runningTransitions(page)).toBe(0);

    const properties = await page.evaluate(
      ([bar, panel]) => {
        const details = document.querySelector<HTMLDetailsElement>(bar);
        if (details === null) throw new Error("the leading rail is not on the page");
        details.open = true;
        return (document.querySelector(panel)?.getAnimations() ?? []).flatMap((animation) =>
          animation instanceof CSSTransition ? [animation.transitionProperty] : [],
        );
      },
      [LEADING, LEADING_PANEL] as [string, string],
    );

    expect(properties).toContain("translate");
  });
});

test.describe("Navbar — the rail keeps its disclosure at desktop width", { tag: "@cross-engine" }, () => {
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

test.describe("Navbar — megamenu", { tag: "@cross-engine" }, () => {
  test("opens on the popover API and Tab reaches its first link", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit skips an open popover's contents when sequential focus starts from a descendant of its invoker");
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

async function mountStyled(page: Page, collapsible: "mobile" | "always"): Promise<void> {
  const html = await render(Navbar({ config: CONFIG, resolveHref: (key: string) => `#${key}`, icon, collapsible }));
  await mount(page, `${DETAILS_CONTENT_RULE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

test.describe("Navbar — desktop width under the real stylesheet", { tag: "@cross-engine" }, () => {
  test("renders the bar menu and none of its disclosure twin", async ({ page }) => {
    await mountStyled(page, "mobile");

    const rendered = await page.evaluate(
      ([disclosure, trigger]) => ({
        disclosure: document.querySelector(disclosure)?.checkVisibility() ?? null,
        menuTrigger: document.querySelector(trigger)?.checkVisibility() ?? null,
      }),
      [DISCLOSURE, "[data-slot~='menu-trigger']"] as [string, string],
    );

    expect(rendered).toEqual({ disclosure: false, menuTrigger: true });
  });

  test("opens the bar menu as its popover", async ({ page }) => {
    await mountStyled(page, "mobile");

    await page.click("[data-slot~='menu-trigger']");

    await expect.poll(() => isOpen(page, "navbar-menu-top-0")).toBe(true);
  });

  test("a rail's menu opens in the flow at desktop width too, with no popover", async ({ page }) => {
    await mountStyled(page, "always");
    await page.click(TOGGLE);

    await page.click(DISCLOSURE_TRIGGER);

    await expect
      .poll(() =>
        page.evaluate(
          (sel) => ({
            open: document.querySelector<HTMLDetailsElement>(sel)?.open ?? null,
            popovers: document.querySelectorAll("[popover]").length,
            newRendered: document.querySelector(`${sel} a[href='#new']`)?.checkVisibility() ?? null,
          }),
          DISCLOSURE,
        ),
      )
      .toEqual({ open: true, popovers: 0, newRendered: true });
  });
});

test.describe("Navbar — nested disclosures under the real stylesheet", { tag: "@cross-engine" }, () => {
  test.use({ reducedMotion: "reduce" });

  const chevronRotation = (page: Page) =>
    page.evaluate((disclosure) => {
      const rotation = (selector: string) => {
        const chevron = document.querySelector(selector)?.querySelector(":scope > summary > [aria-hidden='true']");
        if (chevron == null) throw new Error(`${selector} has no chevron in its summary`);
        return getComputedStyle(chevron).rotate;
      };
      return { outer: rotation(disclosure), inner: rotation(`${disclosure} ${disclosure}`) };
    }, DISCLOSURE);

  test("a closed disclosure inside an open one keeps its own chevron unturned, and turns it once opened", async ({ page }) => {
    await mountStyled(page, "always");
    await page.click(TOGGLE);
    await page.click(DISCLOSURE_TRIGGER);

    await expect.poll(() => chevronRotation(page)).toEqual({ outer: "180deg", inner: "none" });

    await page.click(`${DISCLOSURE} ${DISCLOSURE} > ${DISCLOSURE_TRIGGER}`);

    await expect.poll(() => chevronRotation(page)).toEqual({ outer: "180deg", inner: "180deg" });
  });
});

const ROWS = Array.from({ length: 60 }, (_, i) => `<button id="b${i + 1}" class="block h-10 w-full">b${i + 1}</button>`).join("");

const PINS_TO_BOTTOM: NavPlacement[] = ["bottom", "right"];

async function mountPinned(page: Page, placement: NavPlacement, after = ""): Promise<void> {
  const pinned = await render(Navbar({ config: CONFIG, resolveHref: (key: string) => `#${key}`, icon, placement }));
  const body = PINS_TO_BOTTOM.includes(placement) ? `${ROWS}${pinned}` : `${pinned}${ROWS}`;
  await mount(page, `${await withCompiledCss(body)}${after}`);
}

const barRect = (page: Page) =>
  page.evaluate(() => {
    const rect = (document.querySelector("[data-slot~='navbar']") as Element).getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewport: window.innerHeight };
  });

test.describe("Navbar — the bar sticks to its edge", { tag: "@cross-engine" }, () => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 667 },
  ]) {
    test(`a top bar stays on the top edge of a ${viewport.width}px viewport once the page scrolls under it`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mountPinned(page, "top");

      await page.evaluate(() => window.scrollTo({ top: 1000, behavior: "instant" }));

      expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(1000);
      expect((await barRect(page)).top).toBe(0);
    });

    test(`a bottom bar rests on the bottom edge of a ${viewport.width}px viewport before the page scrolls`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mountPinned(page, "bottom");

      const rect = await barRect(page);

      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(rect.bottom).toBe(rect.viewport);
    });
  }
});

function focusedAndHit(page: Page): Promise<{ focused: string | undefined; hit: string | undefined }> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    const rect = (focused as Element).getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { focused: focused?.id, hit: hit?.closest("button")?.id };
  });
}

function topReserve(page: Page): Promise<{ bar: number; scroll: number }> {
  return page.evaluate(() => ({
    bar: (document.querySelector("[data-slot~='navbar']") as Element).getBoundingClientRect().height,
    scroll: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
  }));
}

test.describe("Navbar — a focused control is never hidden beneath a sticky top bar", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const { placement, after, token } of [
    { placement: "top", after: "", token: "the default" },
    { placement: "left", after: "", token: "the default" },
    { placement: "top", after: "<style>html{--forge-navbar-height:1.25rem}</style>", token: "a 1.25rem" },
  ] as const) {
    test(`Shift+Tab onto a control under a ${placement} bar under ${token} --forge-navbar-height scrolls it clear, so it is the element at its own centre`, async ({
      page,
    }) => {
      await mountPinned(page, placement, after);
      await page.evaluate(() => {
        window.scrollTo({ top: (document.getElementById("b40") as HTMLElement).offsetTop + 5, behavior: "instant" });
        (document.getElementById("b41") as HTMLElement).focus({ preventScroll: true });
      });

      await page.keyboard.press("Shift+Tab");

      await expect.poll(() => focusedAndHit(page)).toEqual({ focused: "b40", hit: "b40" });
    });
  }
});

test.describe("Navbar — a top bar reserves its own height as the page's scroll padding", { tag: "@cross-engine" }, () => {
  for (const { placement, viewport } of [
    { placement: "top", viewport: { width: 1280, height: 800 } },
    { placement: "top", viewport: { width: 375, height: 667 } },
    { placement: "left", viewport: { width: 375, height: 667 } },
  ] as const) {
    test(`a ${placement} bar's scroll-padding-top equals its height on a ${viewport.width}px viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mountPinned(page, placement);

      const { bar, scroll } = await topReserve(page);

      expect(scroll).toBe(bar);
      expect(bar).toBeGreaterThan(0);
    });
  }

  for (const { height, viewport, row } of [
    { height: "4rem", viewport: { width: 1280, height: 720 }, row: 64 },
    { height: "1.25rem", viewport: { width: 375, height: 667 }, row: 28 },
  ] as const) {
    test(`an app's ${height} --forge-navbar-height on html resizes a ${viewport.width}px top bar and its reserve together to ${row}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await mountPinned(page, "top", `<style>html{--forge-navbar-height:${height}}</style>`);

      expect(await topReserve(page)).toEqual({ bar: row, scroll: row });
    });
  }
});

test.describe("Navbar — a focused control is never hidden beneath a sticky bottom bar", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const placement of PINS_TO_BOTTOM) {
    test(`every control reached by Tab above a ${placement} bar is the element at its own centre, the last one included`, async ({ page }) => {
      await mountPinned(page, placement);
      await page.locator("#b1").focus();

      await expect.poll(() => focusedAndHit(page)).toEqual({ focused: "b1", hit: "b1" });
      for (let n = 2; n <= 60; n++) {
        await page.keyboard.press("Tab");
        await expect.poll(() => focusedAndHit(page)).toEqual({ focused: `b${n}`, hit: `b${n}` });
      }
    });

    test(`a ${placement} bar's scroll-padding-bottom equals its height`, async ({ page }) => {
      await mountPinned(page, placement);

      const { bar, scroll } = await page.evaluate(() => ({
        bar: (document.querySelector("[data-slot~='navbar']") as Element).getBoundingClientRect().height,
        scroll: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
      }));

      expect(scroll).toBe(bar);
      expect(bar).toBeGreaterThan(0);
    });
  }
});

test.describe("Navbar — a side bar is a column on a wide viewport and reserves no block edge", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const placement of ["left", "right"] as const) {
    test(`a ${placement} bar leaves the page's top and bottom scroll padding at zero on a 1280px viewport`, async ({ page }) => {
      await mountPinned(page, placement);

      const padding = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { top: Number.parseFloat(cs.scrollPaddingTop) || 0, bottom: Number.parseFloat(cs.scrollPaddingBottom) || 0 };
      });

      expect(padding).toEqual({ top: 0, bottom: 0 });
    });
  }
});

const EDGE_LINKS: NavDefinition = {
  sections: [
    {
      items: [
        { label: "Home", href: "home" },
        { label: "Docs", href: "docs" },
        { label: "Blog", href: "blog" },
      ],
    },
    {
      items: [
        { label: "Account", href: "account" },
        { label: "Sign out", href: "sign-out" },
      ],
    },
  ],
};

async function mountEdgeDrawer(page: Page, placement: NavPlacement, after = ""): Promise<void> {
  const edgeDrawer = await render(Navbar({ config: EDGE_LINKS, resolveHref: (key: string) => `#${key}`, icon, placement, collapsedAs: "drawer" }));
  const body = PINS_TO_BOTTOM.includes(placement) ? `${ROWS}${edgeDrawer}` : `${edgeDrawer}${ROWS}`;
  await mount(page, `${DETAILS_CONTENT_RULE}${await withCompiledCss(body)}${after}`);
}

async function mountEdgeRail(page: Page, placement: "left" | "right", after = ""): Promise<void> {
  const rail = await render(
    Navbar({ config: EDGE_LINKS, resolveHref: (key: string) => `#${key}`, icon, collapsible: "always", collapsedAs: "drawer", placement }),
  );
  const item = `<div class="w-64 shrink-0 max-md:w-auto has-[[data-slot~=navbar]:not([open])]:w-14">${rail}</div>`;
  const main = `<main class="flex-1 min-w-0">${ROWS}</main>`;
  const body = `<div class="flex min-h-dvh">${placement === "left" ? `${item}${main}` : `${main}${item}`}</div>`;
  await mount(page, `${DETAILS_CONTENT_RULE}${await withCompiledCss(body)}${after}`);
}

type CornerHits = [boolean, boolean, boolean, boolean];

function edgeLinkHits(page: Page): Promise<{ first: CornerHits; last: CornerHits }> {
  return page.evaluate((selector) => {
    const links = [...document.querySelectorAll<HTMLElement>(`${selector} a[href]`)].filter((link) => link.checkVisibility());
    const hits = (link: HTMLElement | undefined): CornerHits => {
      if (link === undefined) throw new Error("the drawer panel holds no visible link");
      const box = link.getBoundingClientRect();
      const inset = Number.parseFloat(getComputedStyle(link).borderTopLeftRadius) + 1;
      const at = (x: number, y: number) => link.contains(document.elementFromPoint(x, y));
      return [
        at(box.left + inset, box.top + 1),
        at(box.right - inset, box.top + 1),
        at(box.left + inset, box.bottom - 1),
        at(box.right - inset, box.bottom - 1),
      ];
    };
    return { first: hits(links[0]), last: hits(links.at(-1)) };
  }, PANEL);
}

test.describe("Navbar — an open drawer leaves its first and last links clear of the toggle", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 700 }, reducedMotion: "reduce" });

  for (const { placement, after, token, row } of [
    { placement: "top", after: "", token: "the default", row: 56 },
    { placement: "bottom", after: "", token: "the default", row: 56 },
    { placement: "top", after: "<style>html{--forge-navbar-height:2.5rem}</style>", token: "a 2.5rem", row: 40 },
    { placement: "bottom", after: "<style>html{--forge-navbar-height:2.5rem}</style>", token: "a 2.5rem", row: 40 },
    { placement: "top", after: "<style>html{--forge-navbar-height:1.25rem}</style>", token: "a 1.25rem", row: 28 },
    { placement: "bottom", after: "<style>html{--forge-navbar-height:1.25rem}</style>", token: "a 1.25rem", row: 28 },
  ] as const) {
    test(`a ${placement} drawer bar under ${token} --forge-navbar-height keeps a ${row}px toggle, takes a hit across each edge link's whole box, and its toggle still closes it`, async ({
      page,
    }) => {
      await mountEdgeDrawer(page, placement, after);

      expect(await page.evaluate((toggle) => (document.querySelector(toggle) as Element).getBoundingClientRect().height, TOGGLE)).toBe(row);

      await page.click(TOGGLE);

      await expect.poll(() => edgeLinkHits(page)).toEqual({ first: [true, true, true, true], last: [true, true, true, true] });

      await page.click(TOGGLE);

      await expect.poll(() => isDrawerOpen(page)).toBe(false);
    });
  }
});

test.describe("Navbar — an open drawer rail leaves its first and last links clear of the toggle", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 700 }, reducedMotion: "reduce" });

  for (const { placement, after, token, row } of [
    { placement: "left", after: "", token: "the default", row: 56 },
    { placement: "right", after: "", token: "the default", row: 56 },
    { placement: "left", after: "<style>html{--forge-navbar-height:2.5rem}</style>", token: "a 2.5rem", row: 40 },
    { placement: "right", after: "<style>html{--forge-navbar-height:2.5rem}</style>", token: "a 2.5rem", row: 40 },
    { placement: "left", after: "<style>html{--forge-navbar-height:1.25rem}</style>", token: "a 1.25rem", row: 28 },
    { placement: "right", after: "<style>html{--forge-navbar-height:1.25rem}</style>", token: "a 1.25rem", row: 28 },
  ] as const) {
    test(`a ${placement} drawer rail under ${token} --forge-navbar-height keeps a ${row}px toggle, takes a hit across each edge link's whole box, and its toggle still closes it`, async ({
      page,
    }) => {
      await mountEdgeRail(page, placement, after);

      expect(await page.evaluate((toggle) => (document.querySelector(toggle) as Element).getBoundingClientRect().height, TOGGLE)).toBe(row);

      await page.click(TOGGLE);

      await expect.poll(() => edgeLinkHits(page)).toEqual({ first: [true, true, true, true], last: [true, true, true, true] });

      await page.click(TOGGLE);

      await expect.poll(() => isDrawerOpen(page)).toBe(false);
    });
  }

  test("a left drawer rail on a 1280px viewport keeps its 46px toggle and adds no top scroll padding", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mountEdgeRail(page, "left");

    const measured = await page.evaluate(
      (toggle) => ({
        toggle: (document.querySelector(toggle) as Element).getBoundingClientRect().height,
        scrollPaddingTop: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
      }),
      TOGGLE,
    );

    expect(measured).toEqual({ toggle: 46, scrollPaddingTop: 0 });
  });
});

const MOTION_TOKENS = "<style>html{--forge-motion-enter:300ms;--forge-motion-exit:250ms}</style>";

const durations = (page: Page, selectors: Record<string, string>) =>
  page.evaluate(
    (targets) =>
      Object.fromEntries(
        Object.entries(targets).map(([name, selector]) => {
          const el = document.querySelector(selector);
          if (el === null) throw new Error(`${selector} is not on the page`);
          return [name, [...new Set(getComputedStyle(el).transitionDuration.split(", "))]];
        }),
      ),
    selectors,
  );

test.describe("Navbar — the drawer moves on Drawer's durations", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 }, reducedMotion: "no-preference" });

  test("closes on the exit token and opens on the enter token, as a closed Drawer does", async ({ page }) => {
    const drawerBar = await render(Navbar({ config: CONFIG, resolveHref: (key: string) => `#${key}`, icon, collapsedAs: "drawer" }));
    const sheet = await render(Drawer({ id: "sheet", side: "left", titled: true, children: [Drawer.Title({ for: "sheet", children: "Sheet" })] }));
    await mount(page, `${await withCompiledCss(`${drawerBar}${sheet}`)}${MOTION_TOKENS}`);
    const targets = { panel: PANEL, backdrop: BACKDROP };

    const closed = await durations(page, { ...targets, drawer: "#sheet" });
    await page.evaluate(() => {
      (document.querySelector("[data-slot~='navbar']") as HTMLDetailsElement).open = true;
    });
    const open = await durations(page, targets);

    expect({ closed, open }).toEqual({
      closed: { panel: ["0.25s"], backdrop: ["0.25s"], drawer: ["0.25s"] },
      open: { panel: ["0.3s"], backdrop: ["0.3s"] },
    });
  });
});
