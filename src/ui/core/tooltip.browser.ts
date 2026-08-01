import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Tooltip } from "./tooltip";

/**
 * `Tooltip` — the accessibility contract most implementations get wrong, pinned here.
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

test.describe("Tooltip", () => {
  const markup = () =>
    render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
          Tooltip.Content({ id: "save-tip", children: "Writes the file to disk" }),
        ],
      }),
    );

  function isShown(page: Page): Promise<boolean> {
    return page.evaluate(() => document.querySelector("#save-tip")?.matches(":popover-open") ?? false);
  }

  test("describes its trigger rather than labelling it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);

    const wiring = await page.evaluate(() => {
      const trigger = document.querySelector("#save");
      const tip = document.querySelector("#save-tip");
      return {
        describedby: trigger?.getAttribute("aria-describedby"),
        labelledby: trigger?.getAttribute("aria-labelledby"),
        role: tip?.getAttribute("role"),
      };
    });

    expect(wiring).toEqual({ describedby: "save-tip", labelledby: null, role: "tooltip" });
  });

  test("is never focusable", async ({ page }) => {
    await mount(page, `${await markup()}<button id="after">after</button>`, EXPOSE);
    await start(page);

    const hasTabindex = await page.evaluate(() => document.querySelector("#save-tip")?.hasAttribute("tabindex"));
    expect(hasTabindex).toBe(false);

    await page.focus("#save");
    await page.keyboard.press("Tab");
    // Tab skips straight past the tooltip: a focusable tooltip is a keyboard trap.
    expect(await focusedId(page)).toBe("after");
  });

  test("opens on keyboard focus", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await markup()}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");

    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);
  });

  test("opens on hover and closes when the pointer leaves", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.hover("#save");
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);

    await page.mouse.move(0, 0);
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(false);
  });

  test("closes on Escape", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.hover("#save");
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);

    await page.keyboard.press("Escape");

    await expect.poll(() => isShown(page)).toBe(false);
  });

  test("publishes its open state for CSS", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.hover("#save");
    await expect.poll(() => page.evaluate(() => document.querySelector("#save-tip")?.hasAttribute("data-open")), { timeout: 3000 }).toBe(true);
  });
});
