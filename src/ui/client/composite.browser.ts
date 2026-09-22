import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount } from "./browser.fixture";

declare global {
  interface Window {
    forgeComposite: typeof import("./composite");
    disposeComposite?: () => void;
    /** Elements `getComputedStyle` was asked about, recorded by the direction-read instrumentation. */
    styleReads: string[];
    /** Selectors `Element.prototype.querySelectorAll` was asked for, recorded by the item-scan instrumentation. */
    itemScans: string[];
    /** Elements `checkVisibility()` was called on, recorded by the observer-cost instrumentation. */
    visibilityChecks: number;
  }
}

const EXPOSE = { expose: { forgeComposite: "./ui/client/composite" } };

interface ToolbarOptions {
  count?: number;
  labels?: string[];
  disabled?: number[];
  dir?: "ltr" | "rtl";
  activeMarker?: number;
}

/** A toolbar of buttons. */
function toolbar(options: ToolbarOptions = {}): string {
  const { count = 3, labels, disabled = [], dir = "ltr", activeMarker } = options;
  const names = labels ?? Array.from({ length: count }, (_, i) => `item-${i}`);
  const buttons = names
    .map((label, i) => {
      const flags = [disabled.includes(i) ? "disabled" : "", activeMarker === i ? 'data-composite-item-active=""' : ""].filter(Boolean).join(" ");
      return `<button id="b${i}" data-item ${flags}>${label}</button>`;
    })
    .join("");
  return `<div id="root" dir="${dir}">${buttons}</div>`;
}

async function install(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate((opts) => {
    const root = document.querySelector<HTMLElement>("#root");
    if (root) window.disposeComposite = window.forgeComposite.mountRovingFocus(root, { items: "[data-item]", ...opts });
  }, options);
}

/** Which element currently has focus, by id. */
function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

/** The tabindex of every item, in document order. */
function tabIndexes(page: Page): Promise<number[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-item]")].map((el) => el.tabIndex));
}

test.describe("roving tabindex", () => {
  test("makes the whole composite exactly one tab stop", async ({ page }) => {
    await mount(page, toolbar({ count: 4 }), EXPOSE);
    await install(page);

    expect(await tabIndexes(page)).toEqual([0, -1, -1, -1]);
  });

  test("Tab enters the composite once and Tab again leaves it entirely", async ({ page }) => {
    await mount(page, `<button id="before">before</button>${toolbar({ count: 3 })}<button id="after">after</button>`, EXPOSE);
    await install(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("after");
  });

  test("moves the tab stop to the item the user last used", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");
    expect(await tabIndexes(page)).toEqual([-1, 0, -1]);
  });

  test("starts on the item the server marked active rather than the first", async ({ page }) => {
    await mount(page, toolbar({ count: 3, activeMarker: 2 }), EXPOSE);
    await install(page);

    expect(await tabIndexes(page)).toEqual([-1, -1, 0]);
  });
});

test.describe("orientation", () => {
  test("horizontal answers Left/Right and ignores Up/Down", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page, { orientation: "horizontal" });

    await page.focus("#b0");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b1");
  });

  test("vertical answers Up/Down and ignores Left/Right", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page, { orientation: "vertical" });

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("b1");
  });

  test("both answers all four arrows", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page, { orientation: "both" });

    await page.focus("#b0");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b2");
    await page.keyboard.press("ArrowUp");
    expect(await focusedId(page)).toBe("b1");
  });
});

test.describe("RTL", () => {
  test("ArrowLeft moves forward and ArrowRight moves back under dir=rtl", async ({ page }) => {
    await mount(page, toolbar({ count: 3, dir: "rtl" }), EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b0");
  });

  test("reads the direction from the element, not from the page", async ({ page }) => {
    await mount(page, `<div dir="ltr">${toolbar({ count: 3, dir: "rtl" })}</div>`, EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b1");
  });

  test("mirrors under orientation:both too, where the vertical arrows keep their meaning", async ({ page }) => {
    await mount(page, toolbar({ count: 3, dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "both", loop: false });

    await page.focus("#b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("b2");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowUp");
    expect(await focusedId(page)).toBe("b0");
  });

  test("a vertical composite is unmirrored, and its Up/Down still navigate under dir=rtl", async ({ page }) => {
    await mount(page, toolbar({ count: 3, dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "vertical" });

    await page.focus("#b0");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowUp");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b0");
  });

  test("Home, End and typeahead are unaffected by direction", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Apple", "Banana", "Cherry", "Date"], dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "both", typeahead: true });

    await page.focus("#b1");
    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("b3");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("c");
    expect(await focusedId(page)).toBe("b2");
  });
});

test.describe("the direction read is narrowed to the keys that can consume it", () => {
  /** Wraps `getComputedStyle` to record what it was asked about; must run after `mount`, which replaces the document. */
  async function instrumentStyleReads(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.styleReads = [];
      const real = window.getComputedStyle.bind(window);
      window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
        window.styleReads.push((el as HTMLElement).id || el.tagName);
        return real(el, pseudo);
      }) as typeof window.getComputedStyle;
    });
  }

  /** The elements `getComputedStyle` was asked about while handling exactly one key press. */
  async function readsWhilePressing(page: Page, key: string): Promise<string[]> {
    await page.evaluate(() => {
      window.styleReads = [];
    });
    await page.keyboard.press(key);
    return page.evaluate(() => window.styleReads);
  }

  test("a horizontal arrow reads it once; Up, Down, Home, End and typeahead never do", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Apple", "Banana", "Cherry"], dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "both", typeahead: true });
    await instrumentStyleReads(page);

    await page.focus("#b0");
    const reads: Record<string, string[]> = {};
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "c", "ArrowLeft", "ArrowRight"]) {
      reads[key] = await readsWhilePressing(page, key);
    }

    expect(reads).toEqual({ ArrowDown: [], ArrowUp: [], Home: [], End: [], c: [], ArrowLeft: ["root"], ArrowRight: ["root"] });
  });

  test("a vertical composite never reads it, not even for a horizontal arrow", async ({ page }) => {
    await mount(page, toolbar({ count: 3, dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "vertical" });
    await instrumentStyleReads(page);

    await page.focus("#b0");
    const reads = { ArrowLeft: await readsWhilePressing(page, "ArrowLeft"), ArrowDown: await readsWhilePressing(page, "ArrowDown") };

    expect(reads).toEqual({ ArrowLeft: [], ArrowDown: [] });
    expect(await focusedId(page)).toBe("b1");
  });
});

test.describe("the item scan is narrowed to the keys that can consume it", () => {
  /** Wraps `Element.prototype.querySelectorAll` to record what it was asked for; `Document`'s own method is a separate slot. */
  async function instrumentItemScans(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.itemScans = [];
      const real = Element.prototype.querySelectorAll;
      Element.prototype.querySelectorAll = function (this: Element, selector: string) {
        window.itemScans.push(selector);
        return real.call(this, selector);
      } as typeof Element.prototype.querySelectorAll;
    });
  }

  /** The selectors queried below any element while handling exactly one key press. */
  async function scansWhilePressing(page: Page, key: string): Promise<string[]> {
    await page.evaluate(() => {
      window.itemScans = [];
    });
    await page.keyboard.press(key);
    return page.evaluate(() => window.itemScans);
  }

  test("a key outside the claimed set, and a modified arrow, scan nothing; a plain arrow scans and moves focus", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.focus("#b0");
    await instrumentItemScans(page);

    const scans: Record<string, string[]> = {};
    for (const key of ["PageDown", "Escape", "Control+ArrowRight", "ArrowRight"]) {
      scans[key] = await scansWhilePressing(page, key);
    }

    // ArrowRight scans twice: once in the key handler, once in `focusin` as the move lands.
    expect(scans).toEqual({ PageDown: [], Escape: [], "Control+ArrowRight": [], ArrowRight: ["[data-item]", "[data-item]"] });
    expect(await focusedId(page)).toBe("b1");
  });

  test("an ordinary character typed into a toolbar's text field scans nothing", async ({ page }) => {
    await mount(
      page,
      '<div id="root"><button id="b0" data-item>Apple</button><input id="field" data-item value="hello"><button id="b2" data-item>Cherry</button></div>',
      EXPOSE,
    );
    await install(page, { typeahead: true });

    await page.focus("#field");
    await instrumentItemScans(page);

    expect(await scansWhilePressing(page, "c")).toEqual([]);
    expect(await focusedId(page)).toBe("field");
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>("#field")?.value)).toBe("chello");
  });

  test("a character typed outside a text field still scans, and still jumps", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Apple", "Banana", "Cherry"] }), EXPOSE);
    await install(page, { typeahead: true });

    await page.focus("#b0");
    await instrumentItemScans(page);

    expect(await scansWhilePressing(page, "c")).toEqual(["[data-item]", "[data-item]"]);
    expect(await focusedId(page)).toBe("b2");
  });
});

test.describe("Home / End", () => {
  test("jump to the first and last items", async ({ page }) => {
    await mount(page, toolbar({ count: 4 }), EXPOSE);
    await install(page);

    await page.focus("#b1");
    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("b3");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("b0");
  });

  test("jump to the first and last ENABLED items", async ({ page }) => {
    await mount(page, toolbar({ count: 4, disabled: [0, 3] }), EXPOSE);
    await install(page);

    await page.focus("#b1");
    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("b2");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("b1");
  });
});

test.describe("disabled items", () => {
  test("skips a natively disabled item", async ({ page }) => {
    await mount(page, toolbar({ count: 3, disabled: [1] }), EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b2");
  });

  // `disabled` leaves the ring; `aria-disabled` stays in it, focusable but inert. That is the WAI-ARIA
  // authoring-practices split, and what `ui/README.md` promises for every composite this mounts.
  test("keeps an aria-disabled item in the ring, where it is focusable but inert", async ({ page }) => {
    await mount(
      page,
      '<div id="root"><button id="b0" data-item>a</button><button id="b1" data-item aria-disabled="true">b</button><button id="b2" data-item>c</button></div>',
      EXPOSE,
    );
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b1");
  });

  test("does not hang when every item is disabled", async ({ page }) => {
    await mount(page, toolbar({ count: 3, disabled: [0, 1, 2] }), EXPOSE);
    await install(page);

    // The assertion is that these return at all: an unguarded wrap-and-skip loop spins forever.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    expect(await focusedId(page)).toBe("");
  });

  test("gives the tab stop to the first enabled item when the first item is disabled", async ({ page }) => {
    await mount(page, toolbar({ count: 3, disabled: [0] }), EXPOSE);
    await install(page);

    expect(await tabIndexes(page)).toEqual([-1, 0, -1]);
  });
});

test.describe("loop", () => {
  test("wraps at both ends when loop is true", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page, { loop: true });

    await page.focus("#b2");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b2");
  });

  test("stops at the ends when loop is false", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page, { loop: false });

    await page.focus("#b2");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b2");
    await page.focus("#b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b0");
  });
});

test.describe("typeahead", () => {
  test("jumps to the item whose text starts with what was typed", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Apple", "Banana", "Cherry"] }), EXPOSE);
    await install(page, { typeahead: true });

    await page.focus("#b0");
    await page.keyboard.press("c");
    expect(await focusedId(page)).toBe("b2");
  });

  test("accumulates a multi-character buffer to disambiguate", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Cut", "Copy", "Paste"] }), EXPOSE);
    await install(page, { typeahead: true });

    await page.focus("#b2");
    await page.keyboard.press("c");
    expect(await focusedId(page)).toBe("b0"); // "c" → Cut
    await page.keyboard.press("o");
    expect(await focusedId(page)).toBe("b1"); // "co" → Copy
  });

  test("clears the buffer after the timeout so a repeated letter cycles", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Cut", "Copy", "Paste"] }), EXPOSE);
    await install(page, { typeahead: true, typeaheadTimeout: 40 });

    await page.focus("#b2");
    await page.keyboard.press("c");
    expect(await focusedId(page)).toBe("b0");
    await page.waitForTimeout(80);
    await page.keyboard.press("c");
    expect(await focusedId(page)).toBe("b1");
  });

  test("skips disabled items", async ({ page }) => {
    await mount(page, toolbar({ labels: ["Apple", "Apricot", "Cherry"], disabled: [1] }), EXPOSE);
    await install(page, { typeahead: true });

    await page.focus("#b2");
    await page.keyboard.press("a");
    expect(await focusedId(page)).toBe("b0");
  });
});

test.describe("native inputs are never stolen from", () => {
  const WITH_INPUT =
    '<div id="root"><button id="b0" data-item>a</button><input id="field" data-item value="hello"><button id="b2" data-item>c</button></div>';

  test("ArrowRight moves the caret inside a text field rather than leaving it", async ({ page }) => {
    await mount(page, WITH_INPUT, EXPOSE);
    await install(page);

    await page.focus("#field");
    await page.evaluate(() => document.querySelector<HTMLInputElement>("#field")?.setSelectionRange(0, 0));
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("field");
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>("#field")?.selectionStart)).toBe(1);
  });

  // `email`, `number` and every date type edit text but report `selectionStart` as null, so the
  // selection API cannot be the test — the ring would claim their arrows at every caret position.
  for (const type of ["email", "number"]) {
    test(`both arrows stay inside a type=${type} field, which has no selection API to consult`, async ({ page }) => {
      const html = `<div id="root"><button id="b0" data-item>a</button><input id="field" type="${type}" data-item><button id="b2" data-item>c</button></div>`;
      await mount(page, html, EXPOSE);
      await install(page);

      await page.focus("#field");
      await page.keyboard.press("ArrowLeft");
      expect(await focusedId(page)).toBe("field");
      await page.keyboard.press("ArrowRight");
      expect(await focusedId(page)).toBe("field");
    });
  }

  // `color` edits no text either, but unlike a date or a `number` it does nothing with the arrows —
  // so releasing them to the platform left the user stranded on the swatch with only Tab out.
  test("a type=color swatch leaves the arrows to the ring, having no use for them", async ({ page }) => {
    const html =
      '<div id="root"><button id="b0" data-item>a</button><input id="field" type="color" data-item><button id="b2" data-item>c</button></div>';
    await mount(page, html, EXPOSE);
    await install(page);

    await page.focus("#field");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b2");
  });

  test("ArrowRight at the end of the text leaves the field", async ({ page }) => {
    await mount(page, WITH_INPUT, EXPOSE);
    await install(page);

    await page.focus("#field");
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#field");
      field?.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b2");
  });

  test("Shift+Arrow keeps making a selection instead of navigating", async ({ page }) => {
    await mount(page, WITH_INPUT, EXPOSE);
    await install(page);

    await page.focus("#field");
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#field");
      field?.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.press("Shift+ArrowLeft");

    expect(await focusedId(page)).toBe("field");
  });

  test("typeahead never fires while a text field has focus", async ({ page }) => {
    await mount(page, WITH_INPUT, EXPOSE);
    await install(page, { typeahead: true });

    await page.focus("#field");
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#field");
      field?.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.press("c");

    expect(await focusedId(page)).toBe("field");
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>("#field")?.value)).toBe("helloc");
  });

  test("a checkbox is not a text field, so arrows still navigate", async ({ page }) => {
    await mount(
      page,
      '<div id="root"><button id="b0" data-item>a</button><input id="check" type="checkbox" data-item><button id="b2" data-item>c</button></div>',
      EXPOSE,
    );
    await install(page);

    await page.focus("#check");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b2");
  });
});

test.describe("focus restoration", () => {
  test("removing the focused item moves focus to whatever took its place, not to <body>", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.focus("#b1");
    await page.evaluate(() => document.querySelector("#b1")?.remove());
    await expect.poll(() => focusedId(page)).toBe("b2");
  });

  test("removing the last item falls back to the item before it", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.focus("#b2");
    await page.evaluate(() => document.querySelector("#b2")?.remove());
    await expect.poll(() => focusedId(page)).toBe("b1");
  });

  test("leaves focus alone when an unfocused item is removed", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.evaluate(() => document.querySelector("#b2")?.remove());
    expect(await focusedId(page)).toBe("b0");
  });

  test("leaves focus where the user put it when the composite mutates after they left it", async ({ page }) => {
    await mount(page, `${toolbar({ count: 3 })}<input id="editor">`, EXPOSE);
    await install(page);

    await page.focus("#b1");
    await page.focus("#editor");
    await page.evaluate(async () => {
      const added = document.createElement("button");
      added.id = "b3";
      added.setAttribute("data-item", "");
      document.querySelector("#root")?.append(added);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await focusedId(page)).toBe("editor");
  });

  // A click on blank background blurs to `<body>` with a null `relatedTarget`, exactly as removing the
  // focused item does — so only the item having gone away can mean the user was stranded.
  test("leaves focus on <body> when the user clicked blank background before the mutation", async ({ page }) => {
    await mount(page, `${toolbar({ count: 3 })}<div id="blank" style="height:200px"></div>`, EXPOSE);
    await install(page);

    await page.focus("#b1");
    await page.click("#blank");
    expect(await focusedId(page)).toBe("");
    await page.evaluate(async () => {
      const added = document.createElement("button");
      added.id = "b3";
      added.setAttribute("data-item", "");
      document.querySelector("#root")?.append(added);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test("adopts items added after mount, because items are resolved live", async ({ page }) => {
    await mount(page, toolbar({ count: 2 }), EXPOSE);
    await install(page);

    await page.evaluate(() => {
      const added = document.createElement("button");
      added.id = "b2";
      added.setAttribute("data-item", "");
      added.textContent = "added";
      document.querySelector("#root")?.append(added);
    });

    await page.focus("#b1");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b2");
  });
});

test.describe("items that are in the DOM but not rendered", () => {
  test("skips a hidden item entirely", async ({ page }) => {
    await mount(
      page,
      '<div id="root"><button id="b0" data-item>0</button><button id="b1" data-item hidden>1</button><button id="b2" data-item>2</button></div>',
      EXPOSE,
    );
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b2");
  });

  test("skips items inside a display:none subtree", async ({ page }) => {
    const html =
      '<div id="root"><button id="b0" data-item>0</button>' +
      '<div style="display:none"><button id="nested" data-item>nested</button></div>' +
      '<button id="b2" data-item>2</button></div>';
    await mount(page, html, EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("End");

    expect(await focusedId(page)).toBe("b2");
  });

  test("adopts an item the moment it becomes visible", async ({ page }) => {
    await mount(page, '<div id="root"><button id="b0" data-item>0</button><button id="b1" data-item hidden>1</button></div>', EXPOSE);
    await install(page);

    await page.evaluate(() => document.querySelector("#b1")?.removeAttribute("hidden"));
    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b1");
  });
});

// A native button carries `tabIndex === 0` without this controller having written it, so an item that
// joins the ring after mount arrives already looking like the stop. Nothing here focuses: that repairs it.
test.describe("exactly one tab stop survives a change of membership", () => {
  test("re-normalises the ring when an item is appended with focus outside", async ({ page }) => {
    await mount(page, toolbar({ count: 2 }), EXPOSE);
    await install(page);

    await page.evaluate(async () => {
      const added = document.createElement("button");
      added.id = "b2";
      added.setAttribute("data-item", "");
      document.querySelector("#root")?.append(added);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await tabIndexes(page)).toEqual([0, -1, -1]);
  });

  test("writes the designated stop when the reveal happens above the root, where no mutation reaches", async ({ page }) => {
    const items =
      '<button id="b0" data-item>0</button><button id="b1" data-item>1</button><button id="b2" data-item data-composite-item-active>2</button>';
    await mount(page, `<details id="panel"><summary>more</summary><div id="root">${items}</div></details>`, EXPOSE);
    await install(page);

    await page.evaluate(async () => {
      document.querySelector<HTMLDetailsElement>("#panel")?.setAttribute("open", "");
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(await tabIndexes(page)).toEqual([-1, -1, 0]);
  });

  // The reveal observer outlives a mount whose root was visible but empty, so an ordinary scroll can
  // fire it long after the ring was normalised — where it must leave the stop the user moved.
  test("an intersection change never takes the stop back off the item the user arrowed to", async ({ page }) => {
    await mount(page, '<div id="root"></div><div style="height:200vh"></div>', EXPOSE);
    await install(page);

    await page.evaluate(async () => {
      const root = document.querySelector("#root");
      for (let i = 0; i < 3; i += 1) {
        const item = document.createElement("button");
        item.id = `b${i}`;
        item.setAttribute("data-item", "");
        root?.append(item);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await page.focus("#b2");
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(await tabIndexes(page)).toEqual([-1, -1, 0]);
  });

  test("writes the ring's first stop when a composite hidden at mount is revealed", async ({ page }) => {
    await mount(page, '<div id="root" hidden><button id="b0" data-item>0</button><button id="b1" data-item>1</button></div>', EXPOSE);
    await install(page);

    await page.evaluate(async () => {
      document.querySelector("#root")?.removeAttribute("hidden");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await tabIndexes(page)).toEqual([0, -1]);
  });
});

test.describe("nested composites", () => {
  /** An outer composite whose second item contains an inner composite. */
  const NESTED =
    '<div id="root"><button id="o0" data-item>o0</button>' +
    '<div id="inner"><button id="i0" data-inner>i0</button><button id="i1" data-inner>i1</button></div>' +
    '<button id="o1" data-item>o1</button></div>';

  /** The outer claims all four arrows, so both controllers want ArrowDown. */
  async function installBoth(page: Page): Promise<void> {
    await install(page, { orientation: "both" });
    await page.evaluate(() => {
      const inner = document.querySelector<HTMLElement>("#inner");
      if (inner) window.forgeComposite.mountRovingFocus(inner, { items: "[data-inner]", orientation: "vertical" });
    });
  }

  test("the inner composite keeps the key its outer parent would also have claimed", async ({ page }) => {
    await mount(page, NESTED, EXPOSE);
    await installBoth(page);

    await page.focus("#i0");
    await page.keyboard.press("ArrowDown");

    expect(await focusedId(page)).toBe("i1");
  });

  test("a key the inner composite does not claim still reaches the outer one", async ({ page }) => {
    await mount(page, NESTED, EXPOSE);
    await installBoth(page);

    await page.focus("#i0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("o1");
  });
});

test.describe("disposer", () => {
  test("removes every listener it installed", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.evaluate(() => window.disposeComposite?.());
    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b0");
  });

  test("stops restoring focus after disposal", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);

    await page.focus("#b1");
    await page.evaluate(() => {
      window.disposeComposite?.();
      document.querySelector("#b1")?.remove();
    });

    expect(await focusedId(page)).toBe("");
  });
});

test.describe("idempotence per root", () => {
  test("a second mount on the same root moves focus once, not twice", async ({ page }) => {
    await mount(page, toolbar({ count: 4 }), EXPOSE);
    await install(page);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b1");
  });

  test("the disposer from a repeat mount tears down the one controller there is", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);
    await install(page);

    await page.evaluate(() => window.disposeComposite?.());
    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b0");
  });

  test("mounting again after disposal installs a live controller", async ({ page }) => {
    await mount(page, toolbar({ count: 3 }), EXPOSE);
    await install(page);
    await page.evaluate(() => window.disposeComposite?.());
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("b1");
  });
});

// `listItems()` costs a `checkVisibility()` per item, each forcing style resolution, while a
// `{childList, subtree}` observer gets a batch for every unrelated write under the root.
test.describe("the observer defers the visibility scan behind a membership test", () => {
  async function instrumentVisibility(page: Page): Promise<void> {
    await page.evaluate(() => {
      window.visibilityChecks = 0;
      const real = Element.prototype.checkVisibility;
      Element.prototype.checkVisibility = function (this: Element, options?: CheckVisibilityOptions) {
        window.visibilityChecks += 1;
        return real.call(this, options);
      } as typeof Element.prototype.checkVisibility;
    });
  }

  test("costs nothing per mutation that cannot have changed the ring's membership", async ({ page }) => {
    await mount(page, toolbar({ count: 20 }), EXPOSE);
    await install(page);
    await page.focus("#b0");
    await instrumentVisibility(page);

    await page.evaluate(async () => {
      const root = document.querySelector("#root") as HTMLElement;
      for (let write = 0; write < 10; write += 1) {
        root.appendChild(document.createElement("span"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    // A `<span>` is neither an item nor holds one, so none of the 10 batches reaches the scan at all.
    expect(await page.evaluate(() => window.visibilityChecks)).toBe(0);
  });

  test("still runs the full scan for the removal it exists for", async ({ page }) => {
    await mount(page, toolbar({ count: 20 }), EXPOSE);
    await install(page);
    await page.focus("#b0");
    await instrumentVisibility(page);

    await page.evaluate(async () => {
      document.querySelector("#b0")?.remove();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await page.evaluate(() => window.visibilityChecks)).toBeGreaterThan(0);
    expect(await focusedId(page)).toBe("b1");
  });
});
