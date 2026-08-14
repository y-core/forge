import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { Dialog } from "../core/dialog";
import { Popover } from "../core/popover";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeTransition: typeof import("./transition");
    disposeTransition?: () => void;
  }
}

const EXPOSE = { expose: { forgeTransition: "./ui/client/transition" } };

/** Real SSR markup: the trigger/content pair `core/popover.tsx` emits. */
function popoverMarkup(): Promise<string> {
  return render([Popover.Trigger({ id: "panel", children: "open" }), Popover.Content({ id: "panel", children: "contents" })]);
}

async function install(page: Page, selector: string, options: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    ({ sel, opts }) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) window.disposeTransition = window.forgeTransition.mountTransitionState(el, opts);
    },
    { sel: selector, opts: options },
  );
}

/** Which of the four transition attributes are present, plus the platform's own answer. */
function readState(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    return {
      open: el.hasAttribute("data-open"),
      closed: el.hasAttribute("data-closed"),
      starting: el.hasAttribute("data-starting-style"),
      ending: el.hasAttribute("data-ending-style"),
      platformOpen: el.matches(":popover-open"),
    };
  }, selector);
}

test.describe("popover — open and close through the platform", () => {
  test("starts closed, matching the SSR markup it was rendered with", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");

    expect(await readState(page, "#panel")).toEqual({ open: false, closed: true, starting: false, ending: false, platformOpen: false });
  });

  test("flips to open when the native command opens it", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(() => readState(page, "#panel")).toEqual({ open: true, closed: false, starting: false, ending: false, platformOpen: true });
  });

  test("flips back to closed when the platform light-dismisses it", async ({ page }) => {
    await mount(page, `${await popoverMarkup()}<div id="elsewhere" style="height:200px"></div>`, EXPOSE);
    await install(page, "#panel");

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(async () => (await readState(page, "#panel"))?.open).toBe(true);

    await page.click("#elsewhere");
    await expect.poll(() => readState(page, "#panel")).toEqual({ open: false, closed: true, starting: false, ending: false, platformOpen: false });
  });

  test("flips back to closed on Escape, which the controller never handles itself", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(async () => (await readState(page, "#panel"))?.open).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(async () => (await readState(page, "#panel"))?.closed).toBe(true);
    expect((await readState(page, "#panel"))?.platformOpen).toBe(false);
  });
});

test.describe("data-open and data-closed are mutually exclusive", () => {
  test("never coexist and never both go missing, sampled across a full open/close cycle", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");

    // Sample the pair on every animation frame while the popover is driven open and closed.
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#panel");
      const samples: Array<[boolean, boolean]> = [];
      (window as unknown as { samples: Array<[boolean, boolean]> }).samples = samples;
      const tick = () => {
        if (el) samples.push([el.hasAttribute("data-open"), el.hasAttribute("data-closed")]);
        requestAnimationFrame(tick);
      };
      tick();
    });

    await page.click("[data-slot~='popover-trigger']");
    await page.waitForTimeout(60);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);

    const violations = await page.evaluate(() =>
      (window as unknown as { samples: Array<[boolean, boolean]> }).samples.filter(([open, closed]) => open === closed),
    );

    expect(violations).toEqual([]);
  });
});

test.describe("data-starting-style", () => {
  test("is present on the frame the element opens and gone shortly after", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");

    const sawStarting = await page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>("#panel");
      const trigger = document.querySelector<HTMLElement>("[data-slot~='popover-trigger']");
      trigger?.click();
      // Read synchronously after the click: `beforetoggle` has already run.
      return el?.hasAttribute("data-starting-style") ?? false;
    });

    expect(sawStarting).toBe(true);
    await expect.poll(async () => (await readState(page, "#panel"))?.starting).toBe(false);
  });
});

test.describe("data-ending-style", () => {
  test("is dropped immediately when the element declares no exit timing", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(async () => (await readState(page, "#panel"))?.open).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(async () => (await readState(page, "#panel"))?.ending).toBe(false);
  });

  test("is held for the element's OWN computed duration, not a hardcoded number", async ({ page }) => {
    await mount(
      page,
      `<style>
         /* Keyed on the attribute the controller writes — the duration is only discoverable once
            that attribute is applied, which is the ordering the controller has to get right. */
         [data-slot~='popover-content'][data-ending-style] { transition: opacity 400ms linear; }
       </style>
       ${await popoverMarkup()}`,
      EXPOSE,
    );
    await install(page, "#panel");

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(async () => (await readState(page, "#panel"))?.open).toBe(true);
    await page.keyboard.press("Escape");

    // Still animating out well after a naive "next tick" would have cleared it…
    await page.waitForTimeout(150);
    expect((await readState(page, "#panel"))?.ending).toBe(true);
    // …and cleared once the element's own 400ms has elapsed.
    await expect.poll(async () => (await readState(page, "#panel"))?.ending, { timeout: 2000 }).toBe(false);
  });

  test("honours an explicit override when a consumer supplies one", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel", { exitDurationMs: 300 });

    await page.click("[data-slot~='popover-trigger']");
    await expect.poll(async () => (await readState(page, "#panel"))?.open).toBe(true);
    await page.keyboard.press("Escape");

    await page.waitForTimeout(120);
    expect((await readState(page, "#panel"))?.ending).toBe(true);
    await expect.poll(async () => (await readState(page, "#panel"))?.ending, { timeout: 2000 }).toBe(false);
  });
});

test.describe("dialog", () => {
  test("tracks showModal and the native close command", async ({ page }) => {
    const html = await render([
      Dialog({ id: "confirm", children: Dialog.Close({ for: "confirm", children: "Cancel" }) }),
      Dialog.Trigger({ for: "confirm", children: "Open" }),
    ]);
    await mount(page, html, EXPOSE);
    await install(page, "#confirm");

    const initial = await page.evaluate(() => document.querySelector("#confirm")?.hasAttribute("data-closed"));
    expect(initial).toBe(true);

    await page.click("[data-slot~='dialog-trigger']");
    await expect.poll(() => page.evaluate(() => document.querySelector("#confirm")?.hasAttribute("data-open"))).toBe(true);

    await page.click("[data-slot~='dialog-close']");
    await expect.poll(() => page.evaluate(() => document.querySelector("#confirm")?.hasAttribute("data-closed"))).toBe(true);
  });

  test("tracks Escape, which fires cancel before close", async ({ page }) => {
    const html = await render([Dialog({ id: "confirm", children: "body" }), Dialog.Trigger({ for: "confirm", children: "Open" })]);
    await mount(page, html, EXPOSE);
    await install(page, "#confirm");

    await page.click("[data-slot~='dialog-trigger']");
    await expect.poll(() => page.evaluate(() => document.querySelector("#confirm")?.hasAttribute("data-open"))).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.querySelector("#confirm")?.hasAttribute("data-closed"))).toBe(true);
  });

  test("syncs to a dialog the server rendered already open", async ({ page }) => {
    await mount(page, await render(Dialog({ id: "confirm", open: true, children: "body" })), EXPOSE);
    await install(page, "#confirm");

    const state = await page.evaluate(() => {
      const el = document.querySelector("#confirm");
      return { open: el?.hasAttribute("data-open"), closed: el?.hasAttribute("data-closed") };
    });

    expect(state).toEqual({ open: true, closed: false });
  });
});

test.describe("disposer", () => {
  test("stops publishing state and leaves the platform untouched", async ({ page }) => {
    await mount(page, await popoverMarkup(), EXPOSE);
    await install(page, "#panel");
    await page.evaluate(() => window.disposeTransition?.());

    await page.click("[data-slot~='popover-trigger']");

    const state = await readState(page, "#panel");
    expect(state).toEqual({ open: false, closed: true, starting: false, ending: false, platformOpen: true });
  });
});
