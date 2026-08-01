import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { NumberField } from "./number-field";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
    inputEvents: number;
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

function markup(): Promise<string> {
  return render(
    NumberField({
      children: [
        NumberField.Decrement({ id: "dec" }),
        NumberField.Input({ id: "count", name: "count", value: "5", min: "0", max: "7", step: "1" }),
        NumberField.Increment({ id: "inc" }),
      ],
    }),
  );
}

/** Count real `input` events, because "the input stays authoritative" is only true if listeners see
 * a stepped value exactly as they see a typed one. */
async function start(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.inputEvents = 0;
    document.querySelector("#count")?.addEventListener("input", () => {
      window.inputEvents += 1;
    });
    window.forgeResume.resume();
  });
}

function value(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.querySelector<HTMLInputElement>("#count")?.value);
}

test("steps the input's own value and fires a real input event", async ({ page }) => {
  await mount(page, await markup(), EXPOSE);
  await start(page);

  await page.click("#inc");

  expect(await value(page)).toBe("6");
  expect(await page.evaluate(() => window.inputEvents)).toBe(1);
});

test("decrements the same way", async ({ page }) => {
  await mount(page, await markup(), EXPOSE);
  await start(page);

  await page.click("#dec");

  expect(await value(page)).toBe("4");
});

test("clamps to max and min, because stepUp and stepDown already do", async ({ page }) => {
  await mount(page, await markup(), EXPOSE);
  await start(page);

  for (let i = 0; i < 5; i += 1) await page.click("#inc");
  expect(await value(page)).toBe("7");

  for (let i = 0; i < 10; i += 1) await page.click("#dec");
  expect(await value(page)).toBe("0");
});

test("the native arrow keys still step it, with no buttons involved", async ({ page }) => {
  await mount(page, await markup(), EXPOSE);
  await start(page);

  await page.focus("#count");
  await page.keyboard.press("ArrowUp");

  expect(await value(page)).toBe("6");
});

test("a disabled input is not stepped by the buttons", async ({ page }) => {
  await mount(page, await markup(), EXPOSE);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>("#count");
    if (el) el.disabled = true;
  });
  await start(page);

  await page.click("#inc");

  expect(await value(page)).toBe("5");
});

test("the buttons are optional: the input alone is a working number field", async ({ page }) => {
  await mount(page, await render(NumberField({ children: NumberField.Input({ id: "count", value: "5" }) })), EXPOSE);
  await start(page);

  await page.focus("#count");
  await page.keyboard.press("ArrowUp");

  expect(await value(page)).toBe("6");
});
