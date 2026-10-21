import { expect, test } from "@playwright/test";

import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { Toast } from "./toast";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

test.describe("toast scope — the auto-dismiss timer", () => {
  test("removes its root once the duration elapses", async ({ page }) => {
    await mount(page, await render(Toast({ duration: 50, children: "hi" })), EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await expect.poll(() => page.evaluate(() => document.querySelector("[data-scope='toast']") === null)).toBe(true);
  });

  test("a hovered toast outlasts its duration, and leaves once the pointer does", async ({ page }) => {
    await mount(page, `<main style="padding: 40px">${await render(Toast({ id: "held", duration: 1000, children: "hi" }))}</main>`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
    await page.hover("#held");

    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => document.querySelector("#held") !== null)).toBe(true);

    await page.mouse.move(0, 0);
    await expect.poll(() => page.evaluate(() => document.querySelector("#held") === null)).toBe(true);
  });

  test("a disposed toast scope does not remove its root when the timer would have fired", async ({ page }) => {
    await mount(page, await render(Toast({ duration: 50, children: "hi" })), EXPOSE);

    const present = await page.evaluate(async () => {
      window.forgeResume.resume()();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return document.querySelector("[data-scope='toast']") !== null;
    });

    expect(present).toBe(true);
  });
});

test.describe("Toast — arrival motion", () => {
  async function insertAndRead(page: import("@playwright/test").Page): Promise<{ transitions: string[]; opacity: number }> {
    const html = await render(Toast({ id: "saved", dismissible: true, children: "Saved" }));
    await mount(page, "<main></main>", { css: ["./ui/assets/css/forge-ui.css"], ...EXPOSE });
    await page.evaluate(() => window.forgeResume.resume());
    return page.evaluate((markup) => {
      document.querySelector("main")?.insertAdjacentHTML("beforeend", markup);
      const toast = document.querySelector("#saved") as HTMLElement;
      return {
        transitions: toast.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty),
        opacity: Number(getComputedStyle(toast).opacity),
      };
    }, html);
  }

  test("an inserted toast fades in from below half opacity", async ({ page }) => {
    const frame = await insertAndRead(page);

    expect(frame.transitions).toEqual(["opacity"]);
    expect(frame.opacity).toBeLessThan(0.5);
  });

  test("dismissing marks it inert at once and removes it after the fade", async ({ page }) => {
    await insertAndRead(page);
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#saved") as HTMLElement).opacity))).toBe(1);

    const atClick = await page.evaluate(() => {
      (document.querySelector("#saved [data-slot~='toast-close']") as HTMLButtonElement).click();
      const toast = document.querySelector("#saved") as HTMLElement | null;
      return { present: toast !== null, inert: toast?.inert ?? null };
    });

    expect(atClick).toEqual({ present: true, inert: true });
    await expect.poll(() => page.evaluate(() => document.querySelector("#saved") === null)).toBe(true);
  });

  test.describe("under reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("an inserted toast still fades in", async ({ page }) => {
      const frame = await insertAndRead(page);

      expect(frame.transitions).toEqual(["opacity"]);
      expect(frame.opacity).toBeLessThan(0.5);
    });

    test("dismissing still fades it out before removing it", async ({ page }) => {
      await insertAndRead(page);
      await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#saved") as HTMLElement).opacity))).toBe(1);

      const atClick = await page.evaluate(() => {
        (document.querySelector("#saved [data-slot~='toast-close']") as HTMLButtonElement).click();
        return (document.querySelector("#saved") as HTMLElement | null)?.inert ?? null;
      });

      expect(atClick).toBe(true);
      await expect.poll(() => page.evaluate(() => document.querySelector("#saved") === null)).toBe(true);
    });
  });
});
