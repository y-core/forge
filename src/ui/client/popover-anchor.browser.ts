import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { Menu } from "../core/menu";
import { mount } from "./browser-test-helper";

/**
 * `openPopoverAt` in a real browser, with the real stylesheet.
 *
 * The rule under test is as much CSS as it is TypeScript: without the coordinate rule's explicit
 * `inset: auto` the UA's `[popover]` default (`inset: 0; margin: auto`) survives and the panel
 * centres itself no matter what the custom properties say. So every case asserts a **measured**
 * `getBoundingClientRect`, not the properties that were written — the properties being right while
 * the box is centred is precisely the failure this exists to catch.
 */

declare global {
  interface Window {
    forgePopoverAnchor: typeof import("./popover-anchor");
  }
}

const EXPOSE = { expose: { forgePopoverAnchor: "./ui/client/popover-anchor" } };

/** The coordinate rule, verbatim from `assets/css/theme-base.css`. Inlined rather than loading the
 * built sheet: the harness serves no CSS, and what is under test is this rule and the UA default
 * fighting over the same box. */
const COORD_RULE = `
  [popover] { border: 0; padding: 0; }
  [popover][data-coords] {
    position: fixed;
    margin: 0;
    inset: auto;
    left: var(--anchor-x, 0px);
    top: var(--anchor-y, 0px);
    position-try-fallbacks: none;
  }
`;

/** A 120×80 context menu — a known box, so a clamp is arithmetic rather than a guess. */
async function markup(coords = true): Promise<string> {
  const menu = await render(
    Menu.Popup({
      id: "ctx",
      ...(coords ? { coords: true } : {}),
      class: "w-[120px] h-[80px]",
      children: Menu.Item({ id: "row", for: "ctx", children: "Row" }),
    }),
  );
  return `<style>${COORD_RULE}</style><div id="pad" style="width:120px;height:80px"></div>${menu}`;
}

/** Force the exact box the arithmetic below assumes, whatever the component's own classes say. */
async function sizeIt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#ctx");
    el?.style.setProperty("width", "120px");
    el?.style.setProperty("height", "80px");
  });
}

async function openAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, x, y);
    },
    { x, y },
  );
}

function box(page: Page) {
  return page.evaluate(() => {
    const rect = document.querySelector("#ctx")?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
  });
}

const viewport = (page: Page) => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

test.describe("openPopoverAt", () => {
  test("opens the popup and puts its top-left corner on the given point", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.matches(":popover-open"))).toBe(true);
    expect(await box(page)).toMatchObject({ left: 200, top: 150 });
  });

  test("writes the coordinates as custom properties, never as an inline style attribute", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);

    // forge's CSP has no `style-src 'unsafe-inline'`, so a generated `style="left:…"` would be
    // blocked in exactly the app this exists for. CSSOM properties are not what CSP gates.
    expect(
      await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("#ctx");
        return { x: el?.style.getPropertyValue("--anchor-x"), y: el?.style.getPropertyValue("--anchor-y") };
      }),
    ).toEqual({ x: "200px", y: "150px" });
  });

  test("clamps against the right edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { w } = await viewport(page);

    await openAt(page, w + 500, 150);

    expect(await box(page)).toMatchObject({ left: w - 120, right: w, top: 150 });
  });

  test("clamps against the bottom edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { h } = await viewport(page);

    await openAt(page, 200, h + 500);

    expect(await box(page)).toMatchObject({ top: h - 80, bottom: h, left: 200 });
  });

  test("clamps against the left edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, -400, 150);

    expect(await box(page)).toMatchObject({ left: 0, top: 150 });
  });

  test("clamps against the top edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, -400);

    expect(await box(page)).toMatchObject({ left: 200, top: 0 });
  });

  test("honours a margin on every edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { w, h } = await viewport(page);

    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, 1e6, 1e6, { margin: 12 });
    });

    expect(await box(page)).toMatchObject({ right: w - 12, bottom: h - 12 });
  });

  test("a second call at a new point moves an already-open popup", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);
    await openAt(page, 40, 60);

    // Right-clicking somewhere else does not close and reopen the menu; it relocates it.
    expect(await page.evaluate(() => document.querySelector("#ctx")?.matches(":popover-open"))).toBe(true);
    expect(await box(page)).toMatchObject({ left: 40, top: 60 });
  });

  test("stamps the opt-in attribute itself, so calling it is what makes a popup coordinate-placed", async ({ page }) => {
    await mount(page, await markup(false), EXPOSE);
    await sizeIt(page);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.hasAttribute("data-coords"))).toBe(false);
    await openAt(page, 200, 150);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.hasAttribute("data-coords"))).toBe(true);
    expect(await box(page)).toMatchObject({ left: 200, top: 150 });
  });

  test("a popup larger than the viewport pins to the near edge rather than hanging off the far one", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      el?.style.setProperty("width", "5000px");
      el?.style.setProperty("height", "5000px");
    });

    await openAt(page, 300, 300);

    // `Math.max(margin, …)` is what makes this 0 rather than a negative left.
    expect(await box(page)).toMatchObject({ left: 0, top: 0 });
  });
});

/**
 * `flip` — open *away* from the point instead of sliding back over it.
 *
 * Both behaviours keep the panel on screen; they differ in where the **point** ends up. Clamping
 * leaves it inside the box, which for a context menu pre-hovers the row under the cursor. Flipping
 * mirrors the box past the point, which is what every desktop context menu does.
 */
test.describe("openPopoverAt with flip", () => {
  async function openFlipped(page: Page, x: number, y: number): Promise<void> {
    await page.evaluate(
      ({ x, y }) => {
        const el = document.querySelector<HTMLElement>("#ctx");
        if (el) window.forgePopoverAnchor.openPopoverAt(el, x, y, { flip: true });
      },
      { x, y },
    );
  }

  test("leaves the point at the corner when the popup fits", async ({ page }) => {
    // The flip is conditional on *not* fitting; where there is room, it must change nothing.
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openFlipped(page, 200, 150);

    expect(await box(page)).toMatchObject({ left: 200, top: 150 });
  });

  test("mirrors past the point on the axis that would overflow, and only that axis", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { h } = await viewport(page);

    // Comfortably inside on x, hard against the bottom on y.
    await openFlipped(page, 200, h - 10);

    const rect = await box(page);
    expect(rect?.left, "the x axis flipped although it had room").toBe(200);
    expect(rect?.bottom, "the y axis did not open upward from the point").toBe(h - 10);
  });

  test("flips both axes in a corner", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { w, h } = await viewport(page);

    await openFlipped(page, w - 10, h - 10);

    expect(await box(page)).toMatchObject({ right: w - 10, bottom: h - 10 });
  });

  test("falls back to clamping when the mirrored box would not fit either", async ({ page }) => {
    // The guarantee that the whole panel stays on screen is **unconditional**: a popup taller than the
    // space on either side of the point cannot be fixed by mirroring, and silently leaving it
    // off-screen would be worse than ignoring the preference.
    await mount(page, await markup(), EXPOSE);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      el?.style.setProperty("width", "120px");
      el?.style.setProperty("height", "600px");
    });
    const { h } = await viewport(page);

    // 40px from the top: flipping upward would need 600px above the point, which does not exist.
    await openFlipped(page, 200, 40);

    const rect = await box(page);
    expect(rect?.top, "the flip produced a negative top instead of clamping").toBeGreaterThanOrEqual(0);
    expect(rect?.bottom, "the panel hangs off the bottom edge").toBeLessThanOrEqual(h);
  });
});
