import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { ToggleGroup } from "../controls/toggle-group";
import { Resumable } from "../server/resumable";
import { mount } from "./browser-test-helper";

declare global {
  interface Window {
    forgeBind: typeof import("./bind");
    forgeResume: typeof import("./resume");
    forgeSignal: typeof import("./signal");
    forgeSignals: typeof import("./signal-record");
    demoSignals: import("./signal-record").SignalRecord<{ choice: unknown }>;
    lastValue?: unknown;
  }
}

const EXPOSE = {
  expose: {
    forgeBind: "./ui/client/bind",
    forgeResume: "./ui/client/resume",
    forgeSignal: "./ui/client/signal",
    forgeSignals: "./ui/client/signal-record",
  },
};

/** The real bound group: `controls/ToggleGroup` inside a `Resumable` scope. */
function groupMarkup(type: "single" | "multiple", pressed: number[] = []): Promise<string> {
  return render(
    Resumable({
      name: "demo",
      children: ToggleGroup({
        type,
        children: ["alpha", "beta", "gamma"].map((value, i) =>
          ToggleGroup.Item({ id: `i${i}`, bind: "choice", type, value, pressed: pressed.includes(i), children: value }),
        ),
      }),
    }),
  );
}

/** An eager scope whose whole setup is `bindControls`, then start the runtime. */
async function install(page: Page, initial: unknown): Promise<void> {
  await page.evaluate((seed) => {
    const signals = window.forgeSignals.signalRecord({ choice: seed });
    window.demoSignals = signals;
    window.forgeResume.registerScope("demo", { eager: true, setup: ({ root }) => window.forgeBind.bindControls(root, signals) });
    window.forgeResume.resume();
    window.forgeSignal.effect(() => {
      window.lastValue = signals.choice.value;
    });
  }, initial);
}

/** Whether each item's own input is checked — the state a native group actually carries. */
function pressedState(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>("[data-slot~='toggle-group-input']")].map((el) => el.checked));
}

/** `aria-pressed` and `data-pressed`, for the button surrogates the repaint test builds by hand. */
function surrogateState(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => ({
      aria: el.getAttribute("aria-pressed"),
      data: el.hasAttribute("data-pressed"),
    })),
  );
}

/** Clicks an item by its label: the input itself is `sr-only`, so it is the label a user hits. */
function clickItem(page: Page, index: number): Promise<void> {
  return page.click(`label:has(#i${index})`);
}

/** Moves the rendered group into a chain of `depth` open shadow roots hung under the scope root. */
async function intoShadow(page: Page, depth = 1): Promise<void> {
  await page.evaluate((levels) => {
    const group = document.querySelector("[data-slot~='toggle-group']") as HTMLElement;
    let parent: ParentNode = document.querySelector("[data-scope]") as HTMLElement;
    for (let i = 0; i < levels; i += 1) {
      const host = document.createElement("div");
      host.className = "host";
      parent.append(host);
      parent = host.attachShadow({ mode: "open" });
    }
    parent.append(group);
  }, depth);
}

/** `pressedState`, read through however many open shadow roots the fixture nested the group behind. */
function shadowPressedState(page: Page) {
  return page.evaluate(() => {
    let tree: ParentNode = document;
    for (let host = tree.querySelector<HTMLElement>(".host"); host?.shadowRoot; host = tree.querySelector<HTMLElement>(".host")) {
      tree = host.shadowRoot;
    }
    return [...tree.querySelectorAll<HTMLInputElement>("[data-slot~='toggle-group-input']")].map((el) => el.checked);
  });
}

/** Clicks an element that the shadow chain hides from `page.click`'s own retargeting. */
async function clickInShadow(page: Page, selector: string): Promise<void> {
  await page.evaluate((target) => {
    let tree: ParentNode = document;
    for (let host = tree.querySelector<HTMLElement>(".host"); host?.shadowRoot; host = tree.querySelector<HTMLElement>(".host")) {
      tree = host.shadowRoot;
    }
    tree.querySelector<HTMLElement>(target)?.click();
  }, selector);
}

test.describe("bindControls, on a button group — single selection", () => {
  test("a click presses the clicked item and clears the previously pressed one", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await install(page, "alpha");

    await clickItem(page, 2);

    expect(await pressedState(page)).toEqual([false, false, true]);
  });

  test("writes the clicked item's value into the signal", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await install(page, "alpha");

    await clickItem(page, 1);

    expect(await page.evaluate(() => window.lastValue)).toBe("beta");
  });

  test("leaves exactly one item checked, the one the signal names", async ({ page }) => {
    await mount(page, await groupMarkup("single", [1]), EXPOSE);
    await install(page, "beta");

    await clickItem(page, 0);

    expect(await pressedState(page)).toEqual([true, false, false]);
    expect(await page.evaluate(() => window.lastValue)).toBe("alpha");
  });

  test("a click on an inner child still resolves the item", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await page.evaluate(() => {
      const inner = document.createElement("span");
      inner.id = "inner";
      inner.textContent = "x";
      document.querySelector("#i2")?.closest("label")?.append(inner);
    });
    await install(page, "alpha");

    await page.click("#inner");

    expect(await page.evaluate(() => window.lastValue)).toBe("gamma");
  });
});

test.describe("bindControls, on a button group — multiple selection", () => {
  test("toggles only the clicked item and leaves its siblings alone", async ({ page }) => {
    await mount(page, await groupMarkup("multiple", [0]), EXPOSE);
    await install(page, ["alpha"]);

    await clickItem(page, 2);

    expect(await pressedState(page)).toEqual([true, false, true]);
  });

  test("un-presses an item that was already pressed", async ({ page }) => {
    await mount(page, await groupMarkup("multiple", [0, 1]), EXPOSE);
    await install(page, ["alpha", "beta"]);

    await clickItem(page, 0);

    expect(await page.evaluate(() => window.lastValue)).toEqual(["beta"]);
  });

  test("writes the full set of pressed values", async ({ page }) => {
    await mount(page, await groupMarkup("multiple", []), EXPOSE);
    await install(page, []);

    await clickItem(page, 0);
    await clickItem(page, 2);

    expect(await page.evaluate(() => window.lastValue)).toEqual(["alpha", "gamma"]);
  });
});

test.describe("bindControls, on a button group — scoping", () => {
  // Two groups over one field are two *views* of one value, so they cannot disagree. Under the old
  // design pressed state lived in the DOM, so each group kept its own answer and they could.
  test("two groups bound to one field stay in lockstep", async ({ page }) => {
    const two = await render(
      Resumable({
        name: "demo",
        children: [
          ToggleGroup({
            children: ["a1", "a2"].map((value, i) => ToggleGroup.Item({ id: `a${i}`, bind: "choice", value, pressed: i === 0, children: value })),
          }),
          // A distinct `name` over the same `bind`: two *views* of one field, which native radios
          // would otherwise collapse into a single group where only one item can be checked at all.
          ToggleGroup({
            children: ["a1", "a2"].map((value, i) =>
              ToggleGroup.Item({ id: `b${i}`, bind: "choice", name: "choice-b", value, pressed: i === 0, children: value }),
            ),
          }),
        ],
      }),
    );
    await mount(page, two, EXPOSE);
    await install(page, "a1");

    await page.click("label:has(#a1)");

    const pressedIds = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot~='toggle-group-input']")]
        .filter((el) => el.checked)
        .map((el) => el.id)
        .sort(),
    );
    expect(pressedIds, "the second group kept a stale answer of its own").toEqual(["a1", "b1"]);
    expect(await page.evaluate(() => window.lastValue)).toBe("a2");
  });

  test("two groups bound to different fields move independently", async ({ page }) => {
    const two = await render(
      Resumable({
        name: "demo",
        children: [
          ToggleGroup({
            children: ["a1", "a2"].map((value, i) => ToggleGroup.Item({ id: `a${i}`, bind: "choice", value, pressed: i === 0, children: value })),
          }),
          ToggleGroup({
            children: ["b1", "b2"].map((value, i) => ToggleGroup.Item({ id: `b${i}`, bind: "other", value, pressed: i === 0, children: value })),
          }),
        ],
      }),
    );
    await mount(page, two, EXPOSE);
    await page.evaluate(() => {
      const signals = window.forgeSignals.signalRecord({ choice: "a1", other: "b1" });
      window.forgeResume.registerScope("demo", { eager: true, setup: ({ root }) => window.forgeBind.bindControls(root, signals) });
      window.forgeResume.resume();
    });

    await page.click("label:has(#a1)");

    const pressedIds = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot~='toggle-group-input']")]
        .filter((el) => el.checked)
        .map((el) => el.id)
        .sort(),
    );
    expect(pressedIds, "moving `choice` disturbed the group bound to `other`").toEqual(["a1", "b0"]);
  });

  test("ignores a click that resolves no bound item", async ({ page }) => {
    await mount(page, `${await groupMarkup("single", [0])}<button id="outside">x</button>`, EXPOSE);
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

    await clickItem(page, 0);

    expect(await page.evaluate(() => window.lastValue)).toBe("alpha");
  });
});

test.describe("bindControls — realm and shadow safety", () => {
  test("binds a control that lives inside an open shadow root", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await intoShadow(page);
    await install(page, "alpha");

    await clickInShadow(page, "#i2");

    expect(await page.evaluate(() => window.lastValue), "the retargeted event resolved to the host, not the item").toBe("gamma");
  });

  test("repaints a control inside an open shadow root", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await intoShadow(page);
    await install(page, "alpha");

    await clickInShadow(page, "#i2");

    expect(await shadowPressedState(page)).toEqual([false, false, true]);
  });

  test("repaints a control nested two shadow roots deep", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await intoShadow(page, 2);
    await install(page, "alpha");

    await clickInShadow(page, "#i2");

    expect(await shadowPressedState(page)).toEqual([false, false, true]);
  });

  test("repaints a light-DOM control while a shadow host sits under the same root", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.className = "host";
      (document.querySelector("[data-scope]") as HTMLElement).append(host);
      host.attachShadow({ mode: "open" });
    });
    await install(page, "alpha");

    await clickItem(page, 2);

    expect(await pressedState(page)).toEqual([false, false, true]);
  });

  test("a signal write repaints a shadow-dwelling control that was never clicked", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await intoShadow(page);
    await install(page, "alpha");

    await page.evaluate(() => {
      window.demoSignals.choice.value = "gamma";
    });

    expect(await shadowPressedState(page)).toEqual([false, false, true]);
  });

  test("binds a control from another realm, which instanceof Node rejects", async ({ page }) => {
    await mount(page, `<iframe id="frame" srcdoc="<div id='root'></div>"></iframe>`, EXPOSE);

    // `resume()` scans the top document, so the frame's control is bound by calling `bindControls`
    // directly rather than through a registered scope.
    const result = await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>("#frame");
      if (!frame) return null;
      if (!frame.contentDocument?.querySelector("#root")) {
        await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      }
      const frameDoc = frame.contentDocument;
      const root = frameDoc?.querySelector<HTMLElement>("#root");
      if (!frameDoc || !root) return null;

      const item = frameDoc.createElement("button");
      item.dataset.field = "choice";
      item.dataset.value = "gamma";
      root.append(item);

      const signals = window.forgeSignals.signalRecord({ choice: "alpha" });
      window.forgeBind.bindControls(root, signals);
      item.click();

      return { value: signals.choice.value, isNodeInThisRealm: item instanceof Node };
    });

    expect(result).toEqual({ value: "gamma", isNodeInThisRealm: false });
  });
});

test.describe("bindControls — the signal is the state and the DOM is a paint of it", () => {
  // Impossible under the old design: pressed state lived in the DOM, so a repaint that wiped the
  // markup destroyed the only copy of it. The signal now outlives the elements.
  test("a signal-driven repaint restores aria-pressed after replaceChildren wipes it", async ({ page }) => {
    await mount(page, await groupMarkup("single", [0]), EXPOSE);
    await install(page, "alpha");

    await clickItem(page, 2);
    expect(await page.evaluate(() => window.lastValue)).toBe("gamma");

    // Rebuild the group from scratch, exactly as an htmx swap or a template re-render would.
    await page.evaluate(() => {
      const group = document.querySelector("[data-slot~='toggle-group']") as HTMLElement;
      group.replaceChildren(
        ...["alpha", "beta", "gamma"].map((value, i) => {
          const button = document.createElement("button");
          button.id = `i${i}`;
          button.type = "button";
          button.setAttribute("data-slot", "toggle-group-item");
          button.dataset.field = "choice";
          button.dataset.value = value;
          button.setAttribute("aria-pressed", "false");
          button.textContent = value;
          return button;
        }),
      );
    });

    expect(await surrogateState(page), "the wipe left every item unpressed, as it must for this to mean anything").toEqual([
      { aria: "false", data: false },
      { aria: "false", data: false },
      { aria: "false", data: false },
    ]);

    // Nothing re-mounts and nothing reads the DOM back: touching the signal repaints from the
    // state, and the state still says gamma.
    await page.evaluate(() => window.forgeSignals);
    await page.click("#i1");
    expect(await page.evaluate(() => window.lastValue)).toBe("beta");
    expect(await surrogateState(page)).toEqual([
      { aria: "false", data: false },
      { aria: "true", data: true },
      { aria: "false", data: false },
    ]);
  });
});
