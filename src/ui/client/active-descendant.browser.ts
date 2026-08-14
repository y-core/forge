import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeAd: typeof import("./active-descendant");
    activated: string[];
  }
}

const EXPOSE = { expose: { forgeAd: "./ui/client/active-descendant" } };

const MARKUP = `
  <div id="box">
    <input id="q" type="text" role="combobox" aria-expanded="true" aria-controls="list" />
    <div id="list" role="listbox">
      <div role="option" data-name="alpha">Alpha</div>
      <div role="option" data-name="beta">Beta</div>
      <div role="option" data-name="gamma">Gamma</div>
    </div>
  </div>`;

async function start(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.activated = [];
    const root = document.getElementById("box") as HTMLElement;
    const input = document.getElementById("q") as HTMLElement;
    window.forgeAd.mountActiveDescendant(root, {
      input,
      items: "[role='option']",
      onActivate: (item) => window.activated.push(item.getAttribute("data-name") ?? ""),
    });
    window.forgeAd.resetActiveDescendant(root, input, "[role='option']");
    input.focus();
  });
}

function state(page: Page) {
  return page.evaluate(() => {
    const options = [...document.querySelectorAll<HTMLElement>("[role='option']")];
    const input = document.getElementById("q") as HTMLElement;
    const active = options.find((o) => o.getAttribute("aria-selected") === "true");
    return {
      selected: options.map((o) => o.getAttribute("aria-selected")),
      activeName: active?.getAttribute("data-name") ?? null,
      pointsAtActive: input.getAttribute("aria-activedescendant") === (active?.id ?? null),
      focusIsInput: document.activeElement?.id === "q",
    };
  });
}

test.describe("mountActiveDescendant", () => {
  test("starts on the first option and keeps focus in the field", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    const s = await state(page);
    expect(s.activeName).toBe("alpha");
    expect(s.pointsAtActive).toBe(true);
    expect(s.focusIsInput).toBe(true);
  });

  test("moves the active option with the arrows and wraps in both directions", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.keyboard.press("ArrowDown");
    expect((await state(page)).activeName).toBe("beta");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect((await state(page)).activeName, "ArrowDown did not wrap to the first option").toBe("alpha");

    await page.keyboard.press("ArrowUp");
    expect((await state(page)).activeName, "ArrowUp did not wrap to the last option").toBe("gamma");
  });

  test("never takes focus out of the field, which is what makes it a combobox", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "Home", "End"]) await page.keyboard.press(key);

    expect((await state(page)).focusIsInput, "the controller moved real focus out of the text field").toBe(true);
  });

  test("leaves the caret keys to the caret", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.fill("#q", "abc");
    await page.keyboard.press("ArrowLeft");
    expect(await page.evaluate(() => (document.getElementById("q") as HTMLInputElement).selectionStart)).toBe(2);
  });

  test("Home and End jump to the ends", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.keyboard.press("End");
    expect((await state(page)).activeName).toBe("gamma");
    await page.keyboard.press("Home");
    expect((await state(page)).activeName).toBe("alpha");
  });

  test("Enter commits the active option, and exactly one option is ever active", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.keyboard.press("ArrowDown");
    expect((await state(page)).selected, "more than one option claimed to be selected").toEqual(["false", "true", "false"]);

    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.activated)).toEqual(["beta"]);
  });

  test("claims no key at all when there are no options", async ({ page }) => {
    await mount(page, `<div id="box"><input id="q" type="text" /><div id="list" role="listbox"></div></div>`, EXPOSE);
    await start(page);

    const prevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      document.getElementById("q")?.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented, "Enter was consumed by a combobox with nothing to commit").toBe(false);
    expect(await page.evaluate(() => window.activated)).toEqual([]);
  });

  test("resets to the first option rather than clamping when the list is replaced", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.keyboard.press("End");
    expect((await state(page)).activeName).toBe("gamma");

    await page.evaluate(() => {
      const list = document.getElementById("list") as HTMLElement;
      list.innerHTML = `<div role="option" data-name="delta">Delta</div><div role="option" data-name="epsilon">Epsilon</div>`;
      window.forgeAd.resetActiveDescendant(
        document.getElementById("box") as HTMLElement,
        document.getElementById("q") as HTMLElement,
        "[role='option']",
      );
    });

    const s = await state(page);
    expect(s.activeName).toBe("delta");
    expect(s.pointsAtActive).toBe(true);
  });

  test("navigates a rebuilt list without being re-mounted", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.evaluate(() => {
      const list = document.getElementById("list") as HTMLElement;
      list.innerHTML = `<div role="option" data-name="one">One</div><div role="option" data-name="two">Two</div>`;
    });

    // The replacement carried no active option, so the ring starts from the first rather than
    // reusing the old index.
    await page.keyboard.press("ArrowDown");
    expect((await state(page)).activeName).toBe("one");

    await page.keyboard.press("ArrowDown");
    expect((await state(page)).activeName).toBe("two");
  });

  test("the pointer and the keyboard agree on which option is current", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await start(page);

    await page.locator("[data-name='gamma']").hover();
    expect((await state(page)).activeName).toBe("gamma");

    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.activated)).toEqual(["gamma"]);
  });

  test("the disposer clears the field's pointer", async ({ page }) => {
    await mount(page, MARKUP, EXPOSE);
    await page.evaluate(() => {
      const root = document.getElementById("box") as HTMLElement;
      const input = document.getElementById("q") as HTMLElement;
      const dispose = window.forgeAd.mountActiveDescendant(root, { input, items: "[role='option']" });
      window.forgeAd.resetActiveDescendant(root, input, "[role='option']");
      dispose();
    });

    expect(await page.evaluate(() => document.getElementById("q")?.hasAttribute("aria-activedescendant"))).toBe(false);
  });
});
