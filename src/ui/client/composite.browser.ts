import { expect, type Page, test } from "@playwright/test";
import { mount } from "./browser-test-helper";

/**
 * `mountRovingFocus` against real keyboard events.
 *
 * Every case here presses a real key and asserts what the browser focused, because a composite
 * controller is *only* its keyboard behaviour — there is nothing else to assert. `page.keyboard`
 * dispatches through Chromium's real input path, so the `preventDefault` decisions, the focus moves
 * and the tab order are the ones a user would get.
 */

declare global {
  interface Window {
    forgeComposite: typeof import("./composite");
    disposeComposite?: () => void;
    /** Elements `getComputedStyle` was asked about, recorded by the direction-read instrumentation. */
    styleReads: string[];
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

/** A toolbar of buttons — the shape every consumer in this epic has. */
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
    // Four buttons, two Tab presses: without roving tabindex this would be `b1`.
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
    // In RTL the visually-next item is to the LEFT, so ArrowLeft must advance.
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b0");
  });

  test("reads the direction from the element, not from the page", async ({ page }) => {
    await mount(page, `<div dir="ltr">${toolbar({ count: 3, dir: "rtl" })}</div>`, EXPOSE);
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowLeft");
    // The composite's own subtree is RTL even though the page around it is LTR.
    expect(await focusedId(page)).toBe("b1");
  });

  test("mirrors under orientation:both too, where the vertical arrows keep their meaning", async ({ page }) => {
    // `both` is the other side of the `orientation !== "vertical"` half of the direction read: it must
    // mirror the horizontal pair while leaving Up/Down alone, and a narrowing written as
    // `orientation === "horizontal"` would silently stop mirroring here.
    await mount(page, toolbar({ count: 3, dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "both", loop: false });

    await page.focus("#b0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b1");
    await page.keyboard.press("ArrowDown");
    // Down is *not* mirrored — there is no such thing as a right-to-left vertical axis here.
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
    // Neither horizontal arrow is this orientation's, in either direction — so RTL cannot make one
    // of them navigate by mirroring the pair it does not own.
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b0");
  });

  test("Home, End and typeahead are unaffected by direction", async ({ page }) => {
    // These resolve to the same answer either way, which is *why* they sit in front of the direction
    // read. Asserting them under RTL is an invariance claim: a mirroring that leaked past the
    // horizontal pair would make Home jump to the visually-leftmost item instead of the first.
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

/**
 * The direction read itself, rather than the navigation it decides.
 *
 * The controller narrows `isRtl(root)` to a horizontal arrow in a non-vertical composite so
 * `getComputedStyle`'s forced style recalculation stays off every other key. That narrowing has **no
 * navigational consequence at all** — every key it excludes resolves to the same item either way — so
 * no focus assertion anywhere in this file can distinguish it from its own absence. Counting the
 * platform's own `getComputedStyle` invocations is the only read that can, and per TESTING.md §3d
 * that invocation *is* the mechanism.
 */
test.describe("the direction read is narrowed to the keys that can consume it", () => {
  /**
   * Wrap `getComputedStyle` and record what it was asked about.
   *
   * **After `mount` and after `install`, and both halves matter.** `setContent` replaces the document
   * and discards every window mutation made before it, so instrumenting earlier reads as correct and
   * records nothing; and `isRtl` resolves `ownerWindow(el).getComputedStyle` per call rather than
   * caching it at mount, which is what lets a wrapper installed after the controller still be seen.
   */
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

    // Both halves in one assertion, which is what makes either half worth reading. "Home never reads
    // the style" is worth nothing without "ArrowLeft does" — a direction read deleted outright also
    // never runs, and the empty arrays alone would certify that as correct.
    expect(reads).toEqual({ ArrowDown: [], ArrowUp: [], Home: [], End: [], c: [], ArrowLeft: ["root"], ArrowRight: ["root"] });
  });

  test("a vertical composite never reads it, not even for a horizontal arrow", async ({ page }) => {
    await mount(page, toolbar({ count: 3, dir: "rtl" }), EXPOSE);
    await install(page, { orientation: "vertical" });
    await instrumentStyleReads(page);

    await page.focus("#b0");
    const reads = { ArrowLeft: await readsWhilePressing(page, "ArrowLeft"), ArrowDown: await readsWhilePressing(page, "ArrowDown") };

    // The `orientation !== "vertical"` clause, which the case above cannot reach. Paired with the
    // move Down still makes, so "no read" is distinguishable from "no controller".
    expect(reads).toEqual({ ArrowLeft: [], ArrowDown: [] });
    expect(await focusedId(page)).toBe("b1");
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

  test("skips an aria-disabled item, which stays focusable but inert", async ({ page }) => {
    await mount(
      page,
      '<div id="root"><button id="b0" data-item>a</button><button id="b1" data-item aria-disabled="true">b</button><button id="b2" data-item>c</button></div>',
      EXPOSE,
    );
    await install(page);

    await page.focus("#b0");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("b2");
  });

  test("does not hang when every item is disabled", async ({ page }) => {
    await mount(page, toolbar({ count: 3, disabled: [0, 1, 2] }), EXPOSE);
    await install(page);

    // The assertion is that these return at all: an unguarded wrap-and-skip loop spins forever on a
    // group with no enabled item to land on. Focus stays where it was — outside the composite.
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
    // Buffer reset, so the search restarts from the item after the current one.
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

    // Focus stayed put AND the character was typed — the composite neither navigated nor swallowed it.
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
    // Without restoration this is "" — focus falls to <body> and a keyboard user is stranded at the
    // top of the page. The item now occupying the removed one's index is the natural landing spot.
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

    // Without the visibility filter this lands on `b1` and focus goes nowhere, because a `hidden`
    // element cannot take it — the ring appears to hang on the invisible index.
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

test.describe("nested composites", () => {
  /** An outer composite whose second item contains an inner composite — the shape a submenu has. */
  const NESTED =
    '<div id="root"><button id="o0" data-item>o0</button>' +
    '<div id="inner"><button id="i0" data-inner>i0</button><button id="i1" data-inner>i1</button></div>' +
    '<button id="o1" data-item>o1</button></div>';

  /** The outer claims all four arrows, so both controllers want ArrowDown — the conflict the
   * `defaultPrevented` bail exists to settle. */
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

    // The event bubbles from `#inner` to `#root`, which claims ArrowDown too. Without the
    // `defaultPrevented` bail the outer move overwrites the inner one and focus leaves the submenu.
    expect(await focusedId(page)).toBe("i1");
  });

  test("a key the inner composite does not claim still reaches the outer one", async ({ page }) => {
    await mount(page, NESTED, EXPOSE);
    await installBoth(page);

    await page.focus("#i0");
    // The inner composite is vertical, so ArrowRight is not its key and it leaves the event alone.
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
