import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Dialog } from "./dialog";

/**
 * `Dialog` after render, which is the only place its defect was visible.
 *
 * The component stamps `data-open` / `data-closed` from its `open` prop, and until the `dialog`
 * scope existed that was the last time either attribute moved: the platform opened the dialog, put
 * it in the top layer, trapped focus and drew a backdrop, and the styling hook still said
 * `data-closed`. Every case here therefore *opens or closes something* and then re-reads the DOM —
 * a render-time assertion passes against the bug.
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

/** Trigger + dialog + a close button, all linked by one id. */
function markup(open = false): Promise<string> {
  return render([
    Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete…" }),
    Dialog({ id: "confirm", ...(open ? { open } : {}), children: Dialog.Close({ for: "confirm", id: "close-it", children: "Cancel" }) }),
  ]);
}

function state(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("#confirm");
    return {
      nativeOpen: dialog?.open,
      open: dialog?.hasAttribute("data-open"),
      closed: dialog?.hasAttribute("data-closed"),
      triggerLit: document.querySelector("#open-it")?.hasAttribute("data-popup-open"),
    };
  });
}

test.describe("Dialog", () => {
  test("starts closed, with the trigger unlit", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("the trigger opens it and both the dialog and the trigger publish it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true, open: true, closed: false, triggerLit: true });
  });

  test("closing flips the dialog's pair and unlights the trigger", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.click("#close-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("Escape closes it, and the state attributes follow the platform's own cancel", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("a Close button is not mistaken for a trigger", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).open).toBe(true);

    // `Dialog.Close` names the same `commandfor` target, so a bare `[commandfor]` lookup would light
    // it up as if it opened the dialog. `data-popup-open` means "this opens the thing that is open".
    expect(await page.evaluate(() => document.querySelector("#close-it")?.hasAttribute("data-popup-open"))).toBe(false);
  });

  test("a server-rendered open dialog is already correct when the scope resumes", async ({ page }) => {
    await mount(page, await markup(true), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: true, open: true, closed: false, triggerLit: true });
  });
});
