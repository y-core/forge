import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Collapsible } from "./collapsible";

/**
 * `Collapsible` on native `<details>`: the platform owns open and closed, the controller only
 * publishes them.
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

test.describe("Collapsible", () => {
  const markup = () =>
    render(
      Collapsible({
        id: "adv",
        children: [Collapsible.Trigger({ id: "adv-trigger", children: "Advanced" }), Collapsible.Panel({ children: "Body" })],
      }),
    );

  function state(page: Page) {
    return page.evaluate(() => {
      const el = document.querySelector<HTMLDetailsElement>("#adv");
      return { nativeOpen: el?.open, open: el?.hasAttribute("data-open"), closed: el?.hasAttribute("data-closed") };
    });
  }

  test("starts closed, with the state attribute matching the element's own", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false, open: false, closed: true });
  });

  test("the summary opens it and the state attributes follow the platform", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#adv-trigger");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true, open: true, closed: false });
  });

  test("closing again flips the pair back", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#adv-trigger");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.click("#adv-trigger");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true });
  });

  test("a server-rendered open disclosure needs no client work to be correct", async ({ page }) => {
    await mount(page, await render(Collapsible({ id: "adv", open: true, children: Collapsible.Trigger({ children: "Advanced" }) })), EXPOSE);

    expect(await state(page)).toEqual({ nativeOpen: true, open: true, closed: false });
  });
});
