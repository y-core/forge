import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { classesOf, escapeClass, mount } from "../client/browser-test-helper";
import { ToggleGroup } from "../controls/toggle-group";
import { Resumable } from "../server/resumable";

declare global {
  interface Window {
    forgeBind: typeof import("../client/bind");
    forgeResume: typeof import("../client/resume");
    forgeSignals: typeof import("../client/signal-record");
  }
}

const EXPOSE = { expose: { forgeBind: "./ui/client/bind", forgeResume: "./ui/client/resume", forgeSignals: "./ui/client/signal-record" } };

const PRESSED_PAINT = "rgb(0, 0, 255)";

function groupMarkup(pressed: number): Promise<string> {
  return render(
    Resumable({
      name: "demo",
      children: ToggleGroup({
        children: ["alpha", "beta"].map((value, i) =>
          ToggleGroup.Item({ id: `i${i}`, bind: "choice", value, pressed: i === pressed, children: value }),
        ),
      }),
    }),
  );
}

// The paint hangs off the input's own `:checked`, so the compiled rule has to be a `:has()` one —
// which is the whole point: no controller writes the state the stylesheet reads.
function compileHasVariant(cls: string, declaration: string): string {
  return `.${escapeClass(cls)}:has(:checked) { ${declaration} }`;
}

async function install(page: Page, css: string): Promise<void> {
  await page.evaluate((rule) => {
    const style = document.createElement("style");
    style.textContent = rule;
    document.head.append(style);

    const signals = window.forgeSignals.signalRecord({ choice: "alpha" });
    window.forgeResume.registerScope("demo", { eager: true, setup: ({ root }) => window.forgeBind.bindControls(root, signals) });
    window.forgeResume.resume();
  }, css);
}

function paintState(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => ({
      background: getComputedStyle(el).backgroundColor,
      checked: el.querySelector<HTMLInputElement>("[data-slot~='toggle-group-input']")?.checked === true,
    })),
  );
}

test.describe("ToggleGroup — the pressed paint follows the click", () => {
  test("clicking an item moves the painted state onto it", async ({ page }) => {
    const html = await groupMarkup(0);
    await mount(page, html, EXPOSE);
    const cls = classesOf(html, "toggle-group-item").find((name) => name.endsWith(":bg-primary")) as string;
    await install(page, compileHasVariant(cls, `background-color: ${PRESSED_PAINT}`));

    const before = await paintState(page);
    expect(before[0]).toEqual({ background: PRESSED_PAINT, checked: true });
    expect(before[1]?.background).not.toBe(PRESSED_PAINT);

    await page.click("label:has(#i1)");

    const after = await paintState(page);
    expect(after[1]).toEqual({ background: PRESSED_PAINT, checked: true });
    expect(after[0]?.background).not.toBe(PRESSED_PAINT);
  });

  test("the paint needs no script at all: a server-checked item is already painted", async ({ page }) => {
    const html = await groupMarkup(1);
    await mount(page, html);
    const cls = classesOf(html, "toggle-group-item").find((name) => name.endsWith(":bg-primary")) as string;
    await page.addStyleTag({ content: compileHasVariant(cls, `background-color: ${PRESSED_PAINT}`) });

    const state = await paintState(page);
    expect(state[1]).toEqual({ background: PRESSED_PAINT, checked: true });
    expect(state[0]?.background).not.toBe(PRESSED_PAINT);
  });
});
