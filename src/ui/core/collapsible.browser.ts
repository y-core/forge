import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Collapsible } from "./collapsible";
import { createIcon } from "./icon";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

const icon = createIcon("/sprite.svg");

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

test.describe("Collapsible", () => {
  const markup = () =>
    render(
      Collapsible({
        id: "adv",
        children: [Collapsible.Trigger({ icon, id: "adv-trigger", children: "Advanced" }), Collapsible.Panel({ children: "Body" })],
      }),
    );

  function state(page: Page) {
    return page.evaluate(() => {
      const el = document.querySelector<HTMLDetailsElement>("#adv");
      return { nativeOpen: el?.open };
    });
  }

  test("starts closed", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false });
  });

  test("the summary opens it and the state attributes follow the platform", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#adv-trigger");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true });
  });

  test("closing again flips the pair back", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#adv-trigger");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.click("#adv-trigger");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  test("a server-rendered open disclosure needs no client work to be correct", async ({ page }) => {
    await mount(page, await render(Collapsible({ id: "adv", open: true, children: Collapsible.Trigger({ icon, children: "Advanced" }) })), EXPOSE);

    expect(await state(page)).toEqual({ nativeOpen: true });
  });
});
