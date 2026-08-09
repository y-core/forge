import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { ANCHOR_X_PROPERTY, ANCHOR_Y_PROPERTY } from "../contracts/overlay-contract";
import { createIcon } from "../core/icon";
import { ShowcaseContent } from "./components";
import { showcasePaths } from "./route";

/**
 * The whole showcase page, driven.
 *
 * The epic's cut posture makes `ui/show` the living demo estate, and this is the one surface in
 * forge where a dozen primitives are composed together — so it is the honest place to assert the
 * property none of them can assert alone: **they coexist**. Every scope on this page resumes from
 * one `resume()` call, every controller mounts against markup it did not choose its neighbours for,
 * and driving one widget must not disturb another.
 *
 * Rendered by calling `ShowcaseContent` as a function with the same argument shape
 * `components.test.tsx` uses, so there is no bespoke fixture to drift from the real page.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = {
  expose: {
    forgeResume: "./ui/client/resume",
    forgeCoreClient: "./ui/core/client",
    forgeChromeClient: "./ui/chrome/client",
    forgeShowClient: "./ui/show/client",
  },
};

const icon = createIcon("/sprite.svg", {
  "icon-spinner": "0 0 24 24",
  "icon-chevron-down": "0 0 24 24",
  "icon-sun": "0 0 24 24",
  "icon-moon": "0 0 24 24",
  "icon-monitor": "0 0 24 24",
  "icon-hamburger": "0 0 24 24",
  "icon-close": "0 0 24 24",
});

async function mountShowcase(page: Page): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon }));
  await mount(page, html, EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
}

/** `data-slot` is a token list, so focus is asserted on the parsed tokens rather than the raw value. */
function focusedSlots(page: Page): Promise<string[]> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
}

test.describe("the showcase page as a whole", () => {
  test("resumes every scope it stamps without a single unregistered-scope warning", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
    });

    await mountShowcase(page);

    // A component whose markup names a scope has to guarantee the scope exists. This is the page
    // that would catch a primitive shipped with a `data-scope` nobody registers.
    expect(warnings.filter((text) => text.includes("[resume]"))).toEqual([]);
  });

  test("makes every toolbar on the page exactly one tab stop", async ({ page }) => {
    await mountShowcase(page);

    const stops = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-slot~='toolbar']")].map(
        (rail) => [...rail.querySelectorAll<HTMLElement>("[data-toolbar-item]")].filter((item) => item.tabIndex === 0).length,
      ),
    );

    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((count) => count === 1)).toBe(true);
  });
});

test.describe("primitives coexisting on one page", () => {
  test("driving the tabs leaves the toolbar's tab stop where it was", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex);
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlots(page)).toContain("tab");
    // Two composites are mounted on one page; a controller that queried the document rather than its
    // own root would move the other one's tab stop too.
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.tabIndex)).toBe(before);
  });

  test("the tabs select as focus moves, and only one panel is visible", async ({ page }) => {
    await mountShowcase(page);

    await page.evaluate(() => document.querySelector<HTMLElement>("[data-slot~='tab']")?.focus());
    await page.keyboard.press("ArrowRight");

    const state = await page.evaluate(() => ({
      selected: [...document.querySelectorAll("[data-slot~='tab']")].filter((el) => el.getAttribute("aria-selected") === "true").length,
      visible: [...document.querySelectorAll<HTMLElement>("[data-slot~='tabs-panel']")].filter((el) => !el.hidden).length,
    }));

    expect(state).toEqual({ selected: 1, visible: 1 });
  });

  test("opening the showcase menu focuses its first row and Escape gives the trigger back", async ({ page }) => {
    await mountShowcase(page);

    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedSlots(page)).toContain("menu-item");

    await page.keyboard.press("Escape");

    await expect.poll(() => focusedSlots(page)).toContain("menu-trigger");
  });

  test("a menu open on the page does not steal the toolbar's keys", async ({ page }) => {
    await mountShowcase(page);
    await page.click("[data-slot~='menu-trigger']");
    await expect.poll(() => focusedSlots(page)).toContain("menu-item");

    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector<HTMLElement>("[data-toolbar-item]")?.focus());
    await page.keyboard.press("ArrowRight");

    expect(await focusedSlots(page)).toContain("toolbar-button");
  });

  test("the native disclosures publish their open state through the shared protocol", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector("[data-slot~='collapsible']")?.hasAttribute("data-open"));
    await page.click("[data-slot~='collapsible-trigger']");

    // `<details>` owns open and closed; the transition controller only publishes them for CSS. This
    // is the assertion that the controller is actually mounted on the real page.
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-slot~='collapsible']")?.hasAttribute("data-open"))).toBe(!before);
  });

  test("the number field's steppers are live, which only an eager scope makes true", async ({ page }) => {
    await mountShowcase(page);

    const before = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot~='number-field-input']")?.value);
    await page.click("[data-slot~='number-field-increment']");

    // The steppers carry no `data-on-*` action, so a lazy scope would have nothing to resume it and
    // the buttons would sit inert on the page.
    const after = await page.evaluate(() => document.querySelector<HTMLInputElement>("[data-slot~='number-field-input']")?.value);
    expect(after).not.toBe(before);
  });
});

test.describe("the showcase's own filter island", () => {
  /** The labels of the filter items still shown, and the count the island renders beside them. */
  function shown(page: Page): Promise<{ labels: string[]; count: string | null | undefined }> {
    return page.evaluate(() => ({
      labels: [...document.querySelectorAll<HTMLElement>("[data-filter-item]")]
        .filter((el) => !el.hidden)
        .map((el) => (el.textContent ?? "").trim()),
      count: document.querySelector("[data-ref='count']")?.textContent,
    }));
  }

  test("typing in the filter hides the items that do not match and updates the count", async ({ page }) => {
    await mountShowcase(page);
    const all = await shown(page);
    expect(all.labels.length).toBeGreaterThan(1);

    await page.fill("#filter-input", all.labels[0] ?? "");

    const after = await shown(page);
    expect(after.labels.length).toBeLessThan(all.labels.length);
    expect(after.count).toBe(String(after.labels.length));
  });

  test("clearing the filter restores every item", async ({ page }) => {
    await mountShowcase(page);
    const all = await shown(page);

    await page.fill("#filter-input", "zzz-matches-nothing");
    expect((await shown(page)).labels).toEqual([]);
    await page.fill("#filter-input", "");

    // A scope like any other, mounted alongside a dozen controllers — its own state has to survive
    // being one island among many.
    expect(await shown(page)).toEqual(all);
  });
});

// ─── The context-menu island across a shadow boundary ────────────────────────

/** Which tree a case reads its markup out of — the light document, or the host's open shadow root. */
type Tree = "light" | "shadow";

const CONTEXT_SURFACE = "[data-scope='show-context-menu']";
const CONTEXT_POPUP_ID = "show-context-menu-popup";

/**
 * The showcase, with the context-menu demo left where it was rendered or relocated into an open
 * shadow root before anything resumes.
 *
 * The demo's scope resolves its popup from the id serialised into `data-state`, and a document-scoped
 * lookup answers `null` for an id living in a shadow tree — so `setup` returned before ever binding
 * `contextmenu`, and a right-click fell straight through to the browser's own menu. Relocating the
 * real page's own markup rather than hand-rolling a fixture keeps that failure attached to the demo
 * the epic actually ships.
 */
async function mountContextMenu(page: Page, tree: Tree): Promise<void> {
  const html = await render(ShowcaseContent({ data: { paths: showcasePaths("/showcase") }, icon }));
  await mount(page, html, EXPOSE);
  if (tree === "shadow") {
    await page.evaluate(
      ({ surfaceSelector, popupId }) => {
        const surface = document.querySelector(surfaceSelector);
        const popup = document.getElementById(popupId);
        if (!surface || !popup) throw new Error("the showcase no longer renders the context-menu demo");
        const host = document.createElement("div");
        host.id = "ctx-host";
        surface.before(host);
        // Moved rather than cloned: exactly one element carries each id, and the document is left
        // holding none of them — which is what makes the document-scoped lookup answer null.
        host.attachShadow({ mode: "open" }).append(surface, popup);
      },
      { surfaceSelector: CONTEXT_SURFACE, popupId: CONTEXT_POPUP_ID },
    );
  }
  await page.evaluate(() => window.forgeResume.resume());
}

/** Right-click the surface at a point the case can name, and report that point in viewport
 * coordinates — the same ones `clientX`/`clientY` hand the controller. */
async function rightClickSurface(page: Page): Promise<{ x: number; y: number }> {
  const surface = page.locator(CONTEXT_SURFACE);
  // Centred rather than merely scrolled into view, so the click point has the whole lower half of the
  // viewport beneath it and the placement clamp below stays the identity.
  await surface.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await surface.boundingBox();
  if (!box) throw new Error("the context-menu surface has no box");
  // The centre, not a fixed offset from the corner: the harness loads no stylesheet, so the surface
  // is whatever height its one line of text gives it and a corner offset lands on the next element.
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.click(x, y, { button: "right" });
  return { x, y };
}

/** Whether the popup is open, where it was placed, and the two measurements the placement assertion
 * needs in order to be exact rather than recomputed. */
function contextPopupState(page: Page, tree: Tree) {
  return page.evaluate(
    ({ where, popupId, xProp, yProp }) => {
      const root: ParentNode | null | undefined = where === "shadow" ? document.querySelector("#ctx-host")?.shadowRoot : document;
      if (!root) throw new Error("no tree to read: the shadow root was never attached");
      const popup = root.querySelector<HTMLElement>(`#${popupId}`);
      if (!popup) throw new Error("the context-menu popup is not in the tree the case mounted it into");
      const rect = popup.getBoundingClientRect();
      return {
        open: popup.matches(":popover-open"),
        x: popup.style.getPropertyValue(xProp),
        y: popup.style.getPropertyValue(yProp),
        size: { width: Math.round(rect.width), height: Math.round(rect.height) },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    },
    { where: tree, popupId: CONTEXT_POPUP_ID, xProp: ANCHOR_X_PROPERTY, yProp: ANCHOR_Y_PROPERTY },
  );
}

test.describe("the showcase's context-menu island across a shadow boundary", () => {
  test("a right-click inside an open shadow root opens the popup at the pointer", async ({ page }) => {
    await mountContextMenu(page, "shadow");

    // Asserted, not assumed: it is the precondition that makes this case about a shadow boundary at
    // all. With the popup id visible to the document, a document-scoped lookup would pass too.
    expect(await page.evaluate((popupId) => document.getElementById(popupId) === null, CONTEXT_POPUP_ID)).toBe(true);
    expect((await contextPopupState(page, "shadow")).open).toBe(false);

    const { x, y } = await rightClickSurface(page);

    const state = await contextPopupState(page, "shadow");
    // `openPopoverAt` clamps the panel onto the screen, so the coordinates are only the click point
    // when the panel fits below and to the right of it. Pinned rather than recomputed: reimplementing
    // the clamp here would make the assertion agree with the controller by construction.
    const fits = x + state.size.width <= state.viewport.width && y + state.size.height <= state.viewport.height;
    expect(fits, "the click point leaves no room for the panel, so the coordinates below are clamped").toBe(true);
    expect({ open: state.open, x: state.x, y: state.y }).toEqual({ open: true, x: `${x}px`, y: `${y}px` });
  });

  test("the identical markup in the light DOM opens the popup at the pointer", async ({ page }) => {
    // The parity half. Without it a regression that broke the ordinary document path could hide
    // behind a green shadow case, because the shadow lookup and the document lookup are one call.
    await mountContextMenu(page, "light");

    expect((await contextPopupState(page, "light")).open).toBe(false);

    const { x, y } = await rightClickSurface(page);

    const state = await contextPopupState(page, "light");
    const fits = x + state.size.width <= state.viewport.width && y + state.size.height <= state.viewport.height;
    expect(fits, "the click point leaves no room for the panel, so the coordinates below are clamped").toBe(true);
    expect({ open: state.open, x: state.x, y: state.y }).toEqual({ open: true, x: `${x}px`, y: `${y}px` });
  });
});
