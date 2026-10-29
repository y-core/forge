import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createElement } from "../../render/jsx/element";
import { render } from "../../testing/render";
import { compiledCss, mount, paintedHex, renderedClasses, withCompiledCss } from "../client/browser.fixture";
import { ACTIVE_COMPOSITE_ITEM } from "../contracts/composite-contract";
import { contrastRatio } from "../contracts/theme/color";
import { CRITERION } from "../contracts/theme/contrast-pairs";
import type { Orientation } from "../contracts/types";
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

function axisMarkup(root: Orientation | undefined, list: Orientation | undefined): Promise<string> {
  return render(
    createElement(Tabs, {
      ...(root ? { orientation: root } : {}),
      children: [
        createElement(Tabs.List, {
          label: "Views",
          ...(list ? { orientation: list } : {}),
          children: [
            createElement(Tabs.Tab, { for: "p-a", selected: true, children: "Alpha" }),
            createElement(Tabs.Tab, { for: "p-b", children: "Beta" }),
          ],
        }),
        createElement(Tabs.Content, { id: "p-a", selected: true, children: "A" }),
        createElement(Tabs.Content, { id: "p-b", children: "B" }),
      ],
    }),
  );
}

function wrappedPanelMarkup(): Promise<string> {
  return render(
    Tabs({
      children: [
        Tabs.List({
          label: "Views",
          children: [Tabs.Tab({ for: "p-a", selected: true, children: "Alpha" }), Tabs.Tab({ for: "p-b", children: "Beta" })],
        }),
        Tabs.Content({ id: "p-a", selected: true, children: "A" }),
        createElement("div", { children: Tabs.Content({ id: "p-b", children: "B" }) }),
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

test.describe("Tabs", { tag: "@cross-engine" }, () => {
  test("renders one selected tab and one visible panel", async ({ page }) => {
    await mount(page, await tabsMarkup(), EXPOSE);
    await start(page);

    expect(await tabsState(page)).toEqual({ selected: ["p-a-tab"], dataSelected: ["p-a-tab"], visiblePanels: ["p-a"] });
  });

  test("keeps a server-hidden panel out of the layout once mounted, before any selection", async ({ page }) => {
    await mount(page, await withCompiledCss(await tabsMarkup()), EXPOSE);
    await start(page);

    expect(await page.locator("#p-b").evaluate((el) => getComputedStyle(el).display)).toBe("none");
  });

  test("hides a panel revealed before mount, and leaves no until-found for the platform to reveal again", async ({ page }) => {
    await mount(page, await withCompiledCss(await tabsMarkup()), EXPOSE);
    await page.evaluate(() => document.querySelector("#p-b")?.removeAttribute("hidden"));
    await start(page);

    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[role='tabpanel']")].map((el) => [
          el.id,
          getComputedStyle(el).display,
          el.getAttribute("hidden"),
        ]),
      ),
    ).toEqual([
      ["p-a", "block", null],
      ["p-b", "none", ""],
      ["p-c", "none", ""],
      ["p-d", "none", ""],
    ]);
  });

  test("a panel wrapped in the caller's own element is selected in place of the selected one once mounted", async ({ page }) => {
    await mount(page, await withCompiledCss(await wrappedPanelMarkup()), EXPOSE);
    await start(page);

    await page.click("#p-b-tab");

    expect(await tabsState(page)).toEqual({ selected: ["p-b-tab"], dataSelected: ["p-b-tab"], visiblePanels: ["p-b"] });
    await expect(page.locator("#p-b")).toBeVisible();
    await expect(page.locator("#p-a")).toBeHidden();
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

  test("a vertical list under a default root takes its axis from the list", async ({ page }) => {
    await mount(page, await axisMarkup(undefined, "vertical"), EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    await page.keyboard.press("ArrowDown");
    expect((await tabsState(page)).selected).toEqual(["p-b-tab"]);
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

test.describe("Tabs — a nested set is left alone", () => {
  async function nestedMarkup(): Promise<string> {
    const inner = Tabs({
      children: [
        Tabs.List({ label: "Inner", children: [Tabs.Tab({ for: "p-x", selected: true, children: "X" }), Tabs.Tab({ for: "p-y", children: "Y" })] }),
        Tabs.Content({ id: "p-x", selected: true, children: "X" }),
        Tabs.Content({ id: "p-y", children: "Y" }),
      ],
    });
    return render(
      Tabs({
        children: [
          Tabs.List({
            label: "Outer",
            children: [Tabs.Tab({ for: "p-a", selected: true, children: "Alpha" }), Tabs.Tab({ for: "p-b", children: "Beta" })],
          }),
          Tabs.Content({ id: "p-a", selected: true, children: inner }),
          Tabs.Content({ id: "p-b", children: "B" }),
        ],
      }),
    );
  }

  test("arrowing onto an outer tab leaves the inner selection and panels intact", async ({ page }) => {
    await mount(page, await nestedMarkup(), EXPOSE);
    await start(page);

    await page.focus("#p-a-tab");
    await page.keyboard.press("ArrowRight");

    expect(await tabsState(page)).toEqual({
      selected: ["p-b-tab", "p-x-tab"],
      dataSelected: ["p-b-tab", "p-x-tab"],
      visiblePanels: ["p-x", "p-b"],
    });
  });
});

test.describe("Tabs — the selected tab's cue is not colour alone", { tag: "@cross-engine" }, () => {
  for (const [dark, vertical] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    test(`the selected ${vertical ? "vertical" : "horizontal"} tab draws a bar the unselected one leaves transparent, clearing 1.4.11 against its fill and the page in ${dark ? "dark" : "light"}`, async ({
      page,
    }) => {
      const html = vertical ? await axisMarkup("vertical", undefined) : await tabsMarkup();
      await mount(
        page,
        `<style>${await compiledCss([...renderedClasses(html), "bg-background"])}</style><main class="bg-background">${html}</main>`,
      );
      if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

      const read = await page.evaluate(
        (side) => {
          const style = (selector: string) => getComputedStyle(document.querySelector(selector) as Element);
          const alpha = (color: string) => {
            const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return context.getImageData(0, 0, 1, 1).data[3];
          };
          const selected = style("#p-a-tab");
          const unselected = style("#p-b-tab");
          return {
            selected: {
              width: selected[`${side}Width`],
              alpha: alpha(selected[`${side}Color`]),
              color: selected[`${side}Color`],
              fill: selected.backgroundColor,
            },
            unselected: { width: unselected[`${side}Width`], color: unselected[`${side}Color`] },
            surface: style("main").backgroundColor,
          };
        },
        vertical ? ("borderInlineEnd" as const) : ("borderBottom" as const),
      );
      expect({ selected: { width: read.selected.width, alpha: read.selected.alpha }, unselected: read.unselected }).toEqual({
        selected: { width: "2px", alpha: 255 },
        unselected: { width: "2px", color: "rgba(0, 0, 0, 0)" },
      });

      const bar = await paintedHex(page, read.selected.color);
      const failing: string[] = [];
      for (const [against, value] of [
        ["fill", read.selected.fill],
        ["surface", read.surface],
      ] as const) {
        const behind = await paintedHex(page, value);
        const ratio = Number(contrastRatio(bar, behind).toFixed(2));
        if (ratio < CRITERION["1.4.11"].floor) failing.push(`bar ${bar} on ${against} ${behind} = ${ratio}`);
      }
      expect(failing).toEqual([]);
    });
  }
});
