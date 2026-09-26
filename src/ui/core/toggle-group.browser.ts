import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, paintedHex, renderedClasses } from "../client/browser.fixture";
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

function groupMarkup(pressed: number): Promise<string> {
  return render(
    Resumable({
      name: "demo",
      children: ToggleGroup({
        label: "Alignment",
        children: ["alpha", "beta"].map((value, i) =>
          ToggleGroup.Item({ id: `i${i}`, bind: "choice", value, pressed: i === pressed, children: value }),
        ),
      }),
    }),
  );
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

async function paintState(page: Page): Promise<Array<{ background: string; checked: boolean }>> {
  const items = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => ({
      background: getComputedStyle(el).backgroundColor,
      checked: el.querySelector<HTMLInputElement>("[data-slot~='toggle-group-input']")?.checked === true,
    })),
  );
  return Promise.all(items.map(async (item) => ({ ...item, background: await paintedHex(page, item.background) })));
}

test.describe("ToggleGroup — the pressed paint follows the click", () => {
  test("clicking an item moves the painted state onto it", async ({ page }) => {
    const html = await groupMarkup(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mount(page, html, EXPOSE);
    await install(page, await compiledCss(renderedClasses(html)));
    const pressed = await paintedHex(page, "var(--primary)");

    const before = await paintState(page);
    expect(before[0]).toEqual({ background: pressed, checked: true });
    expect(before[1]?.background).not.toBe(pressed);

    await page.click("label:has(#i1)");

    const after = await paintState(page);
    expect(after[1]).toEqual({ background: pressed, checked: true });
    expect(after[0]?.background).not.toBe(pressed);
  });

  test("the paint needs no script at all: a server-checked item is already painted", async ({ page }) => {
    const html = await groupMarkup(1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mount(page, html);
    await page.addStyleTag({ content: await compiledCss(renderedClasses(html)) });
    const pressed = await paintedHex(page, "var(--primary)");

    const state = await paintState(page);
    expect(state[1]).toEqual({ background: pressed, checked: true });
    expect(state[0]?.background).not.toBe(pressed);
  });
});

async function itemEdges(page: Page, orientation: "horizontal" | "vertical"): Promise<Array<{ corners: boolean[]; top: boolean; start: boolean }>> {
  const html = await render(
    ToggleGroup({
      label: "Alignment",
      orientation,
      children: ["alpha", "beta", "gamma"].map((value) => ToggleGroup.Item({ bind: "align", value, children: value })),
    }),
  );
  await mount(page, html);
  await page.addStyleTag({ content: await compiledCss(renderedClasses(html)) });

  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => {
      const s = getComputedStyle(el);
      const round = (radius: string) => parseFloat(radius) > 0;
      return {
        corners: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(round),
        top: parseFloat(s.borderTopWidth) > 0,
        start: parseFloat(s.borderLeftWidth) > 0,
      };
    }),
  );
}

test.describe("ToggleGroup — a vertical group joins its items top to bottom", () => {
  test("rounds only the outer corners of the column and draws one rule between items", async ({ page }) => {
    expect(await itemEdges(page, "vertical")).toEqual([
      { corners: [true, true, false, false], top: true, start: true },
      { corners: [false, false, false, false], top: false, start: true },
      { corners: [false, false, true, true], top: false, start: true },
    ]);
  });
});

test.describe("ToggleGroup — a horizontal group joins its items start to end", () => {
  test("rounds only the outer corners of the row and draws one rule between items", async ({ page }) => {
    expect(await itemEdges(page, "horizontal")).toEqual([
      { corners: [true, false, false, true], top: true, start: true },
      { corners: [false, false, false, false], top: true, start: false },
      { corners: [false, true, true, false], top: true, start: false },
    ]);
  });
});
