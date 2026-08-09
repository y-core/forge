import { expect, type Page, test } from "@playwright/test";
import type { JSXNode } from "../../jsx/types";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { scopeAttrs } from "../contracts/scope-attrs";
import { Menu } from "./menu";

/**
 * `Menu` driven through the scope `ui/core/client` registers, so every case exercises the whole
 * path a consumer gets: SSR markup, the platform's popover, and forge's keyboard layer.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    activations: string[];
    /** Every keydown seen at the document, with whether the menu's handler had claimed it by then. */
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
    // "save" is disabled, so Down lands past it.
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

    // Without restoration this is "" — focus falls to <body> and the keyboard user loses their place.
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

    await page.click("[data-slot~='menu-trigger']");
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
    // A bare `Menu.Trigger` carries no role, so this row would be skipped entirely. `data-slot` is a
    // token list and is compared as one; `aria-haspopup` is a single value and is compared whole.
    expect(row).toEqual({ focused: ["menu-submenu-trigger"], haspopup: "menu" });
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

    await page.click("[data-slot~='menu-submenu-trigger']");

    await expect.poll(() => focusedId(page)).toBe("r0");
    expect(await isOpen(page)).toBe(true);
  });

  test("arrow keys inside the submenu do not also move the parent", async ({ page }) => {
    await openParent(page);
    await page.click("[data-slot~='menu-submenu-trigger']");
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
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);

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
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(true);

    // Put focus back on the row with the submenu still open, then press it again.
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='menu-submenu-trigger']")?.focus());
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
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => page.evaluate(() => document.querySelector("#recent-menu")?.matches(":popover-open"))).toBe(false);
    // Only the submenu: ArrowLeft is a step back up the menu tree, not a dismissal of the whole thing.
    expect(await isOpen(page)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
      .toEqual(["menu-submenu-trigger"]);
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
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => focusedId(page)).toBe("r0");

    await page.keyboard.press("ArrowLeft");

    // `keydown` bubbles from the submenu to the parent popup, whose controller would otherwise read
    // the same press. The `defaultPrevented` bail is what stops both from acting on one key.
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

// ─── Direction-resolved submenu keys ─────────────────────────────────────────

/** The submenu popup's own rows. A factory rather than a shared constant, so no two fixtures ever
 * render the same node objects and a rendering that touched its input could not couple them. */
function submenuRows(): JSXNode[] {
  return [Menu.Item({ id: "r0", for: "recent-menu", children: "alpha" }), Menu.Item({ id: "r1", for: "recent-menu", children: "beta" })];
}

/**
 * A File menu whose second row opens a nested Recent submenu, with `dir` placed where the case needs
 * it.
 *
 * `"wrapper"` puts it on an ancestor of the whole compound — a page laid out right-to-left. `"popup"`
 * puts it on the panel element itself inside an explicitly `ltr` wrapper, which is the arrangement a
 * document-level direction read gets wrong and an element-level one gets right.
 */
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

/** `data-slot` is a token list, so it is parsed to one before anything is asserted about it. */
function focusedSlots(page: Page): Promise<string[]> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
}

/**
 * ARIA's menu pattern specifies the two horizontal submenu keys as **mirrored** in RTL: the key
 * pointing *at* the submenu opens it and the key pointing *away* closes it, in both directions. One
 * table rather than two suites, because the mirroring is only legible when the two rows sit together
 * and expect different keys — and because that is also what makes each row falsifiable. A controller
 * that hardcoded either physical key would pass one row and fail the other.
 */
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

  /** One row down from the opening position, which is the row that has a submenu. */
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
      // Nothing about opening is reimplemented: the key clicks the row, the row's own
      // `command="toggle-popover"` opens the panel, and the nested popup's `mountMenu` moves focus.
      await expect.poll(() => focusedId(page)).toBe("r0");
    });

    test(`dir=${dir}: ${away} — the key pointing away — closes the open nested panel`, async ({ page }) => {
      await openParentIn(page, dir);
      await focusSubmenuRow(page);
      await page.keyboard.press(toward);
      await expect.poll(() => focusedId(page)).toBe("r0");

      await page.keyboard.press(away);

      await expect.poll(() => submenuOpen(page)).toBe(false);
      // A step back up the menu tree, not a dismissal of the whole thing.
      expect(await isOpen(page)).toBe(true);
      await expect.poll(() => focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    });

    test(`dir=${dir}: ${away} does NOT open the submenu`, async ({ page }) => {
      // The half that stops the pair from being vacuous. Without it a controller that opened the
      // submenu on *either* horizontal key would satisfy both rows of the table above.
      await openParentIn(page, dir);
      await focusSubmenuRow(page);

      await page.keyboard.press(away);

      expect(await submenuOpen(page)).toBe(false);
      expect(await focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    });
  }

  test("an RTL panel inside an LTR page mirrors, because direction is read off the popup", async ({ page }) => {
    // The highest-value case in this describe: it is the one a document-level or `documentElement`
    // read fails outright, and the one no amount of page-level `dir` testing reaches.
    await openParentIn(page, "rtl", "popup");

    const directions = await page.evaluate(() => ({
      document: getComputedStyle(document.documentElement).direction,
      popup: getComputedStyle(document.querySelector("#file-menu") as Element).direction,
      submenu: getComputedStyle(document.querySelector("#recent-menu") as Element).direction,
    }));
    // The disagreement IS the setup: a global read answers `ltr` here and would pick the wrong key.
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
      // Bubble phase at the document, so it runs *after* the popup's own handler and reads whatever
      // that handler decided. `defaultPrevented` is the platform's own flag, not a count of calls into
      // a fixture — it is the signal the parent controller reads to know a key was claimed.
      document.addEventListener("keydown", (event) => window.keyClaims.push({ key: event.key, prevented: event.defaultPrevented }));
    });

    // `#new` has no submenu, so the toward-key has nothing to point at.
    expect(await focusedId(page)).toBe("new");
    await page.keyboard.press("ArrowLeft");
    const afterPlainRow = { submenu: await submenuOpen(page), parent: await isOpen(page), focused: await focusedId(page) };

    // The same physical key over the row that *does* have a submenu. Without this second half the
    // assertion below would pass against a controller with no keydown handler at all.
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => submenuOpen(page)).toBe(true);

    expect(afterPlainRow).toEqual({ submenu: false, parent: true, focused: "new" });
    const claims = await page.evaluate(() => window.keyClaims.filter((c) => c.key === "ArrowLeft").map((c) => c.prevented));
    expect(claims).toEqual([false, true]);
  });
});

// ─── Submenus across a shadow boundary ───────────────────────────────────────

/**
 * The whole nested menu inside one shadow root — trigger, panel, submenu row and submenu panel.
 *
 * This is the arrangement a web component encapsulating a menu produces, and the one the open-state
 * guard's id lookup depends on: the parent panel is itself in the shadow tree, so resolving
 * `commandfor` against the panel's own root reaches the submenu and resolving it against the document
 * does not.
 */
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

/**
 * The parent panel in the light DOM with **only the submenu** inside a shadow root, whose host is one
 * of the panel's own rows.
 *
 * That is the arrangement the nested-ness climb turns on. The submenu popup's parent is a
 * `ShadowRoot`, which `parentElement` reports as `null` — so a climb starting from `parentElement`
 * loses the boundary entirely and classifies the submenu as top-level. The host div is inserted in the
 * browser rather than rendered, because a `Menu.Popup`'s children are JSX and a bare shadow host is
 * not one of the row shapes the component offers.
 */
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
  /** Attach the template's contents to a shadow root, then resume — whose eager pass descends into
   * open roots at any depth, so a menu scope inside one is discovered like any other. */
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

  /** `document.activeElement` stops at the host, so the deep read is the only way to ask. */
  function shadowFocusedId(page: Page): Promise<string | null> {
    return page.evaluate(() => document.querySelector("#host")?.shadowRoot?.activeElement?.id ?? null);
  }

  /** `data-slot` is a token list, so it is parsed to one before anything is asserted about it. */
  function shadowFocusedSlots(page: Page): Promise<string[]> {
    return page.evaluate(() => document.querySelector("#host")?.shadowRoot?.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
  }

  function shadowSubmenuOpen(page: Page): Promise<boolean> {
    return page.evaluate(() => document.querySelector("#host")?.shadowRoot?.querySelector("#recent-menu")?.matches(":popover-open") ?? false);
  }

  /**
   * Pre-set an inline `position-anchor` on a popup, and report what stuck.
   *
   * This is the observable for "an anchor binding is mounted on this popup". `mountAnchorBinding`'s
   * open path clears `position-anchor` **before** it resolves a trigger, so the property surviving an
   * open means no binding is listening and the property vanishing means one is — a DOM-state read that
   * does not depend on the trigger lookup succeeding. It cannot: `triggersFor` queries the *document*,
   * which sees nothing inside a shadow root. That degradation is pre-existing and systemic (it is
   * recorded in the task rather than fixed by it), and probing the clear rather than the write is what
   * keeps this case measuring nested-ness instead of measuring that unrelated gap.
   *
   * The return value is asserted by every caller, never ignored: `position-anchor` is only settable if
   * the browser recognises it, and an unrecognised property would make the probe silently vacuous.
   */
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

  /** What the probed popup's inline `position-anchor` says now — `""` once a binding has cleared it. */
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
      // A row of the parent panel, so the panel is a shadow-crossing ancestor of what goes inside.
      document.querySelector("#quit")?.before(host);
    });
    await attachAndResume(page, "#host");

    // Pin the shape the fix turns on, so the case cannot quietly stop being about a shadow boundary.
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
    // Through the row's own invoker; `commandfor` resolves inside the shadow tree that holds both.
    //
    // **A real click, not `el.click()`** — Playwright's selector engine pierces an open shadow root,
    // so the row is reachable, and the browser's own input path focuses a `<button>` on mousedown
    // where a programmatic `.click()` dispatches the event and leaves focus untouched. That
    // difference decides the last assertion of this case: `mountMenu` captures its `opener` as
    // whatever was focused when the submenu opened, so a synthetic click leaves the parent panel's
    // `#new` as the opener and the away-key restores focus there — correctly, and to an element that
    // says nothing about the row.
    await page.click("[data-slot~='menu-submenu-trigger']");
    await expect.poll(() => shadowSubmenuOpen(page)).toBe(true);
    // The platform premise this whole arrangement rests on, asserted rather than assumed: the
    // Popover API treats a `popover=auto` inside a shadow root as **nested** relative to a light-DOM
    // ancestor panel, so opening the submenu does not light-dismiss the parent. Were it not so, the
    // parent would be gone by now and everything below would be reading a torn-down menu — a way for
    // this case to stop being about nested-ness without a single assertion changing.
    expect(await isOpen(page)).toBe(true);
    await expect.poll(() => shadowFocusedId(page)).toBe("r0");

    // First observable of nested-ness: the anchor binding was mounted and cleared the probe on open.
    expect(await readAnchorProbe(page, "shadow")).toBe("");

    // Second observable, and the one a user meets: the away-key closes a nested panel and is a no-op
    // on a top-level one. Climbing from `parentElement` classifies this as top-level, and the key
    // becomes dead.
    await page.keyboard.press("ArrowLeft");

    await expect.poll(() => shadowSubmenuOpen(page)).toBe(false);
    await expect.poll(() => shadowFocusedSlots(page)).toEqual(["menu-submenu-trigger"]);
  });

  test("a top-level panel still reports NOT nested", async ({ page }) => {
    // The converse, and the reason it is written down: the climb has to start at the popup's **parent**
    // because `closest` matches the element it starts from. Starting at the popup itself would match
    // the popup's own `[data-slot~="menu-popup"]` and make every panel in the library nested — the
    // away-key would close a top-level menu like a second Escape, and every panel would take an anchor
    // binding it does not need. Neither shows up in a nested-submenu case, so without this assertion
    // that one-word mistake ships green.
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
    // The shadow-DOM mirror of "ArrowRight never closes a submenu that is already open" above. The row's
    // command is `toggle-popover`, so the open-state guard is the only thing standing between a second
    // press and an inverted key — and a *document*-scoped id lookup cannot see a shadow-scoped id, so
    // it answers `null`, the guard reads that as "not open", and the click closes the panel.
    await mount(page, await shadowMenuMarkup(), EXPOSE);
    await attachAndResume(page, "#host");

    await page.evaluate(() => document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("[data-slot~='menu-trigger']")?.click());
    await expect.poll(() => shadowFocusedId(page)).toBe("new");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => shadowFocusedSlots(page)).toEqual(["menu-submenu-trigger"]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => shadowSubmenuOpen(page)).toBe(true);

    // Focus back on the row with the submenu still open — the state a popup rendered outside a menu
    // scope leaves behind, since nothing moved focus into it — then press the same key again.
    await page.evaluate(() =>
      document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("[data-slot~='menu-submenu-trigger']")?.focus(),
    );
    await page.keyboard.press("ArrowRight");

    expect(await shadowSubmenuOpen(page)).toBe(true);
    // Asserted, not assumed: it is the precondition that makes the case about a shadow boundary at all.
    // With the id visible to the document this would pass against the document-scoped lookup too.
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
