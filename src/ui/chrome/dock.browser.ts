import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import type { Size } from "../contracts/types";
import { Drawer } from "../core/drawer";
import { createIcon } from "../core/icon";
import { Dock } from "./dock";
import { Navbar } from "./navbar";
import type { DockHideAbove, DockItem, NavDefinition } from "./types";

const icon = createIcon("/sprite.svg", {
  "icon-home": "0 0 24 24",
  "icon-search": "0 0 24 24",
  "icon-user": "0 0 24 24",
  "icon-chevron-down": "0 0 16 16",
  "icon-hamburger": "0 0 22 22",
  "icon-close": "0 0 22 22",
});

const NAV: NavDefinition = { sections: [{ items: [{ label: "Home", href: "home" }] }] };

const ITEMS: DockItem<"home" | "search" | "user">[] = [
  { label: "Home", href: "home", icon: "home", current: true },
  { label: "Search", href: "search", icon: "search" },
  { label: "Profile", href: "profile", icon: "user" },
];

const BUTTONS = 40;

const MAIN = `<main>${Array.from({ length: BUTTONS }, (_, i) => `<button id="b${i + 1}" class="block h-10 w-full">b${i + 1}</button>`).join("")}</main>`;

function dock(props: { size?: Size; hideAbove?: DockHideAbove } = {}): Promise<string> {
  return render(Dock({ items: ITEMS, resolveHref: (k) => `#${k}`, icon, ...props }));
}

function focusedAndHit(page: Page): Promise<{ focused: string | undefined; hit: string | undefined }> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    const rect = (focused as Element).getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { focused: focused?.id, hit: hit?.closest("button")?.id };
  });
}

function clearance(page: Page): Promise<{ nav: number; scroll: number; body: number }> {
  return page.evaluate(() => ({
    nav: (document.querySelector("[data-slot~='dock']") as Element).getBoundingClientRect().height,
    scroll: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
    body: parseFloat(getComputedStyle(document.body).paddingBottom),
  }));
}

test.describe("Dock — a focused control is never hidden beneath the bar", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("every button reached by Tab is the element at its own centre, the last one included", async ({ page }) => {
    const html = `${MAIN}${await dock()}`;
    await mount(page, await withCompiledCss(html));
    await page.locator("#b1").focus();

    await expect.poll(() => focusedAndHit(page)).toEqual({ focused: "b1", hit: "b1" });
    for (let n = 2; n <= BUTTONS; n++) {
      await page.keyboard.press("Tab");
      await expect.poll(() => focusedAndHit(page)).toEqual({ focused: `b${n}`, hit: `b${n}` });
    }
  });

  for (const size of ["sm", "md", "lg"] as const) {
    test(`a ${size} dock reserves its own height as the page's scroll padding and body padding`, async ({ page }) => {
      const html = await dock({ size });
      await mount(page, await withCompiledCss(html));

      const { nav, scroll, body } = await clearance(page);
      expect({ scroll, body }).toEqual({ scroll: nav, body: nav });
      expect(nav).toBeGreaterThan(0);
    });
  }
});

test.describe("Dock — gives the clearance back above its breakpoint", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("a dock hidden above md leaves the page no scroll padding and no body padding", async ({ page }) => {
    const html = `${MAIN}${await dock()}`;
    await mount(page, await withCompiledCss(html));

    expect(
      await page.evaluate(() => ({
        scroll: getComputedStyle(document.documentElement).scrollPaddingBottom,
        body: getComputedStyle(document.body).paddingBottom,
      })),
    ).toEqual({ scroll: "0px", body: "0px" });
  });

  test("a dock that never hides keeps reserving its height at desktop width", async ({ page }) => {
    const html = `${MAIN}${await dock({ hideAbove: "never" })}`;
    await mount(page, await withCompiledCss(html));

    const { nav, scroll, body } = await clearance(page);
    expect({ scroll, body }).toEqual({ scroll: nav, body: nav });
    expect(nav).toBeGreaterThan(0);
  });
});

async function mountBeside(page: Page, placement: "top" | "bottom" | "right"): Promise<void> {
  const navbar = await render(Navbar({ config: NAV, resolveHref: (k: string) => `#${k}`, icon, placement }));
  const docked = await dock({ hideAbove: "never" });
  await mount(page, await withCompiledCss(placement === "top" ? `${navbar}${MAIN}${docked}` : `${MAIN}${navbar}${docked}`));
}

function edges(page: Page): Promise<{ navbar: number; dock: number; top: number; bottom: number }> {
  return page.evaluate(() => ({
    navbar: (document.querySelector("[data-slot~='navbar']") as Element).getBoundingClientRect().height,
    dock: (document.querySelector("[data-slot~='dock']") as Element).getBoundingClientRect().height,
    top: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
    bottom: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
  }));
}

test.describe("Dock — shares the foot of the page with a bottom Navbar", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("a bottom Navbar and a Dock add their heights into the page's scroll-padding-bottom", async ({ page }) => {
    await mountBeside(page, "bottom");

    const { navbar, dock: docked, bottom } = await edges(page);

    expect(bottom).toBe(navbar + docked);
    expect(Math.min(navbar, docked)).toBeGreaterThan(0);
  });

  for (const placement of ["bottom", "right"] as const) {
    test(`a ${placement} Navbar rests on top of the Dock, so its toggle is the element at its own centre`, async ({ page }) => {
      await mountBeside(page, placement);

      const stack = await page.evaluate(() => {
        const toggle = document.querySelector("[data-slot~='navbar-toggle']") as HTMLElement;
        const box = toggle.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          toggleHit: hit?.closest("[data-slot~='navbar-toggle']") === toggle,
          navbarBottom: Math.round((document.querySelector("[data-slot~='navbar']") as Element).getBoundingClientRect().bottom),
          dockTop: Math.round((document.querySelector("[data-slot~='dock']") as Element).getBoundingClientRect().top),
        };
      });

      expect({ toggleHit: stack.toggleHit, navbarBottom: stack.navbarBottom }).toEqual({ toggleHit: true, navbarBottom: stack.dockTop });
    });
  }

  test("a top Navbar reserves the top edge and leaves the foot of the page to the Dock", async ({ page }) => {
    await mountBeside(page, "top");

    const { navbar, dock: docked, top, bottom } = await edges(page);

    expect({ top, bottom }).toEqual({ top: navbar, bottom: docked });
    expect(Math.min(navbar, docked)).toBeGreaterThan(0);
  });

  test("an app's --forge-dock-height on html resizes the bar, its scroll padding and its body padding together", async ({ page }) => {
    await mount(page, `${await withCompiledCss(`${MAIN}${await dock()}`)}<style>html{--forge-dock-height:5rem}</style>`);

    expect(await clearance(page)).toEqual({ nav: 80, scroll: 80, body: 80 });
  });
});

async function mountSheet(page: Page, modal: boolean): Promise<void> {
  const sheet = await render(
    Drawer({
      id: "sheet",
      side: "bottom",
      open: !modal,
      label: "Sheet",
      children: Drawer.Footer({ children: Drawer.Close({ for: "sheet", id: "sheet-close", children: "Done" }) }),
    }),
  );
  await mount(page, await withCompiledCss(`${MAIN}${sheet}${await dock({ hideAbove: "never" })}`));
  if (modal) await page.evaluate(() => (document.querySelector("#sheet") as HTMLDialogElement).showModal());
}

function sheetStack(page: Page): Promise<{ closeHit: boolean; panelBottom: number; dockTop: number }> {
  return page.evaluate(() => {
    const close = document.querySelector("#sheet-close") as HTMLElement;
    const box = close.getBoundingClientRect();
    return {
      closeHit: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("#sheet-close") === close,
      panelBottom: Math.round((document.querySelector("#sheet") as Element).getBoundingClientRect().bottom),
      dockTop: Math.round((document.querySelector("[data-slot~='dock']") as Element).getBoundingClientRect().top),
    };
  });
}

test.describe("Dock — a bottom Drawer rests on top of it", { tag: "@cross-engine" }, () => {
  test.use({ viewport: { width: 375, height: 667 }, reducedMotion: "reduce" });

  test("a non-modal bottom Drawer rests on top of the Dock, so its last control is the element at its own centre", async ({ page }) => {
    await mountSheet(page, false);

    const stack = await sheetStack(page);
    expect({ closeHit: stack.closeHit, panelBottom: stack.panelBottom }).toEqual({ closeHit: true, panelBottom: stack.dockTop });
  });

  test("a modal bottom Drawer rests on top of the Dock too, its last control still the element at its own centre", async ({ page }) => {
    await mountSheet(page, true);

    const stack = await sheetStack(page);
    expect({ closeHit: stack.closeHit, panelBottom: stack.panelBottom }).toEqual({ closeHit: true, panelBottom: stack.dockTop });
  });
});
