import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
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

function markup(id = "tips"): Promise<string> {
  return render(
    Popover({
      children: [
        Popover.Trigger({ for: id, "data-ref": "trigger", children: "Tips" }),
        Popover.Content({ id, label: "Tips", side: "top", align: "end", children: "Body" }),
      ],
    }),
  );
}

function state(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#tips");
    return {
      nativeOpen: panel?.matches(":popover-open"),
      // The exact selector `forge-ui.css` lights the trigger with — matching it is the whole
      // mechanism, so the assertion needs no stylesheet.
      triggerLit: document.querySelector("[data-slot~='popover']:has(> [data-slot~='popover-content']:popover-open)") !== null,
    };
  });
}

test.describe("Popover", { tag: "@cross-engine" }, () => {
  test("resumes to the state the element is actually in, not to a rendered guess", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false, triggerLit: false });
  });

  test("opening lights the trigger through the sheet's :has() selector", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true, triggerLit: true });
  });

  test("toggling closed flips both back", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.click("[data-ref='trigger']");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, triggerLit: false });
  });

  test("flips its invoker's aria-expanded when the popover's id is no CSS identifier", async ({ page }) => {
    await mount(page, await markup('a "b'), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");

    await expect.poll(() => page.evaluate(() => document.querySelector("[data-ref='trigger']")?.getAttribute("aria-expanded"))).toBe("true");
  });

  test("the trigger's aria-expanded follows open, Escape and a second toggle", async ({ page }) => {
    const expanded = () => page.evaluate(() => document.querySelector("[data-ref='trigger']")?.getAttribute("aria-expanded"));
    await mount(page, await markup(), EXPOSE);
    expect(await expanded()).toBe("false");
    await start(page);

    await page.click("[data-ref='trigger']");
    await expect.poll(expanded).toBe("true");
    await page.keyboard.press("Escape");
    await expect.poll(expanded).toBe("false");
    await page.click("[data-ref='trigger']");
    await expect.poll(expanded).toBe("true");
    await page.click("[data-ref='trigger']");

    await expect.poll(expanded).toBe("false");
  });

  test("light-dismiss is the platform's, and the attributes follow it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("[data-ref='trigger']");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, triggerLit: false });
  });

  test("placement is the server's and survives every reconciliation", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);
    await page.click("[data-ref='trigger']");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);

    expect(
      await page.evaluate(() => {
        const panel = document.querySelector("#tips");
        return { side: panel?.getAttribute("data-side"), align: panel?.getAttribute("data-align") };
      }),
    ).toEqual({ side: "top", align: "end" });
  });
});

test.describe("Popover — inside a paragraph", () => {
  test("stays inside the paragraph instead of splitting it", async ({ page }) => {
    await mount(page, `<p>text ${await markup()} more</p>`);

    expect(
      await page.evaluate(() => {
        const paragraph = document.querySelector("p");
        return {
          paragraphs: document.querySelectorAll("p").length,
          keepsTail: paragraph?.textContent?.includes("more") ?? false,
          holdsRoot: paragraph?.querySelector("[data-slot~='popover']") !== null,
          holdsContent: paragraph?.querySelector("#tips") !== null,
        };
      }),
    ).toEqual({ paragraphs: 1, keepsTail: true, holdsRoot: true, holdsContent: true });
  });
});
