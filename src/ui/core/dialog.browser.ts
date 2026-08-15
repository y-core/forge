import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Dialog } from "./dialog";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function markup(open = false): Promise<string> {
  return render([
    Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete…" }),
    Dialog({ id: "confirm", ...(open ? { open } : {}), children: Dialog.Close({ for: "confirm", id: "close-it", children: "Cancel" }) }),
  ]);
}

function state(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("#confirm");
    return { nativeOpen: dialog?.open };
  });
}

test.describe("Dialog", () => {
  test("starts closed", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false });
  });

  test("the trigger opens it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true });
  });

  test("closing clears the platform's own open state", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.click("#close-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  test("Escape closes it through the platform's own cancel", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  test("a server-rendered open dialog is non-modal, which is the only thing the attribute can mean", async ({ page }) => {
    await mount(page, await markup(true), EXPOSE);
    await start(page);

    // `dialog.open` alone cannot tell the two apart, which is what let the old divergence hide:
    // the trigger opened a modal while `open` rendered a non-modal, and both reported `open: true`.
    expect(await page.evaluate(() => document.querySelector<HTMLDialogElement>("#confirm")?.matches(":modal"))).toBe(false);
    expect(await state(page)).toEqual({ nativeOpen: true });
  });
});

const CSS = { css: ["./ui/assets/css/forge-ui.css"] };

const VIEWPORT = { width: 1280, height: 720 };
const GUTTER = 16; // 1rem, the inset the sheet gives every modal dialog

// Stands in for Tailwind's preflight, which no build supplies here. Deliberately no `margin` reset:
// unlayered, it would beat the sheet's layered `margin: auto` and remove the centring under test.
const PREFLIGHT = `<style>*, ::before, ::after { box-sizing: border-box; padding: 0; border-width: 0; }</style>`;

const CALLER_WIDTH = `<style>
  @layer components, utilities;
  @layer utilities { #confirm { max-width: 20rem; } }
</style>`;

const OVERSIZED = Array.from({ length: 40 }, () => "Deleting this project removes every environment attached to it.").join(" ");

function near(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

async function openDialog(page: Page, style: string, body: string, copies = 1): Promise<void> {
  const children = Array.from({ length: copies }, () => Dialog.Body({ children: body }));
  const html = await render(Dialog({ id: "confirm", children }));
  await page.setViewportSize(VIEWPORT);
  await mount(page, `${PREFLIGHT}${style}${html}`, CSS);
  await page.evaluate(() => (document.querySelector("#confirm") as HTMLDialogElement).showModal());
}

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function box(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const rect = (document.querySelector("#confirm") as HTMLElement).getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

test.describe("Dialog — the viewport gutter", () => {
  test("a caller's own max-width in a later layer still leaves the gutter, and stays centred", async ({ page }) => {
    await openDialog(page, CALLER_WIDTH, OVERSIZED);

    const rect = await box(page);

    expect(rect.width, "the caller's max-width did not apply — the fixture proves nothing").toBe(320);
    expect(near(rect.left, VIEWPORT.width - rect.right), `left ${rect.left} vs right ${rect.right} against ${VIEWPORT.width}`).toBe(true);
    expect(rect.left).toBeGreaterThanOrEqual(GUTTER);
    expect(rect.top).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.height - rect.bottom).toBeGreaterThanOrEqual(GUTTER);
  });

  test("with no caller width, oversized content stays inside the gutter on both axes", async ({ page }) => {
    await openDialog(page, "", OVERSIZED, 8);

    const rect = await box(page);

    expect(rect.left, `left ${rect.left} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(rect.top, `top ${rect.top} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.width - rect.right, `right ${rect.right} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.height - rect.bottom, `bottom ${rect.bottom} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);

    expect(rect.width, `width ${rect.width} — the content did not overflow, so nothing was clamped`).toBeGreaterThan(VIEWPORT.width - GUTTER * 3);
    expect(rect.height, `height ${rect.height} — the content did not overflow, so nothing was clamped`).toBeGreaterThan(
      VIEWPORT.height - GUTTER * 3,
    );
  });

  test("content smaller than the viewport is centred rather than pinned to the gutter", async ({ page }) => {
    await openDialog(page, "", "Delete project?");

    const rect = await box(page);

    expect(near(rect.left, VIEWPORT.width - rect.right), `left ${rect.left} vs right ${rect.right}`).toBe(true);
    expect(near(rect.top, VIEWPORT.height - rect.bottom), `top ${rect.top} vs bottom ${rect.bottom}`).toBe(true);
    expect(rect.top, "the dialog is pinned to the top gutter rather than centred").toBeGreaterThan(GUTTER);
  });
});
