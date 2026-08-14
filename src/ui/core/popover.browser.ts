import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Popover } from "./popover";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function markup(): Promise<string> {
  return render(
    Popover({
      children: [
        Popover.Trigger({ id: "tips", "data-ref": "trigger", children: "Tips" }),
        Popover.Content({ id: "tips", side: "top", align: "end", children: "Body" }),
      ],
    }),
  );
}

function state(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#tips");
    return {
      nativeOpen: panel?.matches(":popover-open"),
      open: panel?.hasAttribute("data-open"),
      closed: panel?.hasAttribute("data-closed"),
      triggerLit: document.querySelector("[data-ref='trigger']")?.hasAttribute("data-popup-open"),
    };
  });
}

test.describe("Popover", () => {
  test("resumes to the state the element is actually in, not to a rendered guess", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("opening publishes data-open on the panel and data-popup-open on the trigger", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true, open: true, closed: false, triggerLit: true });
  });

  test("toggling closed flips both back", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.click("[data-ref='trigger']");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("light-dismiss is the platform's, and the attributes follow it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("placement is the server's and survives every reconciliation", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);
    await page.click("[data-ref='trigger']");
    await expect.poll(async () => (await state(page)).open).toBe(true);

    expect(
      await page.evaluate(() => {
        const panel = document.querySelector("#tips");
        return { side: panel?.getAttribute("data-side"), align: panel?.getAttribute("data-align") };
      }),
    ).toEqual({ side: "top", align: "end" });
  });
});
