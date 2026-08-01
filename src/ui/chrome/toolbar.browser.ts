import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "../core/icon";
import { Toolbar, type ToolbarDefinition, type ToolbarPlacement } from "./toolbar";

/**
 * The chrome icon rail as a consumer gets it.
 *
 * The rail adopts `core/Toolbar`'s contracts rather than its parts — `role="toolbar"`, the toolbar
 * scope, the item marker — because its flyout is anchored by CSS that the generic `Popover` cannot
 * express. These cases prove the contracts do their job on the markup that was kept.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    activations: string[];
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeChromeClient: "./ui/chrome/client" } };

const icon = createIcon("/sprite.svg");

const action = (name: string, label: string) => ({ kind: "action" as const, icon: "dot", label, action: name, ref: name });

const CONFIG: ToolbarDefinition = {
  groups: [
    { items: [action("select", "Select"), action("line", "Line"), action("arc", "Arc")] },
    {
      items: [
        {
          kind: "popover" as const,
          icon: "layers",
          label: "Layers",
          ref: "layers",
          content: jsx("button", { id: "in-flyout", "data-on-click": "flyoutAction", children: "Inside" }),
          titleAction: { icon: "plus", label: "Add", action: "addLayer", ref: "add" },
        },
      ],
    },
  ],
};

async function mountRail(page: Page, placement: ToolbarPlacement = "left", config: ToolbarDefinition = CONFIG): Promise<void> {
  const html = await render(Toolbar({ config, icon, placement }));
  await mount(page, `<div data-scope="app"><button id="before">before</button>${html}</div>`, EXPOSE);
  await page.evaluate(() => {
    window.activations = [];
    window.forgeResume.registerScope("app", {
      on: {
        select: () => window.activations.push("select"),
        line: () => window.activations.push("line"),
        arc: () => window.activations.push("arc"),
        addLayer: () => window.activations.push("addLayer"),
        flyoutAction: () => window.activations.push("flyoutAction"),
      },
    });
    window.forgeResume.resume();
  });
}

function focusedRef(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-ref") ?? null);
}

function tabIndexes(page: Page): Promise<number[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-toolbar-item]")].map((el) => el.tabIndex));
}

test.describe("chrome Toolbar — anatomy", () => {
  test("announces itself as a toolbar with the orientation its placement implies", async ({ page }) => {
    await mountRail(page, "left");

    const rail = await page.evaluate(() => {
      const el = document.querySelector("[data-slot='toolbar']");
      return {
        role: el?.getAttribute("role"),
        scope: el?.getAttribute("data-scope"),
        data: el?.getAttribute("data-orientation"),
        aria: el?.getAttribute("aria-orientation"),
      };
    });

    // The client reads `data-orientation` to choose which arrows navigate, so a left rail saying
    // `horizontal` would leave Up/Down dead on a vertical rail.
    expect(rail).toEqual({ role: "toolbar", scope: "toolbar", data: "vertical", aria: "vertical" });
  });

  test("a top rail is horizontal", async ({ page }) => {
    await mountRail(page, "top");

    expect(await page.evaluate(() => document.querySelector("[data-slot='toolbar']")?.getAttribute("data-orientation"))).toBe("horizontal");
  });

  test("separators announce the axis across the rail", async ({ page }) => {
    await mountRail(page, "left");

    const sep = await page.evaluate(() => {
      const el = document.querySelector("[data-slot='toolbar-separator']");
      return { tag: el?.tagName, orientation: el?.getAttribute("aria-orientation") };
    });

    // An `<hr>` carries the separator role implicitly. A left rail is divided by horizontal rules,
    // so the separator's own axis is horizontal.
    expect(sep).toEqual({ tag: "HR", orientation: "horizontal" });
  });
});

test.describe("chrome Toolbar — one tab stop", () => {
  test("every rail stop is a focus stop and only one is tabbable", async ({ page }) => {
    await mountRail(page);

    // Three actions plus the popover trigger; the flyout's title action is deliberately not one.
    expect(await tabIndexes(page)).toEqual([0, -1, -1, -1]);
  });

  test("Tab enters the rail once and Tab again leaves it", async ({ page }) => {
    await mountRail(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedRef(page)).toBe("select");
    await page.keyboard.press("Tab");
    expect(await focusedRef(page)).toBeNull();
  });

  test("the arrows a vertical rail claims move between its items", async ({ page }) => {
    await mountRail(page, "left");

    await page.focus("[data-ref='select']");
    await page.keyboard.press("ArrowDown");
    expect(await focusedRef(page)).toBe("line");
    await page.keyboard.press("ArrowDown");
    expect(await focusedRef(page)).toBe("arc");
    await page.keyboard.press("ArrowDown");
    // The popover trigger is a rail stop too — an unmarked trigger would be a keyboard hole.
    expect(await focusedRef(page)).toBe("layers");
  });

  test("a horizontal rail answers Left and Right instead", async ({ page }) => {
    await mountRail(page, "top");

    await page.focus("[data-ref='select']");
    await page.keyboard.press("ArrowRight");
    expect(await focusedRef(page)).toBe("line");
  });

  test("the flyout's title action is NOT a rail stop", async ({ page }) => {
    await mountRail(page);

    const marked = await page.evaluate(() => document.querySelector("[data-slot='toolbar-title-action']")?.hasAttribute("data-toolbar-item"));

    // Roving focus queries the whole `<nav>` subtree and the flyout is inside it, so a marker here
    // would splice flyout buttons into the rail's ring.
    expect(marked).toBe(false);
  });
});

test.describe("chrome Toolbar — the scope on the rail is transparent to app actions", () => {
  test("a rail action still reaches the enclosing app scope", async ({ page }) => {
    await mountRail(page);

    await page.click("[data-ref='line']");

    // The rail now carries `data-scope="toolbar"`, so every action fired inside it passes through a
    // scope that does not own it. `runAction` continues to the enclosing scope, and this is the
    // change most likely to silently break a consumer's tool buttons.
    expect(await page.evaluate(() => window.activations)).toEqual(["line"]);
  });

  test("an action fired from inside an open flyout reaches it too", async ({ page }) => {
    await mountRail(page);

    await page.click("[data-ref='layers']");
    await page.click("#in-flyout");

    // Two scopes deep now: the flyout sits inside the rail, which sits inside the app scope.
    expect(await page.evaluate(() => window.activations)).toEqual(["flyoutAction"]);
  });

  test("the flyout's title action reaches the app scope", async ({ page }) => {
    await mountRail(page);

    await page.click("[data-ref='layers']");
    await page.click("[data-ref='add']");

    expect(await page.evaluate(() => window.activations)).toEqual(["addLayer"]);
  });
});
