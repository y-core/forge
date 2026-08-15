import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Dialog } from "./dialog";
import { NumberField } from "./number-field";
import { Slider } from "./slider";
import { Toast } from "./toast";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

test.describe("Slider readout", () => {
  test("tracks the input rather than staying pinned to the SSR value", async ({ page }) => {
    await mount(page, await render(Slider({ id: "s", min: 0, max: 10, value: 4, output: true })), EXPOSE);
    await start(page);

    expect(await page.textContent("[data-slot~='slider-output']")).toBe("4");

    await page.locator("#s").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    expect(await page.textContent("[data-slot~='slider-output']")).toBe("6");
  });

  test("a caller's own input action still wins over the readout's", async ({ page }) => {
    const html = await render(Slider({ id: "s", min: 0, max: 10, value: 4, output: true, "data-on-input": "mine" }));
    await mount(page, html, EXPOSE);

    expect(await page.getAttribute("#s", "data-on-input")).toBe("mine");
  });
});

test.describe("NumberField steppers", () => {
  const field = (props: Record<string, unknown>) =>
    render(
      NumberField({
        children: [NumberField.Decrement({ id: "dec" }), NumberField.Input({ id: "n", value: 3, ...props }), NumberField.Increment({ id: "inc" })],
      }),
    );

  test("are disabled when the input is disabled, so they cannot look live and do nothing", async ({ page }) => {
    await mount(page, await field({ disabled: true }), EXPOSE);
    await start(page);

    expect(
      await page.evaluate(() => [
        (document.querySelector("#dec") as HTMLButtonElement).disabled,
        (document.querySelector("#inc") as HTMLButtonElement).disabled,
      ]),
    ).toEqual([true, true]);
  });

  test("are disabled when the input is read-only", async ({ page }) => {
    await mount(page, await field({ readOnly: true }), EXPOSE);
    await start(page);

    expect(await page.evaluate(() => (document.querySelector("#inc") as HTMLButtonElement).disabled)).toBe(true);
  });

  test("come back when the app re-enables the input", async ({ page }) => {
    await mount(page, await field({ disabled: true }), EXPOSE);
    await start(page);

    await page.evaluate(() => {
      (document.querySelector("#n") as HTMLInputElement).disabled = false;
    });
    await expect.poll(() => page.evaluate(() => (document.querySelector("#inc") as HTMLButtonElement).disabled)).toBe(false);

    await page.click("#inc");
    expect(await page.inputValue("#n")).toBe("4");
  });
});

test.describe("Toast auto-dismiss", () => {
  test("does not drop focus to the body when it removes the toast holding it", async ({ page }) => {
    const html = await render(
      Toast.Container({
        children: [
          Toast({ id: "a", dismissible: true, duration: 150, children: "First" }),
          Toast({ id: "b", dismissible: true, children: "Second" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);
    await start(page);

    await page.locator("#a [data-slot~='toast-close']").focus();
    await expect.poll(() => page.evaluate(() => document.querySelector("#a") !== null)).toBe(false);

    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
    expect(await page.evaluate(() => document.querySelector("#b")?.contains(document.activeElement))).toBe(true);
  });

  test("leaves focus alone when the toast that goes did not hold it", async ({ page }) => {
    const html = await render(
      Toast.Container({
        children: [Toast({ id: "a", duration: 150, children: "First" }), Toast({ id: "b", dismissible: true, children: "Second" })],
      }),
    );
    await mount(page, html, EXPOSE);
    await start(page);

    await page.locator("#b [data-slot~='toast-close']").focus();
    await expect.poll(() => page.evaluate(() => document.querySelector("#a") !== null)).toBe(false);

    expect(await page.evaluate(() => document.querySelector("#b")?.contains(document.activeElement))).toBe(true);
  });
});

test.describe("Dialog modality", () => {
  test("openModal yields a real modal, matching what the trigger opens", async ({ page }) => {
    await mount(page, await render(Dialog({ id: "d", openModal: true, children: "Body" })), EXPOSE);
    await start(page);

    expect(await page.evaluate(() => document.querySelector("#d")?.matches(":modal"))).toBe(true);
  });

  test("open yields a non-modal dialog, which is what the attribute means", async ({ page }) => {
    await mount(page, await render(Dialog({ id: "d", open: true, children: "Body" })), EXPOSE);
    await start(page);

    expect(
      await page.evaluate(() => {
        const dialog = document.querySelector("#d") as HTMLDialogElement;
        return { open: dialog.open, modal: dialog.matches(":modal") };
      }),
    ).toEqual({ open: true, modal: false });
  });

  test("the trigger path opens a modal, so both routes agree", async ({ page }) => {
    const html = `${await render(Dialog.Trigger({ for: "d", children: "Open" }))}${await render(Dialog({ id: "d", children: "Body" }))}`;
    await mount(page, html, EXPOSE);
    await start(page);

    await page.click("[data-slot~='dialog-trigger']");

    expect(await page.evaluate(() => document.querySelector("#d")?.matches(":modal"))).toBe(true);
  });
});
