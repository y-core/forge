import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { scopeAttrs } from "../server/scope-attrs";
import { Menu } from "./menu";

/**
 * `Menu` driven through the scope `ui/core/client` registers, so every case exercises the whole
 * path a consumer gets: SSR markup, the platform's popover, and forge's keyboard layer.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    activations: string[];
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

/** The demo scope wraps the menu so item clicks have an action to run. */
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
      trigger: document.querySelector("[data-slot='menu-trigger']")?.getAttribute("aria-haspopup"),
      items: [...document.querySelectorAll("[data-slot='menu-item']")].map((el) => el.getAttribute("role")),
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
    // **The regression this file was missing, and the shape of the miss is worth stating.** Every
    // other case here reads `:popover-open` or a state attribute — all of which were *correct* while
    // the popup rendered permanently visible on screen, because `POPUP_BASE` ended in a bare `flex`.
    //
    // A closed popover is hidden by the UA rule `[popover]:not(:popover-open) { display: none }`,
    // which is **not** `!important` — so any author-origin `display` on the same element beats it. The
    // component looked correct in the DOM and was a menu that never went away.
    //
    // Asserted on the **computed** display rather than on a class, because the class is the mechanism
    // and this is about the outcome: any future utility that reintroduces a `display` fails here.
    await mountMenu(page, ROWS);

    const closed = await page.evaluate(() => {
      const el = document.querySelector("#file-menu") as HTMLElement;
      return { popoverOpen: el.matches(":popover-open"), display: getComputedStyle(el).display };
    });
    expect(closed.popoverOpen).toBe(false);
    expect(closed.display, "a closed popup still has a display — an author `display` is beating the UA rule").toBe("none");

    // And the same claim after a real open/close round trip, which is where a user meets it.
    await page.click("[data-slot='menu-trigger']");
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

    await page.click("[data-slot='menu-trigger']");

    expect(await isOpen(page)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.querySelector("#file-menu")?.hasAttribute("data-open"))).toBe(true);
  });

  test("Escape closes it", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");

    await page.keyboard.press("Escape");

    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("a click outside light-dismisses it", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");

    await page.click("#before");

    await expect.poll(() => isOpen(page)).toBe(false);
  });
});

test.describe("Menu — keyboard", () => {
  test("focuses the first item when it opens", async ({ page }) => {
    await mountMenu(page, ROWS);

    await page.click("[data-slot='menu-trigger']");

    await expect.poll(() => focusedId(page)).toBe("new");
  });

  test("arrow keys navigate and skip a disabled item", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("open");
    await page.keyboard.press("ArrowDown");
    // "save" is disabled, so Down lands past it.
    expect(await focusedId(page)).toBe("quit");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("new");
  });

  test("Home and End jump to the ends", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("quit");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("new");
  });

  test("typeahead jumps to an item by its label", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("q");

    expect(await focusedId(page)).toBe("quit");
  });
});

test.describe("Menu — activation", () => {
  test("Enter activates the focused item and the platform closes the menu", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => window.activations)).toEqual(["open"]);
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("Space activates too", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press(" ");

    expect(await page.evaluate(() => window.activations)).toEqual(["new"]);
  });

  test("an item that opted out of closing runs its action and leaves the menu open", async ({ page }) => {
    await mountMenu(page, [{ id: "wrap", label: "Wrap", keepOpen: true }, ...ROWS]);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("wrap");

    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => window.activations)).toEqual(["wrap"]);
    expect(await isOpen(page)).toBe(true);
  });

  test("a disabled item activates nothing", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.evaluate(() => document.querySelector<HTMLElement>("#save")?.click());

    expect(await page.evaluate(() => window.activations)).toEqual([]);
  });
});

test.describe("Menu — focus restoration", () => {
  test("Escape returns focus to the trigger", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.focus("[data-slot='menu-trigger']");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("Escape");

    // Without restoration this is "" — focus falls to <body> and the keyboard user loses their place.
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-trigger");
  });

  test("selecting an item returns focus to the trigger", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.focus("[data-slot='menu-trigger']");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("Enter");

    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-trigger");
  });

  test("a click elsewhere keeps the focus the user chose", async ({ page }) => {
    await mountMenu(page, ROWS);
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.click("#before");

    // Focus is where the user put it; yanking it back to the trigger would be worse than the
    // problem restoration exists to fix.
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

    // A `<button>` would drop middle-click, open-in-new-tab and no-JS navigation; `command` is
    // absent because only a button can be an Invoker source and navigation unloads the page anyway.
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

    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("save");
    await page.keyboard.press("ArrowDown");

    expect(await focusedId(page)).toBe("docs");
  });
});

test.describe("Menu — submenus", () => {
  /** A File menu whose third row opens a nested Recent submenu. */
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
    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
  }

  test("the submenu trigger is itself a menu item in the parent's ring", async ({ page }) => {
    await openParent(page);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    const row = await page.evaluate(() => ({
      focused: document.activeElement?.getAttribute("data-slot"),
      haspopup: document.activeElement?.getAttribute("aria-haspopup"),
    }));
    // A bare `Menu.Trigger` carries no role, so this row would be skipped entirely.
    expect(row).toEqual({ focused: "menu-submenu-trigger", haspopup: "menu" });
  });

  test("a closed submenu's items are not in the parent's ring", async ({ page }) => {
    await openParent(page);

    await page.keyboard.press("End");

    // `Quit` follows the submenu popup in document order; without the visibility filter the ring
    // ends inside the closed submenu and End lands on a `display:none` row.
    expect(await focusedId(page)).toBe("quit");
  });

  test("opening the submenu leaves the parent open and moves focus into it", async ({ page }) => {
    await openParent(page);

    await page.click("[data-slot='menu-submenu-trigger']");

    await expect.poll(() => focusedId(page)).toBe("r0");
    expect(await isOpen(page)).toBe(true);
  });

  test("arrow keys inside the submenu do not also move the parent", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowDown");

    // `keydown` bubbles from the submenu to the parent popup, which is also vertical. Without the
    // `defaultPrevented` bail both controllers move and the parent's move wins.
    expect(await focusedId(page)).toBe("r1");
  });

  test("ArrowRight on a submenu trigger opens it and lands on its first row", async ({ page }) => {
    await openParent(page);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-submenu-trigger");

    await page.keyboard.press("ArrowRight");

    // Nothing about opening is reimplemented: ArrowRight clicks the row, the row's own
    // `command="toggle-popover"` opens the panel, and the nested popup's own `mountMenu` moves focus.
    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);
    await expect.poll(() => focusedId(page)).toBe("r0");
  });

  test("ArrowRight never closes a submenu that is already open", async ({ page }) => {
    // The row's command is `toggle-popover`, so a bare `.click()` would *invert* the key on the
    // second press. ARIA's menu pattern specifies ArrowRight as open-and-enter and never as close.
    // Focus is normally inside the submenu by now — but only because the nested popup's own
    // `mountMenu` moved it, and a popup rendered outside a menu scope has no such controller.
    await openParent(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-submenu-trigger");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);

    // Put focus back on the row with the submenu still open, then press it again.
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot='menu-submenu-trigger']")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);
  });

  test("ArrowRight on an ordinary row does nothing", async ({ page }) => {
    await openParent(page);
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowRight");

    // The key is only claimed on a row that has a submenu; anywhere else the parent must be left
    // exactly as it was rather than opening the nearest panel it can find.
    expect(await focusedId(page)).toBe("new");
    expect(await page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
  });

  test("ArrowLeft inside a submenu closes it and returns focus to its trigger", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    // Only the submenu: ArrowLeft is a step back up the menu tree, not a dismissal of the whole thing.
    expect(await isOpen(page)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-submenu-trigger");
  });

  test("ArrowLeft in a top-level menu leaves it open", async ({ page }) => {
    await openParent(page);
    await expect.poll(() => focusedId(page)).toBe("new");

    await page.keyboard.press("ArrowLeft");

    // A top-level panel has nothing to step back to, and closing it here would make ArrowLeft a
    // second, less discoverable Escape.
    expect(await isOpen(page)).toBe(true);
    expect(await focusedId(page)).toBe("new");
  });

  test("ArrowLeft in a submenu does not also close the parent", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowLeft");

    // `keydown` bubbles from the submenu to the parent popup, whose controller would otherwise read
    // the same press. The `defaultPrevented` bail is what stops both from acting on one key.
    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    expect(await isOpen(page)).toBe(true);
  });

  test("Escape closes only the submenu and returns focus to its trigger", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("Escape");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    expect(await isOpen(page)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("menu-submenu-trigger");
  });
});

test.describe("Menu — items replaced between openings", () => {
  test("navigates a rebuilt item set without re-mounting", async ({ page }) => {
    await mountMenu(page, ROWS);

    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("new");
    await page.keyboard.press("Escape");
    await expect.poll(() => isOpen(page)).toBe(false);

    // The shape a context menu built from synchronous callbacks has: entirely different rows, built
    // in the browser, between one opening and the next.
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

    await page.click("[data-slot='menu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("cut");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("copy");
    await page.keyboard.press("p");
    expect(await focusedId(page)).toBe("paste");

    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.activations)).toEqual(["paste"]);
  });
});
