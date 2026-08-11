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
      const el = document.querySelector("[data-slot~='toolbar']");
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

    expect(await page.evaluate(() => document.querySelector("[data-slot~='toolbar']")?.getAttribute("data-orientation"))).toBe("horizontal");
  });

  test("separators announce the axis across the rail", async ({ page }) => {
    await mountRail(page, "left");

    const sep = await page.evaluate(() => {
      const el = document.querySelector("[data-slot~='toolbar-separator']");
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

    const marked = await page.evaluate(() => document.querySelector("[data-slot~='toolbar-title-action']")?.hasAttribute("data-toolbar-item"));

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

/**
 * **Flyout placement, measured** — the rail's first geometry coverage.
 *
 * `data-placement` names the **rail's** edge rather than the flyout's, so the anchor rules invert:
 * a rail on the `left` opens its flyout to the right of itself. Read as a bare pair of names that
 * looks like a transcription error, which is exactly why it is pinned here.
 *
 * The stylesheet loads raw, so no Tailwind utility resolves and the fixture sizes the rail and the
 * flyout with an explicit `<style>`.
 *
 * `forge-ui.css` is the only sheet needed: the toolbar's `anchor-name` / `position-anchor`
 * pair and its four `data-placement` rules are all there, and every assertion below is a box.
 */
const PLACEMENT_CSS = { css: ["./ui/assets/css/forge-ui.css"], expose: EXPOSE.expose };

/** The rail sits well inside the viewport on every axis, so a flyout fits on **either** side of it.
 * Too close to an edge and `position-try-fallbacks: flip-inline` correctly moves the panel to the
 * other side — which is the rail's desired behaviour and would read here as the placement being
 * inverted. */
const PLACEMENT_STYLE = `<style>
  body { margin: 0; }
  [data-slot~="toolbar"] { position: fixed; top: 200px; left: 400px; width: 48px; }
  [data-slot~="toolbar-trigger"] { display: block; width: 40px; height: 40px; }
  [data-slot~="toolbar-flyout"] { width: 180px; height: 90px; }
</style>`;

const RAIL_GAP = 8; // 0.5rem

test.describe("Toolbar — flyout placement", () => {
  async function openFlyout(page: Page, placement: ToolbarPlacement) {
    const html = await render(Toolbar({ config: CONFIG, icon, placement }));
    await mount(page, `${PLACEMENT_STYLE}<div data-scope="app">${html}</div>`, PLACEMENT_CSS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click("[data-ref='layers']");
    return page.evaluate(() => {
      const round = (selector: string) => {
        const r = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      };
      return { trigger: round("[data-ref='layers']"), flyout: round("[data-slot~='toolbar-flyout']") };
    });
  }

  function close(actual: number, expected: number): void {
    expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(2);
  }

  test("a left rail opens its flyout to the right of the trigger", async ({ page }) => {
    const { trigger, flyout } = await openFlyout(page, "left");
    close(flyout.left, trigger.right + RAIL_GAP);
    close(flyout.top, trigger.top);
  });

  test("a right rail opens its flyout to the left of the trigger", async ({ page }) => {
    const { trigger, flyout } = await openFlyout(page, "right");
    close(flyout.right, trigger.left - RAIL_GAP);
    close(flyout.top, trigger.top);
  });

  test("a top rail opens its flyout below the trigger", async ({ page }) => {
    const { trigger, flyout } = await openFlyout(page, "top");
    close(flyout.top, trigger.bottom + RAIL_GAP);
    close(flyout.left, trigger.left);
  });

  test("a bottom rail opens its flyout above the trigger", async ({ page }) => {
    const { trigger, flyout } = await openFlyout(page, "bottom");
    close(flyout.bottom, trigger.top - RAIL_GAP);
    close(flyout.left, trigger.left);
  });

  test("the flyout is anchored to its own trigger, not to a rail elsewhere on the page", async ({ page }) => {
    // `anchor-scope` on `[data-slot~="toolbar-popover"]` is what makes this hold: every rail on a page
    // shares the name `--forge-toolbar`, and an open flyout is in the top layer, where the resolution
    // algorithm would otherwise return the last matching trigger in the document.
    const html = await render(Toolbar({ config: CONFIG, icon, placement: "left", id: "one" }));
    const other = await render(Toolbar({ config: CONFIG, icon, placement: "left", id: "two" }));
    // The id selector outranks `[data-slot~="toolbar"]`, so the second rail really does land somewhere
    // else — two rails stacked at one position would let this pass without proving anything.
    await mount(
      page,
      `${PLACEMENT_STYLE}<style>#two { top: 500px; left: 800px; }</style><div data-scope="app">${html}${other}</div>`,
      PLACEMENT_CSS,
    );
    await page.evaluate(() => window.forgeResume.resume());

    const first = await page.evaluate(() => {
      (document.querySelectorAll("[data-ref='layers']")[0] as HTMLElement).click();
      const round = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
      };
      return {
        trigger: round(document.querySelectorAll("[data-ref='layers']")[0] as Element),
        flyout: round(document.querySelectorAll("[data-slot~='toolbar-flyout']")[0] as Element),
      };
    });

    close(first.flyout.left, first.trigger.right + RAIL_GAP);
    close(first.flyout.top, first.trigger.top);
  });
});
