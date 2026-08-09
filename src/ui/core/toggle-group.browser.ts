import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { ToggleGroup } from "../controls/toggle-group";
import { Resumable } from "../server/resumable";

/**
 * The pressed *paint* of a `ToggleGroup` item, driven end to end.
 *
 * `bind.browser.ts` already proves the controller moves `data-pressed` and `aria-pressed`. This file
 * asks the question that sits one layer above it and is the one a user notices: does anything on
 * screen actually change? A class chosen at render time cannot, because the controller never touches
 * the class attribute — so the rule under test is compiled from the item's own class rather than
 * hand-written, and a component that went back to a static class would compile to a rule that never
 * moves.
 */

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

/** The class list of the first toggle item, un-escaped back from HTML.
 *
 * `data-slot` is a **token list**, so the token is matched at its own boundaries rather than as the
 * whole attribute value: the moment the element carries a second token an exact-value pattern stops
 * matching and this helper throws its "no class attribute" error, which reads as a mount failure
 * rather than the composition change it actually is. The leading group demands whitespace before the
 * token and the trailing one whitespace after, so `x-toggle-group-item` still misses. */
function itemClasses(html: string): string[] {
  const match = /data-slot="(?:[^"]*\s)?toggle-group-item(?:\s[^"]*)?"[^>]*?class="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error("no class attribute on [data-slot~='toggle-group-item']");
  return match[1].replaceAll("&amp;", "&").split(" ");
}

/** Compile Tailwind's `data-[state]:utility` variant to the rule it generates. */
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

/** Background colour and the keyed attribute together, so the paint can never be asserted apart from
 * the state that is supposed to produce it. */
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
    const cls = itemClasses(html).find((name) => name.endsWith(":bg-primary")) as string;
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
