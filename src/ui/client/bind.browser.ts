import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { ToggleGroup } from "../controls/toggle-group";
import { Resumable } from "../server/resumable";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeBind: typeof import("./bind");
    forgeResume: typeof import("./resume");
    forgeSignals: typeof import("./signal-record");
    lastValue?: unknown;
  }
}

const EXPOSE = { expose: { forgeBind: "./ui/client/bind", forgeResume: "./ui/client/resume", forgeSignals: "./ui/client/signal-record" } };

/** The real bound group: `controls/ToggleGroup` inside a `Resumable` scope. */
function groupMarkup(type: "single" | "multiple", pressed: number[] = []): Promise<string> {
  return render(
    Resumable({
      name: "demo",
      children: ToggleGroup({
        type,
        children: ["alpha", "beta", "gamma"].map((value, i) =>
          ToggleGroup.Item({ id: `i${i}`, bind: "choice", value, pressed: pressed.includes(i), children: value }),
        ),
      }),
    }),
  );
}

/** Register the scope with `bindGroup` and nothing else, then start the runtime. */
async function install(page: Page, initial: unknown): Promise<void> {
  await page.evaluate((seed) => {
    const signals = window.forgeSignals.signalRecord({ choice: seed });
    window.forgeResume.registerScope("demo", { on: { bindGroup: window.forgeBind.bindGroup(signals) } });
    window.forgeResume.resume();
    window.forgeResume.effect(() => {
      window.lastValue = signals.choice.value;
    });
  }, initial);
}

/** `aria-pressed` and `data-pressed` for every item, so the two are checked in lockstep. */
function pressedState(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => ({
      aria: el.getAttribute("aria-pressed"),
      data: el.hasAttribute("data-pressed"),
    })),
  );
}

test.describe("bindGroup — single selection", () => {
  test("a click presses the clicked item and clears the previously pressed one", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await install(page, "alpha");

    await page.click("#i2");

    expect(await pressedState(page)).toEqual([
      { aria: "false", data: false },
      { aria: "false", data: false },
      { aria: "true", data: true },
    ]);
  });

  test("writes the clicked item's value into the signal", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await install(page, "alpha");

    await page.click("#i1");

    expect(await page.evaluate(() => window.lastValue)).toBe("beta");
  });

  test("keeps aria-pressed and data-pressed in agreement on every item", async ({ page }) => {
    await mount(page, await groupMarkup("single", [1]), EXPOSE);
    await install(page, "beta");

    await page.click("#i0");
    const state = await pressedState(page);

    expect(state.every((item) => (item.aria === "true") === item.data)).toBe(true);
  });

  test("a click on an inner child still resolves the item", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await page.evaluate(() => {
      const inner = document.createElement("span");
      inner.id = "inner";
      inner.textContent = "x";
      document.querySelector("#i2")?.append(inner);
    });
    await install(page, "alpha");

    await page.click("#inner");

    expect(await page.evaluate(() => window.lastValue)).toBe("gamma");
  });
});

test.describe("bindGroup — multiple selection", () => {
  test("toggles only the clicked item and leaves its siblings alone", async ({ page }) => {
    await mount(page, await groupMarkup("multiple", [0]), EXPOSE);
    await install(page, ["alpha"]);

    await page.click("#i2");

    expect(await pressedState(page)).toEqual([
      { aria: "true", data: true },
      { aria: "false", data: false },
      { aria: "true", data: true },
    ]);
  });

  test("un-presses an item that was already pressed", async ({ page }) => {
    await mount(page, await groupMarkup("multiple", [0, 1]), EXPOSE);
    await install(page, ["alpha", "beta"]);

    await page.click("#i0");

    expect(await page.evaluate(() => window.lastValue)).toEqual(["beta"]);
  });

  test("writes the full set of pressed values", async ({ page }) => {
    await mount(page, await groupMarkup("multiple", []), EXPOSE);
    await install(page, []);

    await page.click("#i0");
    await page.click("#i2");

    expect(await page.evaluate(() => window.lastValue)).toEqual(["alpha", "gamma"]);
  });
});

test.describe("bindGroup — scoping", () => {
  test("two groups in one scope reconcile independently", async ({ page }) => {
    const two = await render(
      Resumable({
        name: "demo",
        children: [
          ToggleGroup({
            children: ["a1", "a2"].map((value, i) => ToggleGroup.Item({ id: `a${i}`, bind: "choice", value, pressed: i === 0, children: value })),
          }),
          ToggleGroup({
            children: ["b1", "b2"].map((value, i) => ToggleGroup.Item({ id: `b${i}`, bind: "choice", value, pressed: i === 0, children: value })),
          }),
        ],
      }),
    );
    await mount(page, two, EXPOSE);
    await install(page, "a1");

    await page.click("#a1");

    const pressedIds = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-pressed]")].map((el) => el.id).sort());
    expect(pressedIds).toEqual(["a1", "b0"]);
  });

  test("ignores a click that resolves no bound item", async ({ page }) => {
    await mount(page, `${await groupMarkup("single", [0])}<button id="outside" data-on-click="bindGroup">x</button>`, EXPOSE);
    await install(page, "alpha");

    await page.click("#outside");

    expect(await page.evaluate(() => window.lastValue)).toBe("alpha");
  });

  test("ignores a field the signal record does not declare", async ({ page }) => {
    const html = await render(
      Resumable({ name: "demo", children: ToggleGroup({ children: ToggleGroup.Item({ id: "i0", bind: "unknown", value: "x", children: "x" }) }) }),
    );
    await mount(page, html, EXPOSE);
    await install(page, "alpha");

    await page.click("#i0");

    expect(await page.evaluate(() => window.lastValue)).toBe("alpha");
  });
});
