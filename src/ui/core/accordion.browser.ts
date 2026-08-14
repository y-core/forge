import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
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
      return { nativeOpen: el?.open, open: el?.hasAttribute("data-open"), closed: el?.hasAttribute("data-closed") };
    };
    return { one: read("one"), two: read("two") };
  });
}

test.describe("Accordion", () => {
  test("both items start closed and say so", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({
      one: { nativeOpen: false, open: false, closed: true },
      two: { nativeOpen: false, open: false, closed: true },
    });
  });

  test("clicking a trigger opens that item and the state attributes follow", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#one-trigger");

    await expect
      .poll(() => state(page))
      .toEqual({ one: { nativeOpen: true, open: true, closed: false }, two: { nativeOpen: false, open: false, closed: true } });
  });

  test("an exclusive group closes the other item, and its attributes are reconciled too", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#one-trigger");
    await expect.poll(async () => (await state(page)).one.open).toBe(true);
    await page.click("#two-trigger");

    await expect
      .poll(() => state(page))
      .toEqual({ one: { nativeOpen: false, open: false, closed: true }, two: { nativeOpen: true, open: true, closed: false } });
  });

  test("a server-rendered open item needs no client work to be correct", async ({ page }) => {
    await mount(page, await markup(true), EXPOSE);

    expect(await state(page)).toEqual({
      one: { nativeOpen: true, open: true, closed: false },
      two: { nativeOpen: false, open: false, closed: true },
    });
  });
});
