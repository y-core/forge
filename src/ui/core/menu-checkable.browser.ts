import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { Menu } from "./menu";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    forgeMenuContract: typeof import("../contracts/menu-contract");
  }
}

const EXPOSE = {
  expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client", forgeMenuContract: "./ui/contracts/menu-contract" },
};

/** Rows stay open on select (`for: false`) so one spec can drive several clicks. */
const MARKUP = () =>
  render(
    Menu({
      children: [
        Menu.Trigger({ for: "m", children: "View" }),
        Menu.Popup({
          triggered: true,
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

  // A client-built row is the only shape that can be `aria-disabled` — the SSR rows take the native
  // `disabled` — and where `command` would close the menu before a listener forge owns got a say.
  test("a disabled row built from menuItemAttrs neither flips its state nor closes the menu", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const row = document.createElement("button");
      row.type = "button";
      row.id = "inert";
      row.textContent = "Wrap (unavailable)";
      const attrs = window.forgeMenuContract.menuItemAttrs({ role: "menuitemcheckbox", disabled: true, closes: "m" });
      for (const [name, value] of Object.entries(attrs)) row.setAttribute(name, value);
      document.querySelector("#m")?.append(row);
    });

    await page.focus("#inert");
    await page.keyboard.press("Enter");

    expect(await stateOf(page, "inert")).toEqual({ aria: "false", data: false });
    expect(await page.evaluate(() => document.querySelector("#m")?.matches(":popover-open") ?? false)).toBe(true);
  });

  test("re-selecting the already-checked radio row leaves it checked", async ({ page }) => {
    await open(page);

    await page.click("#sm");

    expect(await stateOf(page, "sm")).toEqual({ aria: "true", data: true });
  });
});
