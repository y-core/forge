import { expect, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
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
