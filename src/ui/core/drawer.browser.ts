import { expect, type Page, test } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import type { PhysicalSide } from "../contracts/state-attrs";
import { Drawer } from "./drawer";

const CSS = { css: ["./ui/assets/css/forge-ui.css"] };

// Stands in for Tailwind's preflight, which no build supplies here — and for the `fixed` utility the
// drawer carries, which a raw sheet cannot resolve either.
const PREFLIGHT = `<style>
  *, ::before, ::after { box-sizing: border-box; }
  body { margin: 0; }
  dialog[data-slot~="drawer"] { position: fixed; width: 16rem; height: 100%; border: 0; padding: 0; }
</style>`;

// Placement is `inset`; the slide that carries the panel to it is separate (forge-ui.css:790).
// Reduced motion is what lets a placement assertion read a settled rect on the frame it opens.
async function open(page: Page, side: PhysicalSide = "left", motion = false): Promise<void> {
  if (!motion) await page.emulateMedia({ reducedMotion: "reduce" });
  const html = await render([
    Drawer.Trigger({ for: "nav", id: "open-it", children: "Menu" }),
    Drawer({ id: "nav", side, children: Drawer.Close({ for: "nav", id: "close-it", children: "Done" }) }),
  ]);
  await mount(page, `${PREFLIGHT}${html}`, CSS);
}

function modal(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => document.querySelector<HTMLDialogElement>("#nav")?.matches(":modal"));
}

function activeId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.activeElement?.id);
}

function box(page: Page): Promise<{ left: number; right: number; top: number; bottom: number; viewport: number }> {
  return page.evaluate(() => {
    const rect = (document.querySelector("#nav") as HTMLElement).getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewport: window.innerWidth,
    };
  });
}

test.describe("Drawer", () => {
  test("the trigger opens it as a real modal, and Escape closes it", async ({ page }) => {
    await open(page);

    expect(await modal(page)).toBe(false);

    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => modal(page)).toBe(false);
  });

  test("focus lands inside on open and returns to the trigger on close", async ({ page }) => {
    await open(page);

    await page.click("#open-it");
    await expect.poll(() => activeId(page)).toBe("close-it");

    await page.click("#close-it");
    await expect.poll(() => activeId(page)).toBe("open-it");
  });

  test("data-side=left pins the panel to the inline-start edge", async ({ page }) => {
    await open(page, "left");
    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    const rect = await box(page);
    expect(rect.left, `left ${rect.left} — the panel is not against the edge`).toBe(0);
    expect(rect.top).toBe(0);
  });

  test("data-side=right pins the panel to the inline-end edge", async ({ page }) => {
    await open(page, "right");
    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    const rect = await box(page);
    expect(rect.right, `right ${rect.right} against a ${rect.viewport} viewport`).toBe(rect.viewport);
    expect(rect.left).toBeGreaterThan(0);
  });

  test("the entry slide settles against the edge it starts off", async ({ page }) => {
    await open(page, "left", true);
    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    // The one case that must not opt out of motion: `@starting-style` puts the panel a full width
    // off-screen, and this is what proves it arrives — polled, because it arrives over 200ms.
    await expect.poll(() => box(page).then((rect) => rect.left)).toBe(0);
  });
});
