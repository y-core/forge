import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { Tabs } from "./tabs";

/**
 * `Tabs` driven through the scope `ui/core/client` registers.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

interface Fixture {
  activation?: "manual";
  orientation?: "vertical";
  selected?: "a" | "b";
}

function tabsMarkup({ activation, orientation, selected = "a" }: Fixture = {}): Promise<string> {
  const isSelected = (key: string) => key === selected;
  return render(
    Tabs({
      ...(activation ? { activation } : {}),
      ...(orientation ? { orientation } : {}),
      children: [
        Tabs.List({
          ...(orientation ? { orientation } : {}),
          children: [
            Tabs.Tab({ id: "t-a", for: "p-a", selected: isSelected("a"), children: "Alpha" }),
            Tabs.Tab({ id: "t-b", for: "p-b", selected: isSelected("b"), children: "Beta" }),
            Tabs.Tab({ id: "t-c", for: "p-c", disabled: true, children: "Gamma" }),
            Tabs.Tab({ id: "t-d", for: "p-d", children: "Delta" }),
          ],
        }),
        Tabs.Panel({ id: "p-a", selected: isSelected("a"), children: "A" }),
        Tabs.Panel({ id: "p-b", selected: isSelected("b"), children: "B" }),
        Tabs.Panel({ id: "p-c", children: "C" }),
        Tabs.Panel({ id: "p-d", children: "D" }),
      ],
    }),
  );
}

/** Which panels are visible, and which tab claims selection — checked together so ARIA and the DOM
 * can never be asserted apart. */
function tabsState(page: Page) {
  return page.evaluate(() => ({
    selected: [...document.querySelectorAll("[role='tab']")].filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.id),
    dataSelected: [...document.querySelectorAll("[role='tab'][data-selected]")].map((el) => el.id),
    visiblePanels: [...document.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter((el) => !el.hidden).map((el) => el.id),
  }));
}

test.describe("Tabs", () => {
  test("renders one selected tab and one visible panel", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    expect(await tabsState(page)).toEqual({ selected: ["t-a"], dataSelected: ["t-a"], visiblePanels: ["p-a"] });
  });

  test("is one Tab stop", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await tabsMarkup()}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("t-a");
    await page.keyboard.press("Tab");
    // Next stop is the selected panel, not the second tab.
    expect(await focusedId(page)).toBe("p-a");
  });

  test("arrow keys move focus, skip a disabled tab, and selection follows", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    await page.focus("#t-a");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("t-b");
    expect(await tabsState(page)).toEqual({ selected: ["t-b"], dataSelected: ["t-b"], visiblePanels: ["p-b"] });

    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("t-d");
  });

  test("Home and End reach the first and last enabled tabs", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    await page.focus("#t-b");
    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("t-d");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("t-a");
  });

  test("manual activation moves focus without moving the selection until a click", async ({ page }) => {
    await mount(page, await tabsMarkup({ activation: "manual" }), EXPOSE);
    await start(page);

    await page.focus("#t-a");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("t-b");
    expect((await tabsState(page)).selected).toEqual(["t-a"]);

    await page.click("#t-b");
    expect((await tabsState(page)).selected).toEqual(["t-b"]);
  });

  test("a vertical tab list navigates with Up and Down", async ({ page }) => {
    await mount(page, await tabsMarkup({ orientation: "vertical" }), EXPOSE);
    await start(page);

    await page.focus("#t-a");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("t-a");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("t-b");
  });
});

/**
 * The roving tab stop has to boot onto the *selected* tab. With the selected tab first, a controller
 * that always starts at index 0 looks correct, which is how the marker went missing; every case here
 * therefore selects a tab that is not the first.
 */
test.describe("Tabs — the boot tab stop follows the selection", () => {
  test("only the selected tab carries the composite marker", async ({ page }) => {
    await mount(page, await tabsMarkup({ selected: "b" }), EXPOSE);
    await start(page);

    const marked = await page.evaluate((attr) => [...document.querySelectorAll(`[${attr}]`)].map((el) => el.id), ACTIVE_COMPOSITE_ITEM);
    expect(marked).toEqual(["t-b"]);
  });

  test("Tab reaches the selected tab, not the first one", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await tabsMarkup({ selected: "b" })}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("t-b");
  });

  test("the first arrow keypress moves relative to the selected tab", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await tabsMarkup({ selected: "b" })}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");

    // Relative to B, the next enabled tab is D (C is disabled). Booting at index 0 would land on B
    // here and reselect the tab the user was already on.
    expect(await focusedId(page)).toBe("t-d");
    expect(await tabsState(page)).toEqual({ selected: ["t-d"], dataSelected: ["t-d"], visiblePanels: ["p-d"] });
  });
});

// ─── Tabs across a shadow boundary ───────────────────────────────────────────

/** Which tree a case reads its markup out of — the light document, or the host's open shadow root. */
type Tree = "light" | "shadow";

/**
 * Tab strip **and** panel state, read out of whichever tree the case mounted into.
 *
 * The panel half is the whole point of this pair and is why the file's own `tabsState` is not reused.
 * A document-scoped `getElementById` cannot see a panel id that lives in a shadow tree, so `panelFor`
 * answered `null` and `select`'s `if (!panel) continue` fired — **after** the tab-side writes. The tab
 * strip therefore kept updating perfectly while every panel stayed frozen at its server-rendered
 * `hidden` and `data-selected`. Asserting only "the selected tab moved" passes against exactly the
 * defect these two cases exist to catch.
 */
function tabsStateIn(page: Page, tree: Tree) {
  return page.evaluate((where) => {
    const root: ParentNode | null | undefined = where === "shadow" ? document.querySelector("#host")?.shadowRoot : document;
    if (!root) throw new Error("no tree to read: the shadow root was never attached");
    const ids = (selector: string) => [...root.querySelectorAll(selector)].map((el) => el.id);
    return {
      selected: [...root.querySelectorAll("[role='tab']")].filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.id),
      dataSelected: ids("[role='tab'][data-selected]"),
      visiblePanels: [...root.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter((el) => !el.hidden).map((el) => el.id),
      selectedPanels: ids("[role='tabpanel'][data-selected]"),
    };
  }, tree);
}

test.describe("Tabs — panels follow the selection inside a shadow root", () => {
  /** Attach the template's contents to a shadow root, then resume — whose eager pass descends into
   * open roots at any depth, so a tabs scope inside one is discovered like any other. */
  async function attachAndResume(page: Page, hostSelector: string): Promise<void> {
    await page.evaluate((selector) => {
      const host = document.querySelector(selector);
      const template = document.querySelector<HTMLTemplateElement>("#source");
      if (!host || !template) return;
      host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
      window.forgeResume.resume();
    }, hostSelector);
  }

  test("a tab strip inside an open shadow root shows the panel its selection names", async ({ page }) => {
    const html = await tabsMarkup();
    await mount(page, `<div id="host"></div><template id="source">${html}</template>`, EXPOSE);
    await attachAndResume(page, "#host");

    // Asserted, not assumed: it is the precondition that makes this case about a shadow boundary at
    // all. With the panel ids visible to the document, a document-scoped lookup would pass too.
    expect(await page.evaluate(() => document.getElementById("p-b") === null)).toBe(true);
    expect(await tabsStateIn(page, "shadow")).toEqual({
      selected: ["t-a"],
      dataSelected: ["t-a"],
      visiblePanels: ["p-a"],
      selectedPanels: ["p-a"],
    });

    // Automatic activation, so reaching the tab is what selects it — the same path an arrow key takes.
    await page.focus("#t-b");

    expect(await tabsStateIn(page, "shadow")).toEqual({
      selected: ["t-b"],
      dataSelected: ["t-b"],
      visiblePanels: ["p-b"],
      selectedPanels: ["p-b"],
    });
  });

  test("the identical markup in the light DOM shows the panel its selection names", async ({ page }) => {
    // The parity half. Without it a regression that broke the ordinary document path could hide
    // behind a green shadow case, because the shadow lookup and the document lookup are one call.
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    expect(await tabsStateIn(page, "light")).toEqual({ selected: ["t-a"], dataSelected: ["t-a"], visiblePanels: ["p-a"], selectedPanels: ["p-a"] });

    await page.focus("#t-b");

    expect(await tabsStateIn(page, "light")).toEqual({ selected: ["t-b"], dataSelected: ["t-b"], visiblePanels: ["p-b"], selectedPanels: ["p-b"] });
  });
});
