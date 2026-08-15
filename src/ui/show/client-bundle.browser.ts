import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { ThemeToggle } from "../chrome/theme-toggle";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "../core/icon";
import { Menu } from "../core/menu";
import { Toast } from "../core/toast";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

// The point of this spec: *only* the show bundle, exactly what a consumer following the README
// imports. `showcase.browser.ts` loads all three bundles by hand, which masked the missing
// transitive imports entirely.
const icon = createIcon("/sprite.svg");

const SHOW_ONLY = { expose: { forgeResume: "./ui/client/resume", forgeShowClient: "./ui/show/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

test.describe("the show bundle alone registers every scope the showcase stamps", () => {
  test("resumes without warning that a scope is unregistered", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });

    const html = [
      await render(ThemeToggle({ icon })),
      await render(Menu({ children: [Menu.Trigger({ id: "m", children: "File" }), Menu.Popup({ id: "m", children: "Item" })] })),
      await render(Toast.Container({ children: Toast({ id: "t", dismissible: true, children: "Saved" }) })),
    ].join("");

    await mount(page, html, SHOW_ONLY);
    await start(page);

    expect(warnings.filter((text) => text.includes("no scope registered"))).toEqual([]);
  });

  test("the chrome theme toggle switches the document theme", async ({ page }) => {
    await mount(page, await render(ThemeToggle({ icon })), SHOW_ONLY);
    await start(page);

    const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme-preference"));
    await page.click("[data-scope='theme'] button");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme-preference"))).not.toBe(before);
  });

  test("a core menu opens and its trigger reports expanded", async ({ page }) => {
    const html = await render(Menu({ children: [Menu.Trigger({ id: "m", children: "File" }), Menu.Popup({ id: "m", children: "Item" })] }));
    await mount(page, html, SHOW_ONLY);
    await start(page);

    await page.click("[data-slot~='menu-trigger']");

    expect(await page.evaluate(() => document.querySelector("#m")?.matches(":popover-open"))).toBe(true);
    expect(await page.getAttribute("[data-slot~='menu-trigger']", "aria-expanded")).toBe("true");
  });

  test("a core toast dismisses", async ({ page }) => {
    const html = await render(Toast.Container({ children: Toast({ id: "t", dismissible: true, children: "Saved" }) }));
    await mount(page, html, SHOW_ONLY);
    await start(page);

    await page.click("#t [data-slot~='toast-close']");

    expect(await page.evaluate(() => document.querySelector("#t"))).toBeNull();
  });
});
