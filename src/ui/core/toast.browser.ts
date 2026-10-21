import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { Dock } from "../chrome/dock";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import { FlashContainer } from "../server/flash";
import { createIcon } from "./icon";
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

test.describe("toast scope — focus rehomed by a dismiss", () => {
  async function mountPair(page: import("@playwright/test").Page): Promise<void> {
    const pair = await render(
      Toast.Container({
        children: [Toast({ id: "a", dismissible: true, children: "A" }), Toast({ id: "b", dismissible: true, duration: 1000, children: "B" })],
      }),
    );
    await mount(page, pair, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
  }

  test("a mouse close leaves the next toast counting down", async ({ page }) => {
    await mountPair(page);

    await page.click("#a [data-slot~='toast-close']");
    await page.mouse.move(0, 0);

    await expect.poll(() => page.evaluate(() => document.querySelector("#b") === null)).toBe(true);
  });

  test("a keyboard close holds the next toast while it keeps focus", async ({ page }) => {
    await mountPair(page);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    expect(await page.evaluate(() => document.activeElement?.closest("#b") !== null)).toBe(true);
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

  test("dismissing marks it dismissing and inert at once and removes it after the fade", async ({ page }) => {
    await insertAndRead(page);
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#saved") as HTMLElement).opacity))).toBe(1);

    const atClick = await page.evaluate(() => {
      (document.querySelector("#saved [data-slot~='toast-close']") as HTMLButtonElement).click();
      const toast = document.querySelector("#saved") as HTMLElement | null;
      return { present: toast !== null, dismissing: toast?.hasAttribute("data-dismissing") ?? null, inert: toast?.inert ?? null };
    });

    expect(atClick).toEqual({ present: true, dismissing: true, inert: true });
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
        const toast = document.querySelector("#saved") as HTMLElement | null;
        return { dismissing: toast?.hasAttribute("data-dismissing") ?? null, inert: toast?.inert ?? null };
      });

      expect(atClick).toEqual({ dismissing: true, inert: true });
      await expect.poll(() => page.evaluate(() => document.querySelector("#saved") === null)).toBe(true);
    });
  });
});

test.describe("FlashContainer — taps reach what lies beneath it", () => {
  async function mountOver(page: Page, html: string): Promise<void> {
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
  }

  function probe(page: Page, selector: string): Promise<{ underContainer: boolean; hitsTarget: boolean; x: number; y: number }> {
    return page.evaluate((target) => {
      const element = document.querySelector(target) as HTMLElement;
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const strip = (document.querySelector("#flash-container") as HTMLElement).getBoundingClientRect();
      return {
        underContainer: x > strip.left && x < strip.right && y > strip.top && y < strip.bottom,
        hitsTarget: document.elementFromPoint(x, y)?.closest(target) === element,
        x,
        y,
      };
    }, selector);
  }

  test("an empty container over a footer Save button lets the button take the hit and the click", async ({ page }) => {
    const footer =
      '<footer style="position: fixed; inset-inline: 0; bottom: 0; display: flex; justify-content: flex-end"><button id="save" type="button" style="margin: 0 40px 20px 0; height: 24px">Save</button></footer>';
    await mountOver(page, `${footer}${await render(FlashContainer({}))}`);
    await page.evaluate(() => document.querySelector("#save")?.addEventListener("click", () => document.body.setAttribute("data-saved", "")));

    const at = await probe(page, "#save");
    await page.mouse.click(at.x, at.y);

    expect({
      underContainer: at.underContainer,
      hitsTarget: at.hitsTarget,
      saved: await page.evaluate(() => document.body.hasAttribute("data-saved")),
    }).toEqual({ underContainer: true, hitsTarget: true, saved: true });
  });

  test.describe("at phone width", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("an empty container over the Dock lets a tap on Search navigate", async ({ page }) => {
      const icon = createIcon("/sprite.svg", { "icon-home": "0 0 24 24", "icon-search": "0 0 24 24" });
      const dock = await render(
        Dock({
          items: [
            { label: "Home", href: "home", icon: "home", current: true },
            { label: "Search", href: "search", icon: "search" },
          ],
          resolveHref: (key: string) => `/route/${key}`,
          icon,
        }),
      );
      await mountOver(page, `${dock}${await render(FlashContainer({}))}`);

      const at = await probe(page, "[data-slot~='dock-item'][href='/route/search']");
      expect({ underContainer: at.underContainer, hitsTarget: at.hitsTarget }).toEqual({ underContainer: true, hitsTarget: true });

      await page.mouse.click(at.x, at.y);
      await expect.poll(() => new URL(page.url()).pathname).toBe("/route/search");
    });
  });

  test("a flash toast's dismiss button still takes the hit, and its click dismisses the toast", async ({ page }) => {
    await mountOver(page, await render(FlashContainer({ messages: [{ type: "success", text: "Saved" }] })));

    const at = await probe(page, "[data-slot~='toast-close']");
    expect(at.hitsTarget).toBe(true);

    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-scope='toast']") === null)).toBe(true);
  });
});
