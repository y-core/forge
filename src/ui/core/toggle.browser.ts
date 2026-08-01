import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Toggle } from "./toggle";

/**
 * `Toggle` — a lone two-state button, deliberately not a form control.
 *
 * The markup is rendered with **no caller-supplied wiring**, and that is the point. `Toggle` stamps
 * a lazy scope, and a lazy scope resumes only on a `data-on-*` interaction; for as long as the
 * component emitted the scope name and left the action to the caller, a plain `<Toggle>` was a
 * button that announced its own behaviour and had none.
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

test.describe("Toggle", () => {
  test("renders as a button with an explicit pressed state, not a checkbox", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", children: "Bold" })), EXPOSE);

    const shape = await page.evaluate(() => {
      const el = document.querySelector("#bold");
      return { tag: el?.tagName, type: el?.getAttribute("type"), aria: el?.getAttribute("aria-pressed"), name: el?.getAttribute("name") };
    });

    expect(shape).toEqual({ tag: "BUTTON", type: "button", aria: "false", name: null });
  });

  test("flips both halves of its pressed state on click", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", children: "Bold" })), EXPOSE);
    await start(page);

    await page.click("#bold");
    expect(
      await page.evaluate(() => {
        const el = document.querySelector("#bold");
        return { aria: el?.getAttribute("aria-pressed"), data: el?.hasAttribute("data-pressed") };
      }),
    ).toEqual({ aria: "true", data: true });

    await page.click("#bold");
    expect(
      await page.evaluate(() => {
        const el = document.querySelector("#bold");
        return { aria: el?.getAttribute("aria-pressed"), data: el?.hasAttribute("data-pressed") };
      }),
    ).toEqual({ aria: "false", data: false });
  });

  test("carries the action that resumes its own scope, with nothing asked of the caller", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", children: "Bold" })), EXPOSE);

    expect(
      await page.evaluate(() => {
        const el = document.querySelector("#bold");
        return { scope: el?.getAttribute("data-scope"), action: el?.getAttribute("data-on-click") };
      }),
    ).toEqual({ scope: "toggle", action: "toggle" });
  });

  test("a server-rendered pressed toggle un-presses on the first click", async ({ page }) => {
    await mount(page, await render(Toggle({ id: "bold", pressed: true, children: "Bold" })), EXPOSE);
    await start(page);

    await page.click("#bold");

    expect(
      await page.evaluate(() => {
        const el = document.querySelector("#bold");
        return { aria: el?.getAttribute("aria-pressed"), data: el?.hasAttribute("data-pressed") };
      }),
    ).toEqual({ aria: "false", data: false });
  });
});
