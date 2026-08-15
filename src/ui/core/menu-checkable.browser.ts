import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Menu } from "./menu";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

/** Rows stay open on select (`for: false`) so one spec can drive several clicks. */
const MARKUP = () =>
  render(
    Menu({
      children: [
        Menu.Trigger({ id: "m", children: "View" }),
        Menu.Popup({
          id: "m",
          children: [
            Menu.CheckboxItem({ id: "wrap", for: false, children: "Wrap lines" }),
            Menu.Group({
              children: [
                Menu.RadioItem({ id: "sm", for: false, checked: true, children: "Small" }),
                Menu.RadioItem({ id: "md", for: false, children: "Medium" }),
                Menu.RadioItem({ id: "lg", for: false, children: "Large" }),
              ],
            }),
            Menu.Group({ children: Menu.RadioItem({ id: "other", for: false, checked: true, children: "Other group" }) }),
          ],
        }),
      ],
    }),
  );

async function open(page: Page): Promise<void> {
  await mount(page, await MARKUP(), EXPOSE);
  await page.evaluate(() => window.forgeResume.resume());
  await page.click("[data-slot~='menu-trigger']");
}

function stateOf(page: Page, id: string): Promise<{ aria: string | null | undefined; data: boolean | undefined }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return { aria: el?.getAttribute("aria-checked"), data: el?.hasAttribute("data-checked") };
  }, `#${id}`);
}

test.describe("Menu checkable rows", () => {
  test("a checkbox row flips both halves of its state, and flips back", async ({ page }) => {
    await open(page);

    expect(await stateOf(page, "wrap")).toEqual({ aria: "false", data: false });

    await page.click("#wrap");
    expect(await stateOf(page, "wrap")).toEqual({ aria: "true", data: true });

    await page.click("#wrap");
    expect(await stateOf(page, "wrap")).toEqual({ aria: "false", data: false });
  });

  test("selecting a radio row clears the sibling that was checked", async ({ page }) => {
    await open(page);

    expect(await stateOf(page, "sm")).toEqual({ aria: "true", data: true });

    await page.click("#lg");

    expect(await stateOf(page, "lg")).toEqual({ aria: "true", data: true });
    expect(await stateOf(page, "sm")).toEqual({ aria: "false", data: false });
  });

  test("a radio row leaves a group it does not belong to alone", async ({ page }) => {
    await open(page);

    await page.click("#md");

    expect(await stateOf(page, "md")).toEqual({ aria: "true", data: true });
    expect(await stateOf(page, "other")).toEqual({ aria: "true", data: true });
  });

  test("re-selecting the already-checked radio row leaves it checked", async ({ page }) => {
    await open(page);

    await page.click("#sm");

    expect(await stateOf(page, "sm")).toEqual({ aria: "true", data: true });
  });
});
