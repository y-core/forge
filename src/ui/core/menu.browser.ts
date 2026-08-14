import { expect, type Page, test } from "@playwright/test";
import type { JSXNode } from "../../jsx/types";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { scopeAttrs } from "../contracts/scope-attrs";
import { Menu } from "./menu";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    activations: string[];
    keyClaims: { key: string; prevented: boolean }[];
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

interface Row {
  id: string;
  label: string;
  disabled?: boolean;
  keepOpen?: boolean;
}

async function menuMarkup(rows: Row[]): Promise<string> {
  const popup = Menu.Popup({
    id: "file-menu",
    children: rows.map((row) =>
      Menu.Item({
        id: row.id,
        for: row.keepOpen ? false : "file-menu",
        ...(row.disabled ? { disabled: true } : {}),
        ...scopeAttrs({ onClick: "pick" }),
        children: row.label,
      }),
    ),
  });
  const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
  return `<button id="before">before</button>${html}`;
}

async function start(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.activations = [];
    window.forgeResume.registerScope("demo", { on: { pick: (ctx) => window.activations.push(ctx.el.id) } });
    window.forgeResume.resume();
  });
}

async function mountMenu(page: Page, rows: Row[]): Promise<void> {
  const inner = await menuMarkup(rows);
  await mount(page, `<div data-scope="demo">${inner}</div>`, EXPOSE);
  await start(page);
}

function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

function isOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector("#file-menu")?.matches(":popover-open") ?? false);
}

const ROWS: Row[] = [
  { id: "new", label: "New" },
  { id: "open", label: "Open" },
  { id: "save", label: "Save", disabled: true },
  { id: "quit", label: "Quit" },
];

test.describe("Menu — anatomy", () => {
  test("announces the menu and its items with the ARIA menu roles", async ({ page }) => {
    await mountMenu(page, ROWS);

    const roles = await page.evaluate(() => ({
      popup: document.querySelector("#file-menu")?.getAttribute("role"),
      trigger: document.querySelector("[data-slot~='menu-trigger']")?.getAttribute("aria-haspopup"),
      items: [...document.querySelectorAll("[data-slot~='menu-item']")].map((el) => el.getAttribute("role")),
    }));

    expect(roles).toEqual({ popup: "menu", trigger: "menu", items: ["menuitem", "menuitem", "menuitem", "menuitem"] });
  });

  test("carries the closed state before it is ever opened", async ({ page }) => {
    await mountMenu(page, ROWS);

    const state = await page.evaluate(() => {
      const el = document.querySelector("#file-menu");
      return { open: el?.hasAttribute("data-open"), closed: el?.hasAttribute("data-closed") };
    });

    expect(state).toEqual({ open: false, closed: true });
  });

  test("a closed popup is actually not rendered, not merely marked closed", async ({ page }) => {
    await mountMenu(page, ROWS);

    const closed = await page.evaluate(() => {
      const el = document.querySelector("#file-menu") as HTMLElement;
      return { popoverOpen: el.matches(":popover-open"), display: getComputedStyle(el).display };
    });
    expect(closed.popoverOpen).toBe(false);
    expect(closed.display, "a closed popup still has a display — an author `display` is beating the UA rule").toBe("none");

    await page.click("[data-slot~='menu-trigger']");
    await page.keyboard.press("Escape");
    await expect.poll(() => isOpen(page)).toBe(false);
    const reclosed = await page.evaluate(() => {
      const el = document.querySelector("#file-menu") as HTMLElement;
      return { popoverOpen: el.matches(":popover-open"), display: getComputedStyle(el).display };
    });
    expect(reclosed).toEqual({ popoverOpen: false, display: "none" });
  });

  test("renders checkbox and radio items with their own roles and checked state", async ({ page }) => {
    const html = await render(
      Menu.Popup({
        id: "m",
        children: [
          Menu.CheckboxItem({ id: "wrap", checked: true, for: false, children: "Wrap" }),
          Menu.RadioItem({ id: "dark", checked: false, for: false, children: "Dark" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);

    const items = await page.evaluate(() =>
      [...document.querySelectorAll("#m > *")].map((el) => ({
        role: el.getAttribute("role"),
        aria: el.getAttribute("aria-checked"),
        data: el.hasAttribute("data-checked"),
      })),
    );

    expect(items).toEqual([
      { role: "menuitemcheckbox", aria: "true", data: true },
      { role: "menuitemradio", aria: "false", data: false },
    ]);
  });
});

test.describe("Menu — the platform opens and closes it", () => {
  test("the trigger's native command opens the popup and publishes the open state", async ({ page }) => {
    await mountMenu(page, ROWS);

    await page.click("[data-slot~='menu-trigger']");

    expect(await isOpen(page)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.querySelector("#file-menu")?.hasAttribute("data-open"))).toBe(true);
  });

  test("Escape closes it", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");

    await page.keyboard.press("Escape");

    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("a click outside light-dismisses it", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");

    await page.click("#before");

    await expect.poll(() => isOpen(page)).toBe(false);
  });
});

test.describe("Menu — keyboard", () => {
  test("focuses the first item when it opens", async ({ page }) => {
    await mountMenu(page, ROWS);

    await page.click("[data-slot~='menu-trigger']");

    await expect.poll(() => focusedId(page)).toBe("new");
  });

  test("arrow keys navigate and skip a disabled item", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("open");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("quit");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("new");
  });

  test("Home and End jump to the ends", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("quit");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("new");
  });

  test("typeahead jumps to an item by its label", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("q");

    expect(await focusedId(page)).toBe("quit");
  });
});

test.describe("Menu — activation", () => {
  test("Enter activates the focused item and the platform closes the menu", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => window.activations)).toEqual(["open"]);
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("Space activates too", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press(" ");

    expect(await page.evaluate(() => window.activations)).toEqual(["new"]);
  });

  test("an item that opted out of closing runs its action and leaves the menu open", async ({ page }) => {
    await mountMenu(page, [{ id: "wrap", label: "Wrap", keepOpen: true }, ...ROWS]);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("wrap");

    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => window.activations)).toEqual(["wrap"]);
    expect(await isOpen(page)).toBe(true);
  });

  test("a disabled item activates nothing", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.evaluate(() => document.querySelector<HTMLElement>("#save")?.click());

    expect(await page.evaluate(() => window.activations)).toEqual([]);
  });
});

test.describe("Menu — focus restoration", () => {
  test("Escape returns focus to the trigger", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.focus("[data-slot~='menu-trigger']");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("Escape");

    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? [])).toEqual(["menu-trigger"]);
  });

  test("selecting an item returns focus to the trigger", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.focus("[data-slot~='menu-trigger']");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("Enter");

    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? [])).toEqual(["menu-trigger"]);
  });

  test("a click elsewhere keeps the focus the user chose", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.click("#before");

    await expect.poll(() => focusedId(page)).toBe("before");
  });
});

test.describe("Menu — link items", () => {
  test("a link row is a menu item and stays a real anchor", async ({ page }) => {
    const html = await render(
      Menu.Popup({
        id: "m",
        children: [Menu.Item({ id: "save", for: "m", children: "Save" }), Menu.LinkItem({ id: "docs", href: "/docs", children: "Docs" })],
      }),
    );
    await mount(page, html, EXPOSE);

    const link = await page.evaluate(() => {
      const el = document.querySelector("#docs");
      return { tag: el?.tagName, role: el?.getAttribute("role"), href: el?.getAttribute("href"), command: el?.hasAttribute("command") };
    });

    expect(link).toEqual({ tag: "A", role: "menuitem", href: "/docs", command: false });
  });

  test("arrow navigation reaches a link row, because the ring is role-based", async ({ page }) => {
    const popup = Menu.Popup({
      id: "file-menu",
      children: [Menu.Item({ id: "save", for: "file-menu", children: "Save" }), Menu.LinkItem({ id: "docs", href: "#docs", children: "Docs" })],
    });
    const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
    await mount(page, html, EXPOSE);
    await start(page);

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("save");
    await page.keyboard.press("ArrowDown");

    expect(await focusedId(page)).toBe("docs");
  });
});

test.describe("Menu — submenus", () => {
  async function nestedMarkup(): Promise<string> {
    const submenu = Menu.Popup({
      id: "recent-menu",
      children: [Menu.Item({ id: "r0", for: "recent-menu", children: "alpha" }), Menu.Item({ id: "r1", for: "recent-menu", children: "beta" })],
    });
    const popup = Menu.Popup({
      id: "file-menu",
      children: [
        Menu.Item({ id: "new", for: "file-menu", children: "New" }),
        Menu.Item({ id: "open", for: "file-menu", children: "Open" }),
        Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent" }),
        submenu,
        Menu.Item({ id: "quit", for: "file-menu", children: "Quit" }),
      ],
    });
    return render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
  }

  async function openParent(page: Page): Promise<void> {
    await mount(page, await nestedMarkup(), EXPOSE);
    await start(page);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
  }

  test("the submenu trigger is itself a menu item in the parent's ring", async ({ page }) => {
    await openParent(page);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    const row = await page.evaluate(() => ({
      focused: document.activeElement?.getAttribute("data-slot")?.split(" ") ?? [],
      haspopup: document.activeElement?.getAttribute("aria-haspopup"),
    }));
    expect(row).toEqual({ focused: ["menu-submenu-trigger"], haspopup: "menu" });
  });

  test("a closed submenu's items are not in the parent's ring", async ({ page }) => {
    await openParent(page);

    await page.keyboard.press("End");

    expect(await focusedId(page)).toBe("quit");
  });

  test("opening the submenu leaves the parent open and moves focus into it", async ({ page }) => {
    await openParent(page);

    await page.click("[data-slot~='menu-submenu-trigger']");

    await expect.poll(() => focusedId(page)).toBe("r0");
    expect(await isOpen(page)).toBe(true);
  });

  test("arrow keys inside the submenu do not also move the parent", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowDown");

    expect(await focusedId(page)).toBe("r1");
  });

  test("ArrowRight on a submenu trigger opens it and lands on its first row", async ({ page }) => {
    await openParent(page);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);

    await page.keyboard.press("ArrowRight");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);
    await expect.poll(() => focusedId(page)).toBe("r0");
  });

  test("ArrowRight never closes a submenu that is already open", async ({ page }) => {
    await openParent(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);

    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='menu-submenu-trigger']")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);
  });

  test("ArrowRight on an ordinary row does nothing", async ({ page }) => {
    await openParent(page);
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("new");
    expect(await page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
  });

  test("ArrowLeft inside a submenu closes it and returns focus to its trigger", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    expect(await isOpen(page)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);
  });

  test("ArrowLeft in a top-level menu leaves it open", async ({ page }) => {
    await openParent(page);
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowLeft");

    expect(await isOpen(page)).toBe(true);
    expect(await focusedId(page)).toBe("new");
  });

  test("ArrowLeft in a submenu does not also close the parent", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    expect(await isOpen(page)).toBe(true);
  });

  test("Escape closes only the submenu and returns focus to its trigger", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("Escape");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    expect(await isOpen(page)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);
  });
});

function submenuRows(): JSXNode[] {
  return [Menu.Item({ id: "r0", for: "recent-menu", children: "alpha" }), Menu.Item({ id: "r1", for: "recent-menu", children: "beta" })];
}

async function submenuMarkup(dir: "ltr" | "rtl", dirOn: "wrapper" | "popup"): Promise<string> {
  const popup = Menu.Popup({
    id: "file-menu",
    ...(dirOn === "popup" ? { dir } : {}),
    children: [
      Menu.Item({ id: "new", for: "file-menu", children: "New" }),
      Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent" }),
      Menu.Popup({ id: "recent-menu", children: submenuRows() }),
      Menu.Item({ id: "quit", for: "file-menu", children: "Quit" }),
    ],
  });
  const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
  return `<div dir="${dirOn === "popup" ? "ltr" : dir}">${html}</div>`;
}

function submenuOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open") ?? false);
}

function focusedSlots(page: Page): Promise<string[]> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
}

const DIRECTIONS = [
  { dir: "ltr", toward: "ArrowRight", away: "ArrowLeft" },
  { dir: "rtl", toward: "ArrowLeft", away: "ArrowRight" },
] as const;

test.describe("Menu — submenu keys mirror with the writing direction", () => {
  async function openParentIn(page: Page, dir: "ltr" | "rtl", dirOn: "wrapper" | "popup" = "wrapper"): Promise<void> {
    await mount(page, await submenuMarkup(dir, dirOn), EXPOSE);
    await start(page);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
  }

  async function focusSubmenuRow(page: Page): Promise<void> {
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
  }

  for (const { dir, toward, away } of DIRECTIONS) {
    test(`dir=${dir}: ${toward} — the key pointing at the submenu — opens it`, async ({ page }) => {
      await openParentIn(page, dir);
      await focusSubmenuRow(page);

      await page.keyboard.press(toward);

      await expect.poll(() => submenuOpen(page)).toBe(true);
      await expect.poll(() => focusedId(page)).toBe("r0");
    });

    test(`dir=${dir}: ${away} — the key pointing away — closes the open nested panel`, async ({ page }) => {
      await openParentIn(page, dir);
      await focusSubmenuRow(page);
      await page.keyboard.press(toward);
      await expect.poll(() => focusedId(page)).toBe("r0");

      await page.keyboard.press(away);

      await expect.poll(() => submenuOpen(page)).toBe(false);
      expect(await isOpen(page)).toBe(true);
      await expect.poll(() => focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    });

    test(`dir=${dir}: ${away} does NOT open the submenu`, async ({ page }) => {
      await openParentIn(page, dir);
      await focusSubmenuRow(page);

      await page.keyboard.press(away);

      expect(await submenuOpen(page)).toBe(false);
      expect(await focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    });
  }

  test("an RTL panel inside an LTR page mirrors, because direction is read off the popup", async ({ page }) => {
    await openParentIn(page, "rtl", "popup");

    const directions = await page.evaluate(() => ({
      document: getComputedStyle(document.documentElement).direction,
      popup: getComputedStyle(document.querySelector("#file-menu") as Element).direction,
      submenu: getComputedStyle(document.querySelector("#recent-menu") as Element).direction,
    }));
    expect(directions).toEqual({ document: "ltr", popup: "rtl", submenu: "rtl" });

    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => submenuOpen(page)).toBe(true);
    await expect.poll(() => focusedId(page)).toBe("r0");
  });

  test("in RTL the toward-key over a row with no submenu opens nothing and leaves the key unclaimed", async ({ page }) => {
    await openParentIn(page, "rtl");
    await page.evaluate(() => {
      window.keyClaims = [];
      document.addEventListener("keydown", (event) => window.keyClaims.push({ key: event.key, prevented: event.defaultPrevented }));
    });

    expect(await focusedId(page)).toBe("new");
    await page.keyboard.press("ArrowLeft");
    const afterPlainRow = { submenu: await submenuOpen(page), parent: await isOpen(page), focused: await focusedId(page) };

    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => submenuOpen(page)).toBe(true);

    expect(afterPlainRow).toEqual({ submenu: false, parent: true, focused: "new" });
    const claims = await page.evaluate(() => window.keyClaims.filter((c) => c.key === "ArrowLeft").map((c) => c.prevented));
    expect(claims).toEqual([false, true]);
  });
});

async function shadowMenuMarkup(): Promise<string> {
  const popup = Menu.Popup({
    id: "file-menu",
    children: [
      Menu.Item({ id: "new", for: "file-menu", children: "New" }),
      Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent" }),
      Menu.Popup({ id: "recent-menu", children: submenuRows() }),
      Menu.Item({ id: "quit", for: "file-menu", children: "Quit" }),
    ],
  });
  const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
  return `<div id="host"></div><template id="source">${html}</template>`;
}

async function lightParentShadowSubmenuMarkup(): Promise<string> {
  const popup = Menu.Popup({
    id: "file-menu",
    children: [Menu.Item({ id: "new", for: "file-menu", children: "New" }), Menu.Item({ id: "quit", for: "file-menu", children: "Quit" })],
  });
  const outer = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
  const inner = await render(Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent" }));
  const panel = await render(Menu.Popup({ id: "recent-menu", children: submenuRows() }));
  return `${outer}<template id="source">${inner}${panel}</template>`;
}

test.describe("Menu — a submenu across a shadow boundary", () => {
  async function attachAndResume(page: Page, hostSelector: string): Promise<void> {
    await page.evaluate((selector) => {
      const host = document.querySelector(selector);
      const template = document.querySelector<HTMLTemplateElement>("#source");
      if (!host || !template) return;
      host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
      window.activations = [];
      window.forgeResume.resume();
    }, hostSelector);
  }

  function shadowFocusedId(page: Page): Promise<string | null> {
    return page.evaluate(() => document.querySelector("#host")?.shadowRoot?.activeElement?.id ?? null);
  }

  function shadowFocusedSlots(page: Page): Promise<string[]> {
    return page.evaluate(() => document.querySelector("#host")?.shadowRoot?.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
  }

  function shadowSubmenuOpen(page: Page): Promise<boolean> {
    return page.evaluate(() => document.querySelector("#host")?.shadowRoot?.querySelector("#recent-menu")?.matches(":popover-open") ?? false);
  }

  function armAnchorProbe(page: Page, where: "light" | "shadow"): Promise<string> {
    return page.evaluate((scope) => {
      const popup =
        scope === "shadow"
          ? document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("#recent-menu")
          : document.querySelector<HTMLElement>("#file-menu");
      popup?.style.setProperty("position-anchor", "--probe");
      return popup?.style.getPropertyValue("position-anchor") ?? "";
    }, where);
  }

  function readAnchorProbe(page: Page, where: "light" | "shadow"): Promise<string> {
    return page.evaluate((scope) => {
      const popup =
        scope === "shadow"
          ? document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("#recent-menu")
          : document.querySelector<HTMLElement>("#file-menu");
      return popup?.style.getPropertyValue("position-anchor") ?? "";
    }, where);
  }

  test("a nested popup whose parent panel is outside its shadow root still reports nested", async ({ page }) => {
    await mount(page, await lightParentShadowSubmenuMarkup(), EXPOSE);
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "host";
      document.querySelector("#quit")?.before(host);
    });
    await attachAndResume(page, "#host");

    const shape = await page.evaluate(() => {
      const popup = document.querySelector("#host")?.shadowRoot?.querySelector("#recent-menu");
      return {
        parentIsShadowRoot: popup?.parentNode?.nodeType === 11,
        parentElementIsNull: popup?.parentElement === null,
        hostIsInsidePanel: document.querySelector("#host")?.closest("[data-slot~='menu-popup']")?.id ?? null,
      };
    });
    expect(shape).toEqual({ parentIsShadowRoot: true, parentElementIsNull: true, hostIsInsidePanel: "file-menu" });

    const armed = await armAnchorProbe(page, "shadow");
    expect(armed, "position-anchor did not stick, so the anchor-binding probe below asserts nothing").toBe("--probe");

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => shadowSubmenuOpen(page)).toBe(true);
    expect(await isOpen(page)).toBe(true);
    await expect.poll(() => shadowFocusedId(page)).toBe("r0");

    expect(await readAnchorProbe(page, "shadow")).toBe("");

    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => shadowSubmenuOpen(page)).toBe(false);
    await expect.poll(() => shadowFocusedSlots(page)).toEqual(["menu-submenu-trigger"]);
  });

  test("a top-level panel still reports NOT nested", async ({ page }) => {
    await mount(page, await submenuMarkup("ltr", "wrapper"), EXPOSE);
    await start(page);

    const armed = await armAnchorProbe(page, "light");
    expect(armed, "position-anchor did not stick, so the anchor-binding probe below asserts nothing").toBe("--probe");

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
    await page.keyboard.press("ArrowLeft");

    expect(await isOpen(page)).toBe(true);
    expect(await focusedId(page)).toBe("new");
    expect(await readAnchorProbe(page, "light")).toBe("--probe");
  });

  test("the toward-key never closes an already-open submenu inside a shadow root", async ({ page }) => {
    await mount(page, await shadowMenuMarkup(), EXPOSE);
    await attachAndResume(page, "#host");

    await page.evaluate(() => document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("[data-slot~='menu-trigger']")?.click());
    await expect.poll(() => shadowFocusedId(page)).toBe("new");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => shadowFocusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => shadowSubmenuOpen(page)).toBe(true);

    await page.evaluate(() =>
      document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("[data-slot~='menu-submenu-trigger']")?.focus(),
    );
    await page.keyboard.press("ArrowRight");

    expect(await shadowSubmenuOpen(page)).toBe(true);
    expect(await page.evaluate(() => document.getElementById("recent-menu") === null)).toBe(true);
  });
});

test.describe("Menu — items replaced between openings", () => {
  test("navigates a rebuilt item set without re-mounting", async ({ page }) => {
    await mountMenu(page, ROWS);

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
    await page.keyboard.press("Escape");
    await expect.poll(() => isOpen(page)).toBe(false);

    await page.evaluate(() => {
      const popup = document.querySelector("#file-menu");
      if (!popup) return;
      popup.replaceChildren();
      for (const [id, label] of [
        ["cut", "Cut"],
        ["copy", "Copy"],
        ["paste", "Paste"],
      ]) {
        const item = document.createElement("button");
        item.type = "button";
        item.id = id ?? "";
        item.setAttribute("role", "menuitem");
        item.setAttribute("data-on-click", "pick");
        item.textContent = label ?? "";
        popup.append(item);
      }
    });

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("cut");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("copy");
    await page.keyboard.press("p");
    expect(await focusedId(page)).toBe("paste");

    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.activations)).toEqual(["paste"]);
  });
});
