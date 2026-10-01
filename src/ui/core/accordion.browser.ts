import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import { Accordion } from "./accordion";
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

function markup(openFirst = false): Promise<string> {
  return render(
    Accordion({
      children: [
        Accordion.Item({
          id: "one",
          name: "faq",
          ...(openFirst ? { open: true } : {}),
          children: [Accordion.Trigger({ id: "one-trigger", icon, children: "One" }), Accordion.Content({ children: "First" })],
        }),
        Accordion.Item({
          id: "two",
          name: "faq",
          children: [Accordion.Trigger({ id: "two-trigger", icon, children: "Two" }), Accordion.Content({ children: "Second" })],
        }),
      ],
    }),
  );
}

function state(page: Page) {
  return page.evaluate(() => {
    const read = (id: string) => {
      const el = document.querySelector<HTMLDetailsElement>(`#${id}`);
      return { nativeOpen: el?.open };
    };
    return { one: read("one"), two: read("two") };
  });
}

test.describe("Accordion", () => {
  test("both items start closed and say so", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ one: { nativeOpen: false }, two: { nativeOpen: false } });
  });

  test("clicking a trigger sets the platform's own open state on that item", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#one-trigger");

    await expect.poll(() => state(page)).toEqual({ one: { nativeOpen: true }, two: { nativeOpen: false } });
  });

  // The keys a `<summary>` takes from the platform, pinned because every other test here clicks.
  for (const key of ["Enter", " "] as const) {
    test(`${key === " " ? "Space" : key} on a trigger opens its own item and no other`, async ({ page }) => {
      await mount(page, await markup(), EXPOSE);
      await start(page);

      await page.focus("#two-trigger");
      await page.keyboard.press(key);

      await expect.poll(() => state(page)).toEqual({ one: { nativeOpen: false }, two: { nativeOpen: true } });
    });
  }

  test("an exclusive group closes the other item, so exactly one stays open", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#one-trigger");
    await expect.poll(async () => (await state(page)).one.nativeOpen).toBe(true);
    await page.click("#two-trigger");

    await expect.poll(() => state(page)).toEqual({ one: { nativeOpen: false }, two: { nativeOpen: true } });
  });

  test("a server-rendered open item needs no client work to be correct", async ({ page }) => {
    await mount(page, await markup(true), EXPOSE);

    expect(await state(page)).toEqual({ one: { nativeOpen: true }, two: { nativeOpen: false } });
  });
});

test.describe("Accordion — nested, under its real stylesheet", () => {
  test.use({ reducedMotion: "reduce" });

  const nested = () =>
    render(
      Accordion({
        children: Accordion.Item({
          id: "outer",
          open: true,
          children: [
            Accordion.Trigger({ icon, children: "Outer" }),
            Accordion.Content({
              children: Accordion({
                children: Accordion.Item({
                  id: "inner",
                  children: [Accordion.Trigger({ icon, id: "inner-trigger", children: "Inner" }), Accordion.Content({ children: "Body" })],
                }),
              }),
            }),
          ],
        }),
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

  test("a closed item inside an open one keeps its own chevron unturned, and turns it once opened", async ({ page }) => {
    const html = await nested();
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);

    expect(await chevronRotation(page)).toEqual({ outer: "180deg", inner: "none" });

    await page.click("#inner-trigger");

    await expect.poll(() => chevronRotation(page)).toEqual({ outer: "180deg", inner: "180deg" });
  });
});
