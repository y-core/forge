import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Tooltip } from "./tooltip";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };
const CSS = ["./ui/assets/css/forge-ui.css"];

// Wide and tall, and far from the trigger, so the pointer has real distance to cross — a tooltip
// abutting its trigger would pass by accident.
const MARKUP = () =>
  render(
    Tooltip({
      children: [
        Tooltip.Trigger({ for: "tip", children: "Help" }),
        Tooltip.Content({ id: "tip", side: "bottom", children: "A long explanation the user may want to select and copy." }),
      ],
    }),
  );

function isOpen(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => document.querySelector("#tip")?.matches(":popover-open"));
}

test.describe("Tooltip — WCAG 2.1 SC 1.4.13 Hoverable", () => {
  test("stays open while the pointer travels from the trigger onto the tooltip", async ({ page }) => {
    await mount(page, await MARKUP(), { ...EXPOSE, css: CSS });
    await page.evaluate(() => window.forgeResume.resume());

    await page.hover("[data-slot~='tooltip-trigger']");
    await expect.poll(() => isOpen(page)).toBe(true);

    await page.hover("#tip");
    // Well past the 100 ms hide delay the leave from the trigger armed.
    await page.waitForTimeout(400);

    expect(await isOpen(page)).toBe(true);
  });

  test("still closes when the pointer leaves both the trigger and the tooltip", async ({ page }) => {
    await mount(page, await MARKUP(), { ...EXPOSE, css: CSS });
    await page.evaluate(() => window.forgeResume.resume());

    await page.hover("[data-slot~='tooltip-trigger']");
    await expect.poll(() => isOpen(page)).toBe(true);

    await page.mouse.move(5, 5);
    await expect.poll(() => isOpen(page)).toBe(false);
  });

  test("marks itself mounted, which is what retires the CSS-only fallback", async ({ page }) => {
    await mount(page, await MARKUP(), { ...EXPOSE, css: CSS });
    await page.evaluate(() => window.forgeResume.resume());

    expect(await page.evaluate(() => document.querySelector("[data-slot~='tooltip']")?.hasAttribute("data-tooltip-mounted"))).toBe(true);
  });
});

// `mount`'s `css` option goes through `page.addStyleTag`, which is itself script — unusable in the
// very mode these tests exist to cover. Inlined instead, which is also closer to what a no-script
// reader actually receives.
const INLINE_CSS = readFileSync(fileURLToPath(new URL("../assets/css/forge-ui.css", import.meta.url)), "utf-8");

async function mountWithoutScript(page: Page): Promise<void> {
  await mount(page, `<style>${INLINE_CSS}</style>${await MARKUP()}`);
}

test.describe("Tooltip — with scripting off", () => {
  test.use({ javaScriptEnabled: false });

  test("the content is display:none until the trigger is hovered, then legible", async ({ page }) => {
    await mountWithoutScript(page);

    const content = page.locator("#tip");
    await expect(content).toBeHidden();

    await page.hover("[data-slot~='tooltip-trigger']");
    await expect(content).toBeVisible();
    await expect(content).toHaveText("A long explanation the user may want to select and copy.");
  });

  test("keyboard focus on the trigger reveals it too", async ({ page }) => {
    await mountWithoutScript(page);

    await page.locator("[data-slot~='tooltip-trigger']").focus();

    await expect(page.locator("#tip")).toBeVisible();
  });
});
