import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { classesOf, mount } from "../client/browser-test-helper";
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

function compileDataVariant(cls: string, declaration: string): string {
  const state = cls.slice(cls.indexOf("[") + 1, cls.indexOf("]"));
  const escaped = cls.replace(/[[\]:]/g, (ch) => `\\${ch}`);
  return `.${escaped}[data-${state}] { ${declaration} }`;
}

async function install(page: Page, css: string): Promise<void> {
  await page.evaluate((rule) => {
    const style = document.createElement("style");
    style.textContent = rule;
    document.head.append(style);

    const signals = window.forgeSignals.signalRecord({ choice: "alpha" });
    window.forgeResume.registerScope("demo", { on: { bindGroup: window.forgeBind.bindGroup(signals) } });
    window.forgeResume.resume();
  }, css);
}

function paintState(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => ({
      background: getComputedStyle(el).backgroundColor,
      pressed: el.hasAttribute("data-pressed"),
    })),
  );
}

test.describe("ToggleGroup — the pressed paint follows the click", () => {
  test("clicking an item moves the painted state onto it", async ({ page }) => {
    const html = await groupMarkup(0);
    await mount(page, html, EXPOSE);
    const cls = classesOf(html, "toggle-group-item").find((name) => name.endsWith(":bg-primary")) as string;
    await install(page, compileDataVariant(cls, `background-color: ${PRESSED_PAINT}`));

    const before = await paintState(page);
    expect(before[0]).toEqual({ background: PRESSED_PAINT, pressed: true });
    expect(before[1]?.background).not.toBe(PRESSED_PAINT);

    await page.click("#i1");

    const after = await paintState(page);
    expect(after[1]).toEqual({ background: PRESSED_PAINT, pressed: true });
    expect(after[0]?.background).not.toBe(PRESSED_PAINT);
  });
});
