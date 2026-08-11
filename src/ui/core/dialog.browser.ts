import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Dialog } from "./dialog";

/**
 * `Dialog` after render, which is the only place its defect was visible.
 *
 * The component stamps `data-open` / `data-closed` from its `open` prop, and until the `dialog`
 * scope existed that was the last time either attribute moved: the platform opened the dialog, put
 * it in the top layer, trapped focus and drew a backdrop, and the styling hook still said
 * `data-closed`. Every case here therefore *opens or closes something* and then re-reads the DOM —
 * a render-time assertion passes against the bug.
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

/** Trigger + dialog + a close button, all linked by one id. */
function markup(open = false): Promise<string> {
  return render([
    Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete…" }),
    Dialog({ id: "confirm", ...(open ? { open } : {}), children: Dialog.Close({ for: "confirm", id: "close-it", children: "Cancel" }) }),
  ]);
}

function state(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("#confirm");
    return {
      nativeOpen: dialog?.open,
      open: dialog?.hasAttribute("data-open"),
      closed: dialog?.hasAttribute("data-closed"),
      triggerLit: document.querySelector("#open-it")?.hasAttribute("data-popup-open"),
    };
  });
}

test.describe("Dialog", () => {
  test("starts closed, with the trigger unlit", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("the trigger opens it and both the dialog and the trigger publish it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true, open: true, closed: false, triggerLit: true });
  });

  test("closing flips the dialog's pair and unlights the trigger", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.click("#close-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("Escape closes it, and the state attributes follow the platform's own cancel", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).open).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false, open: false, closed: true, triggerLit: false });
  });

  test("a Close button is not mistaken for a trigger", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).open).toBe(true);

    // `Dialog.Close` names the same `commandfor` target, so a bare `[commandfor]` lookup would light
    // it up as if it opened the dialog. `data-popup-open` means "this opens the thing that is open".
    expect(await page.evaluate(() => document.querySelector("#close-it")?.hasAttribute("data-popup-open"))).toBe(false);
  });

  test("a server-rendered open dialog is already correct when the scope resumes", async ({ page }) => {
    await mount(page, await markup(true), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: true, open: true, closed: false, triggerLit: true });
  });
});

/**
 * **The viewport gutter, measured.**
 *
 * The only cases here that load a stylesheet, and the only ones that assert a box. The gutter is
 * authored CSS rather than a utility class precisely so it survives a caller's own width, and the
 * failure it guards against — a dialog flush against the viewport edge — is invisible to any
 * assertion made on the emitted markup.
 *
 * No Tailwind build runs under the harness, so nothing in a `class` resolves and every size below
 * comes from content or from the fixture's own `<style>`.
 */

/** `forge-ui.css` only — the gutter is `[data-slot~="dialog"] { inset: 1rem; margin: auto }`
 * and lives there. The one token the dialog block names is `--overlay`, on `::backdrop`, and no case
 * here reads a colour, so the token sheets would resolve nothing this measures. */
const CSS = { css: ["./ui/assets/css/forge-ui.css"] };

const VIEWPORT = { width: 1280, height: 720 };
const GUTTER = 16; // 1rem, the inset the sheet gives every modal dialog

/**
 * What Tailwind's preflight would have supplied, since no build runs here: border-box sizing and no
 * UA padding or border on the `<dialog>`. Without it the UA's own `padding: 1em` and `border: solid`
 * sit inside a content-box measurement and every width below reads several pixels wide — a fixture
 * artefact that has nothing to do with the placement under test.
 *
 * Deliberately no `margin` reset: unlayered, it would beat the sheet's layered `margin: auto` and
 * silently remove the centring these cases exist to measure.
 */
const PREFLIGHT = `<style>*, ::before, ::after { box-sizing: border-box; padding: 0; border-width: 0; }</style>`;

/**
 * A caller's own width, in a cascade layer declared *after* the sheet's — a `max-w-sm` as a real
 * Tailwind build emits it. The bare `@layer` statement fixes the order from this stylesheet, which
 * the harness injects before the sheet, so the caller's rule wins regardless of arrival order.
 */
const CALLER_WIDTH = `<style>
  @layer components, utilities;
  @layer utilities { #confirm { max-width: 20rem; } }
</style>`;

/** One paragraph far wider than the viewport before it wraps. */
const OVERSIZED = Array.from({ length: 40 }, () => "Deleting this project removes every environment attached to it.").join(" ");

/** Sub-pixel centring is not what any of these cases is about. */
function near(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** `copies` stacks the paragraph to overflow the viewport's *height* as well as its width. */
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
    // The regression `inset` exists to survive. A `max-width` default would have been replaced
    // outright by this rule, taking the gutter with it; `inset` is a different property, so the
    // caller's width lands *inside* the already-inset containing block.
    await openDialog(page, CALLER_WIDTH, OVERSIZED);

    const rect = await box(page);

    expect(rect.width, "the caller's max-width did not apply — the fixture proves nothing").toBe(320);
    expect(near(rect.left, VIEWPORT.width - rect.right), `left ${rect.left} vs right ${rect.right} against ${VIEWPORT.width}`).toBe(true);
    expect(rect.left).toBeGreaterThanOrEqual(GUTTER);
    expect(rect.top).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.height - rect.bottom).toBeGreaterThanOrEqual(GUTTER);
  });

  test("with no caller width, oversized content stays inside the gutter on both axes", async ({ page }) => {
    // The clamp the deleted `max-width`/`max-height` pair used to provide, now falling out of the
    // inset alone. Bounds rather than an exact box: the UA's own `dialog:modal` maxima sit a few
    // pixels further in again, and which of the two binds last is not what this case is about.
    await openDialog(page, "", OVERSIZED, 8);

    const rect = await box(page);

    expect(rect.left, `left ${rect.left} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(rect.top, `top ${rect.top} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.width - rect.right, `right ${rect.right} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.height - rect.bottom, `bottom ${rect.bottom} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);

    // …and it really did fill the inset box, rather than passing by being small on either axis.
    expect(rect.width, `width ${rect.width} — the content did not overflow, so nothing was clamped`).toBeGreaterThan(VIEWPORT.width - GUTTER * 3);
    expect(rect.height, `height ${rect.height} — the content did not overflow, so nothing was clamped`).toBeGreaterThan(
      VIEWPORT.height - GUTTER * 3,
    );
  });

  test("content smaller than the viewport is centred rather than pinned to the gutter", async ({ page }) => {
    // `margin: auto` against the inset containing block. Without it the dialog would sit at the
    // top-left inset corner and every assertion above would still pass.
    await openDialog(page, "", "Delete project?");

    const rect = await box(page);

    expect(near(rect.left, VIEWPORT.width - rect.right), `left ${rect.left} vs right ${rect.right}`).toBe(true);
    expect(near(rect.top, VIEWPORT.height - rect.bottom), `top ${rect.top} vs bottom ${rect.bottom}`).toBe(true);
    expect(rect.top, "the dialog is pinned to the top gutter rather than centred").toBeGreaterThan(GUTTER);
  });
});
