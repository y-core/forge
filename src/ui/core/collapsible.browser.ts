import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
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
        children: [Collapsible.Trigger({ icon, id: "adv-trigger", children: "Advanced" }), Collapsible.Content({ children: "Body" })],
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

  // Every other test clicks: a `<summary>` takes Enter and Space from the platform, and a change that
  // moved the trigger off one would pass a pointer-only suite.
  for (const key of ["Enter", " "] as const) {
    test(`${key === " " ? "Space" : key} on the summary opens it, as the platform gives it`, async ({ page }) => {
      await mount(page, await markup(), EXPOSE);
      await start(page);

      await page.focus("#adv-trigger");
      await page.keyboard.press(key);

      await expect.poll(() => state(page)).toEqual({ nativeOpen: true });
    });
  }

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

test.describe("Collapsible — nested, under its real stylesheet", () => {
  test.use({ reducedMotion: "reduce" });

  const nested = () =>
    render(
      Collapsible({
        id: "outer",
        open: true,
        children: [
          Collapsible.Trigger({ icon, children: "Outer" }),
          Collapsible.Content({
            children: Collapsible({
              id: "inner",
              children: [Collapsible.Trigger({ icon, id: "inner-trigger", children: "Inner" }), Collapsible.Content({ children: "Body" })],
            }),
          }),
        ],
      }),
    );

  const chevronRotation = (page: Page) =>
    page.evaluate(() =>
      Object.fromEntries(
        ["outer", "inner"].map((id) => {
          const chevron = document.querySelector(`#${id} > summary > svg`);
          if (chevron === null) throw new Error(`#${id} has no chevron in its summary`);
          return [id, getComputedStyle(chevron).rotate];
        }),
      ),
    );

  test("a closed disclosure inside an open one keeps its own chevron unturned, and turns it once opened", async ({ page }) => {
    const html = await nested();
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);

    expect(await chevronRotation(page)).toEqual({ outer: "180deg", inner: "none" });

    await page.click("#inner-trigger");

    await expect.poll(() => chevronRotation(page)).toEqual({ outer: "180deg", inner: "180deg" });
  });
});
