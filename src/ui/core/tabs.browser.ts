import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { Tabs } from "./tabs";

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
          label: "Views",
          ...(orientation ? { orientation } : {}),
          children: [
            Tabs.Tab({ for: "p-a", selected: isSelected("a"), children: "Alpha" }),
            Tabs.Tab({ for: "p-b", selected: isSelected("b"), children: "Beta" }),
            Tabs.Tab({ for: "p-c", disabled: true, children: "Gamma" }),
            Tabs.Tab({ for: "p-d", children: "Delta" }),
          ],
        }),
        Tabs.Content({ id: "p-a", selected: isSelected("a"), children: "A" }),
        Tabs.Content({ id: "p-b", selected: isSelected("b"), children: "B" }),
        Tabs.Content({ id: "p-c", children: "C" }),
        Tabs.Content({ id: "p-d", children: "D" }),
      ],
    }),
  );
}

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

    expect(await tabsState(page)).toEqual({ selected: ["p-a-tab"], dataSelected: ["p-a-tab"], visiblePanels: ["p-a"] });
  });

  test("is one Tab stop", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await tabsMarkup()}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("p-a-tab");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("p-a");
  });

  // A disabled tab is an `<a>` carrying `aria-disabled` — an anchor has no native `disabled` — so it
  // stays in the ring, focusable but inert, which is the WAI-ARIA split `ui/README.md` promises.
  test("arrow keys move focus, reach a disabled tab without selecting it, and selection otherwise follows", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("p-b-tab");
    expect(await tabsState(page)).toEqual({ selected: ["p-b-tab"], dataSelected: ["p-b-tab"], visiblePanels: ["p-b"] });

    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("p-c-tab");
    expect(await tabsState(page)).toEqual({ selected: ["p-b-tab"], dataSelected: ["p-b-tab"], visiblePanels: ["p-b"] });

    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("p-d-tab");
    expect(await tabsState(page)).toEqual({ selected: ["p-d-tab"], dataSelected: ["p-d-tab"], visiblePanels: ["p-d"] });
  });

  test("Home and End reach the first and last enabled tabs", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    await page.focus("#p-b-tab");
    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("p-d-tab");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("p-a-tab");
  });

  test("manual activation moves focus without moving the selection until a click", async ({ page }) => {
    await mount(page, await tabsMarkup({ activation: "manual" }), EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("p-b-tab");
    expect((await tabsState(page)).selected).toEqual(["p-a-tab"]);

    await page.click("#p-b-tab");
    expect((await tabsState(page)).selected).toEqual(["p-b-tab"]);
  });

  // A tab is an `<a href>`: the platform synthesises a click for Enter but not for Space, which would
  // otherwise scroll the page and leave the selection where it was.
  for (const key of ["Enter", " "] as const) {
    test(`manual activation selects the focused tab on ${key === " " ? "Space" : key}, without scrolling`, async ({ page }) => {
      await mount(page, `${await tabsMarkup({ activation: "manual" })}<div style="height:200vh"></div>`, EXPOSE);
      await start(page);

      await page.focus("#p-a-tab");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press(key);

      expect((await tabsState(page)).selected).toEqual(["p-b-tab"]);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }

  test("Tab back into the list lands on the selected tab, not on the one last arrowed to", async ({ page }) => {
    await mount(page, `<button id="before">before</button>${await tabsMarkup({ activation: "manual" })}`, EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("p-b-tab");
    await page.focus("#before");
    await page.keyboard.press("Tab");

    expect(await focusedId(page)).toBe("p-a-tab");
  });

  // Nothing requires a `Tabs` to render a selection, and under manual activation arrowing alone never
  // makes one — so the hand-back has to fall back to a tab rather than leaving the list with none.
  test("keeps a tab stop when the list leaves focus with nothing selected", async ({ page }) => {
    const html = await render(
      Tabs({
        activation: "manual",
        children: [
          Tabs.List({ label: "Views", children: [Tabs.Tab({ for: "p-a", children: "Alpha" }), Tabs.Tab({ for: "p-b", children: "Beta" })] }),
          Tabs.Content({ id: "p-a", children: "A" }),
          Tabs.Content({ id: "p-b", children: "B" }),
        ],
      }),
    );
    await mount(page, `<button id="before">before</button>${html}`, EXPOSE);
    await start(page);

    await page.focus("#p-b-tab");
    await page.focus("#before");

    const stops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[role='tab']")].map((el) => el.tabIndex));
    expect(stops).toEqual([0, -1]);
  });

  // Pinned at the tab set rather than only at the composite: a `Tabs` that mounted the ring with the
  // wrong orientation would swallow the page's own scroll keys and still pass every arrow test above.
  test("a horizontal list leaves Up and Down to the page", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    const claimed = await page.evaluate(async () => {
      const seen: boolean[] = [];
      const record = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
      document.addEventListener("keydown", record);
      for (const key of ["ArrowUp", "ArrowDown"]) {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      }
      document.removeEventListener("keydown", record);
      return seen;
    });

    expect(claimed).toEqual([false, false]);
    expect(await focusedId(page)).toBe("p-a-tab");
  });

  test("a vertical tab list navigates with Up and Down", async ({ page }) => {
    await mount(page, await tabsMarkup({ orientation: "vertical" }), EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("p-a-tab");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("p-b-tab");
  });
});

test.describe("Tabs — the boot tab stop follows the selection", () => {
  test("only the selected tab carries the composite marker", async ({ page }) => {
    await mount(page, await tabsMarkup({ selected: "b" }), EXPOSE);
    await start(page);

    const marked = await page.evaluate((attr) => [...document.querySelectorAll(`[${attr}]`)].map((el) => el.id), ACTIVE_COMPOSITE_ITEM);
    expect(marked).toEqual(["p-b-tab"]);
  });

  test("Tab reaches the selected tab, not the first one", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await tabsMarkup({ selected: "b" })}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("p-b-tab");
  });

  test("the first arrow keypress moves relative to the selected tab", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await tabsMarkup({ selected: "b" })}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");

    // One step from the selected tab lands on the disabled one, which holds focus and not selection.
    expect(await focusedId(page)).toBe("p-c-tab");
    expect(await tabsState(page)).toEqual({ selected: ["p-b-tab"], dataSelected: ["p-b-tab"], visiblePanels: ["p-b"] });
  });
});

type Tree = "light" | "shadow";

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

    expect(await page.evaluate(() => document.getElementById("p-b") === null)).toBe(true);
    expect(await tabsStateIn(page, "shadow")).toEqual({
      selected: ["p-a-tab"],
      dataSelected: ["p-a-tab"],
      visiblePanels: ["p-a"],
      selectedPanels: ["p-a"],
    });

    await page.focus("#p-b-tab");

    expect(await tabsStateIn(page, "shadow")).toEqual({
      selected: ["p-b-tab"],
      dataSelected: ["p-b-tab"],
      visiblePanels: ["p-b"],
      selectedPanels: ["p-b"],
    });
  });

  test("the identical markup in the light DOM shows the panel its selection names", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    expect(await tabsStateIn(page, "light")).toEqual({
      selected: ["p-a-tab"],
      dataSelected: ["p-a-tab"],
      visiblePanels: ["p-a"],
      selectedPanels: ["p-a"],
    });

    await page.focus("#p-b-tab");

    expect(await tabsStateIn(page, "light")).toEqual({
      selected: ["p-b-tab"],
      dataSelected: ["p-b-tab"],
      visiblePanels: ["p-b"],
      selectedPanels: ["p-b"],
    });
  });
});
