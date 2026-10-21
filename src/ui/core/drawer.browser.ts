import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import type { PhysicalSide } from "../contracts/types";
import { Drawer } from "./drawer";

const W_80 = 320;

// Reduced motion is what lets a placement assertion read a settled rect on the frame it opens.
async function open(page: Page, side: PhysicalSide = "left", motion = false): Promise<void> {
  if (!motion) await page.emulateMedia({ reducedMotion: "reduce" });
  const html = await render([
    Drawer.Trigger({ for: "nav", id: "open-it", children: "Menu" }),
    Drawer({
      id: "nav",
      side,
      titled: true,
      children: [Drawer.Title({ for: "nav", children: "Navigation" }), Drawer.Close({ for: "nav", id: "close-it", children: "Done" })],
    }),
  ]);
  const pageEdge = `<button id="page-edge" style="position: fixed; inset: 100px auto 0 0; width: 50vw" onclick="this.dataset.hit = ''">page</button>`;
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${pageEdge}${html}`);
}

function modal(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => document.querySelector<HTMLDialogElement>("#nav")?.matches(":modal"));
}

function activeId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.activeElement?.id);
}

function display(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector("#nav") as HTMLElement).display);
}

function box(page: Page): Promise<{ left: number; right: number; top: number; bottom: number; width: number; viewport: number }> {
  return page.evaluate(() => {
    const rect = (document.querySelector("#nav") as HTMLElement).getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      viewport: window.innerWidth,
    };
  });
}

test.describe("Drawer", () => {
  test("the trigger opens it as a real modal, and Escape closes it", async ({ page }) => {
    await open(page);

    expect(await modal(page)).toBe(false);

    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => modal(page)).toBe(false);
  });

  test("focus lands inside on open and returns to the trigger on close", async ({ page }) => {
    await open(page);

    await page.click("#open-it");
    await expect.poll(() => activeId(page)).toBe("close-it");

    await page.click("#close-it");
    await expect.poll(() => activeId(page)).toBe("open-it");
  });

  test("data-side=left pins the panel to the inline-start edge", async ({ page }) => {
    await open(page, "left");
    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    const rect = await box(page);
    expect(rect.left, `left ${rect.left} — the panel is not against the edge`).toBe(0);
    expect(rect.top).toBe(0);
  });

  test("data-side=right pins the panel to the inline-end edge", async ({ page }) => {
    await open(page, "right");
    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    const rect = await box(page);
    expect(rect.right, `right ${rect.right} against a ${rect.viewport} viewport`).toBe(rect.viewport);
    expect(rect.left).toBeGreaterThan(0);
  });

  test("the open panel is as wide as its w-80 default", async ({ page }) => {
    await open(page);
    await page.click("#open-it");
    await expect.poll(() => modal(page)).toBe(true);

    expect((await box(page)).width).toBe(W_80);
  });

  test("the entry slide settles against the edge it starts off", async ({ page }) => {
    await open(page, "left", true);
    const sliding = await page.evaluate(() => {
      (document.querySelector("#open-it") as HTMLButtonElement).click();
      const panel = document.querySelector("#nav") as HTMLElement;
      return panel.getAnimations().some((animation) => (animation as CSSTransition).transitionProperty === "translate");
    });
    expect(sliding, "no translate transition ran on open").toBe(true);

    // The one case that must not opt out of motion: `@starting-style` puts the panel a full width
    // off-screen, and this is what proves it arrives — polled, because it arrives over 200ms.
    await expect.poll(() => box(page).then((rect) => rect.left)).toBe(0);
  });

  for (const motion of [false, true]) {
    const label = motion ? "with motion" : "under reduced motion";

    test(`a closed drawer is display:none ${label}`, async ({ page }) => {
      await open(page, "left", motion);

      expect(await display(page)).toBe("none");
    });

    test(`a click on the page's left edge reaches the page while the drawer is closed, ${label}`, async ({ page }) => {
      await open(page, "left", motion);

      await page.mouse.click(4, 300);

      expect(await page.evaluate(() => document.querySelector<HTMLElement>("#page-edge")?.dataset.hit)).toBe("");
    });
  }
});

test.describe("Drawer — non-modal <Drawer open>", () => {
  async function openInPage(page: Page): Promise<void> {
    const html = await render(
      Drawer({ id: "nav", side: "right", open: true, titled: true, children: [Drawer.Title({ for: "nav", children: "Navigation" })] }),
    );
    const after = `<div id="after" style="position: relative; height: 100vh">Positioned page content after the drawer.</div>`;
    await mount(
      page,
      `<style>${await compiledCss(renderedClasses(html))}</style><main><p>Page content above the drawer.</p>${html}${after}</main>`,
    );
  }

  test("docks fixed at its right edge while open", async ({ page }) => {
    await openInPage(page);

    const docked = await page.evaluate(() => {
      const panel = document.querySelector("#nav") as HTMLDialogElement;
      const rect = panel.getBoundingClientRect();
      return {
        modal: panel.matches(":modal"),
        position: getComputedStyle(panel).position,
        right: Math.round(rect.right),
        top: Math.round(rect.top),
      };
    });

    expect(docked).toEqual({ modal: false, position: "fixed", right: await page.evaluate(() => window.innerWidth), top: 0 });
  });

  test("paints above positioned page content that comes after it", async ({ page }) => {
    await openInPage(page);

    const hit = await page.evaluate(() => {
      const rect = (document.querySelector("#nav") as HTMLElement).getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("#nav") !== null;
    });

    expect(hit).toBe(true);
  });

  test("keeps that edge through close(), sliding out rather than jumping", async ({ page }) => {
    await openInPage(page);

    const frames = await page.evaluate(
      () =>
        new Promise<{ docked: { left: number; top: number }; closing: Array<{ left: number; top: number }> }>((resolve) => {
          const panel = document.querySelector("#nav") as HTMLDialogElement;
          const read = () => {
            const rect = panel.getBoundingClientRect();
            return { left: Math.round(rect.left), top: Math.round(rect.top) };
          };
          const docked = read();
          const closing: Array<{ left: number; top: number }> = [];
          panel.close();
          const tick = () => {
            if (getComputedStyle(panel).display !== "none") closing.push(read());
            if (closing.length < 6 && getComputedStyle(panel).display !== "none") requestAnimationFrame(tick);
            else resolve({ docked, closing });
          };
          tick();
        }),
    );

    expect(frames.closing.length, "no frame caught the panel after close()").toBeGreaterThan(0);
    for (const frame of frames.closing) {
      expect(frame.left, `a closing frame left the docked edge: ${JSON.stringify(frames)}`).toBeGreaterThanOrEqual(frames.docked.left);
      expect(frame.top, `a closing frame moved off the top edge: ${JSON.stringify(frames)}`).toBe(frames.docked.top);
    }
  });
});
