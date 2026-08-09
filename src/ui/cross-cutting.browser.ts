import { expect, type Page, test } from "@playwright/test";
import { jsx } from "../jsx/jsx-runtime";
import { render } from "../testing/render";
import { mount } from "./client/browser-test-helper";
import { ToggleGroup as BoundToggleGroup } from "./controls/toggle-group";
import { Dialog } from "./core/dialog";
import { Menu } from "./core/menu";
import { Tabs } from "./core/tabs";
import { Toolbar } from "./core/toolbar";
import { Resumable } from "./server/resumable";

/**
 * The scenarios no single component owns.
 *
 * Every case here needs **two things live at once**, which is why none of them belongs in a
 * component's own spec: the failure only exists in the seam between them. A Menu alone cannot show
 * that Escape closes the wrong overlay; a ToggleGroup alone cannot show its signal and its DOM
 * disagreeing after a form reset; a composite alone cannot show a delegated click routing to the
 * host instead of the item that was hit.
 *
 * Base UI's scenarios are the specification here, and none of its structure is: no `render()`, no
 * `userEvent`, no context providers, no `act()`. Each case builds real markup, dispatches real
 * events, and asserts a DOM or focus state — never a call count.
 *
 * Lives at the `ui/` root because it has no single subject.
 */

declare global {
  interface Window {
    forgeResume: typeof import("./client/resume");
    forgeMenu: typeof import("./client/menu");
    forgeComposite: typeof import("./client/composite");
    forgeTabs: typeof import("./client/tabs");
    forgeBind: typeof import("./client/bind");
    forgeSignals: typeof import("./client/signal-record");
    activations: string[];
    submitted: Array<[string, string]>;
    lastChoice?: unknown;
  }
}

const EXPOSE = {
  expose: {
    forgeResume: "./ui/client/resume",
    forgeCoreClient: "./ui/core/client",
    forgeMenu: "./ui/client/menu",
    forgeComposite: "./ui/client/composite",
    forgeTabs: "./ui/client/tabs",
    forgeBind: "./ui/client/bind",
    forgeSignals: "./ui/client/signal-record",
  },
};

/** Register a scope that records every action it runs, then start the runtime. */
async function start(page: Page, scope = "demo"): Promise<void> {
  await page.evaluate((name) => {
    window.activations = [];
    window.forgeResume.registerScope(name, { on: { pick: (ctx) => window.activations.push(ctx.el.id || (ctx.el.dataset.value ?? "")) } });
    window.forgeResume.resume();
  }, scope);
}

function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

function isPopoverOpen(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sel) => document.querySelector(sel)?.matches(":popover-open") ?? false, `#${id}`);
}

/**
 * `Menu.Trigger`'s `id` prop names the **popup** it toggles — it is the `commandfor` target, not the
 * button's own id. A trigger is therefore addressed by a `data-ref`, which is also what tells two
 * live triggers apart in the nested-overlay cases.
 */
function menuTrigger(popupId: string, ref: string, label: string) {
  return Menu.Trigger({ id: popupId, "data-ref": ref, children: label });
}

const triggerRef = (ref: string) => `[data-ref='${ref}']`;

/**
 * The `data-slot` tokens of whatever holds focus — enough to tell a menu trigger from a dialog
 * trigger. `data-slot` is a token list, so the value is parsed rather than compared whole.
 */
function focusedSlots(page: Page): Promise<string[]> {
  return page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []);
}

// ─── 1. Nested overlays ──────────────────────────────────────────────────────

test.describe("nested overlays — a Menu inside a Dialog", () => {
  async function mountNested(page: Page): Promise<void> {
    const menu = Menu({
      children: [
        menuTrigger("inner-menu", "menu-trigger", "Options"),
        Menu.Popup({
          id: "inner-menu",
          children: [
            Menu.Item({ id: "row-a", for: "inner-menu", children: "Alpha" }),
            Menu.Item({ id: "row-b", for: "inner-menu", children: "Beta" }),
          ],
        }),
      ],
    });
    const html = await render([
      Dialog.Trigger({ id: "open-dialog", for: "outer-dialog", children: "Open" }),
      Dialog({ id: "outer-dialog", children: [jsx("p", { children: "Settings" }), menu] }),
    ]);
    await mount(page, `<div data-scope="demo">${html}</div>`, EXPOSE);
    await start(page);
    await page.click("#open-dialog");
    await page.click(triggerRef("menu-trigger"));
    await expect.poll(() => focusedId(page)).toBe("row-a");
  }

  test("Escape closes only the innermost overlay", async ({ page }) => {
    await mountNested(page);

    await page.keyboard.press("Escape");

    await expect.poll(() => isPopoverOpen(page, "inner-menu")).toBe(false);
    // The dialog is the outer overlay and Escape was never its keystroke to take.
    expect(await page.evaluate(() => document.querySelector<HTMLDialogElement>("#outer-dialog")?.open)).toBe(true);
  });

  test("Escape returns focus to the menu trigger, not to the dialog trigger", async ({ page }) => {
    await mountNested(page);

    await page.keyboard.press("Escape");

    // Two triggers are live at once; restoring to the wrong one is the failure this catches, and it
    // is only reachable with both overlays open.
    await expect.poll(() => focusedSlots(page)).toContain("menu-trigger");
    expect(await focusedId(page)).not.toBe("open-dialog");
  });

  test("a second Escape then closes the dialog", async ({ page }) => {
    await mountNested(page);

    await page.keyboard.press("Escape");
    await expect.poll(() => isPopoverOpen(page, "inner-menu")).toBe(false);
    await page.keyboard.press("Escape");

    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLDialogElement>("#outer-dialog")?.open)).toBe(false);
  });

  test("the menu's items are reachable while the dialog holds the top layer", async ({ page }) => {
    await mountNested(page);

    await page.keyboard.press("ArrowDown");

    // A modal dialog makes everything outside it inert. A popup opened from inside it must not be
    // caught by that, or the menu would be visible and unusable.
    expect(await focusedId(page)).toBe("row-b");
  });
});

// ─── 2. Removed trigger ──────────────────────────────────────────────────────

test.describe("a trigger removed while its popup is open", () => {
  async function mountMenu(page: Page): Promise<void> {
    const html = await render(
      Menu({
        children: [
          menuTrigger("orphan-menu", "gone-trigger", "Options"),
          Menu.Popup({ id: "orphan-menu", children: [Menu.Item({ id: "only-row", for: "orphan-menu", children: "Alpha" })] }),
        ],
      }),
    );
    await mount(page, `<div data-scope="demo"><button id="anchor">anchor</button>${html}</div>`, EXPOSE);
    await start(page);
    await page.click(triggerRef("gone-trigger"));
    await expect.poll(() => focusedId(page)).toBe("only-row");
  }

  test("closing it does not put focus on the detached node", async ({ page }) => {
    await mountMenu(page);

    await page.evaluate(() => document.querySelector("[data-ref='gone-trigger']")?.remove());
    await page.keyboard.press("Escape");

    // The controller captured the opener when the menu opened. Focusing a node that is no longer in
    // the document silently does nothing, so focus must be somewhere still connected — never on the
    // orphan, and never reported as focused when it cannot be.
    const state = await page.evaluate(() => ({
      connected: document.activeElement ? document.contains(document.activeElement) : false,
      isOrphan: document.activeElement?.getAttribute("data-ref") === "gone-trigger",
    }));
    expect(state).toEqual({ connected: true, isOrphan: false });
  });

  test("removing the trigger does not throw or leave the popup stuck open", async ({ page }) => {
    await mountMenu(page);

    const error = await page.evaluate(() => {
      try {
        document.querySelector("[data-ref='gone-trigger']")?.remove();
        document.querySelector<HTMLElement & { hidePopover(): void }>("#orphan-menu")?.hidePopover();
        return null;
      } catch (err) {
        return String(err);
      }
    });

    expect(error).toBeNull();
    await expect.poll(() => isPopoverOpen(page, "orphan-menu")).toBe(false);
  });
});

// ─── 3. Form reset and submission ────────────────────────────────────────────

test.describe("a composite widget inside a form", () => {
  async function mountForm(page: Page): Promise<void> {
    const group = BoundToggleGroup({
      type: "single",
      children: ["mm", "cm", "in"].map((value, i) =>
        BoundToggleGroup.Item({ id: `u-${value}`, bind: "choice", value, pressed: i === 0, children: value }),
      ),
    });
    const inner = await render(
      Resumable({ name: "demo", children: [jsx("input", { id: "native", name: "label", value: "start", type: "text" }), group] }),
    );
    await mount(page, `<form id="form">${inner}</form>`, EXPOSE);
    await page.evaluate(() => {
      window.submitted = [];
      const signals = window.forgeSignals.signalRecord({ choice: "mm" });
      window.forgeResume.registerScope("demo", { on: { bindGroup: window.forgeBind.bindGroup(signals) } });
      window.forgeResume.resume();
      window.forgeResume.effect(() => {
        window.lastChoice = signals.choice.value;
      });
      document.querySelector("#form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        window.submitted = [...new FormData(event.target as HTMLFormElement)] as Array<[string, string]>;
      });
    });
  }

  /** The pressed item's value read from the DOM, beside the value the signal holds. */
  function agreement(page: Page): Promise<{ dom: string | undefined; signal: unknown }> {
    return page.evaluate(() => ({
      dom: [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].find((el) => el.getAttribute("aria-pressed") === "true")
        ?.dataset.value,
      signal: window.lastChoice,
    }));
  }

  test("the DOM and the signal agree after a click", async ({ page }) => {
    await mountForm(page);

    await page.click("#u-in");

    expect(await agreement(page)).toEqual({ dom: "in", signal: "in" });
  });

  test("submission carries the native controls; button items are not successful controls", async ({ page }) => {
    await mountForm(page);
    await page.click("#u-cm");

    await page.evaluate(() => document.querySelector<HTMLFormElement>("#form")?.requestSubmit());

    // A consumer needs to know this: `<button>` items contribute nothing to `FormData`, so a
    // segmented control that must be submitted needs a companion field.
    expect(await page.evaluate(() => window.submitted)).toEqual([["label", "start"]]);
  });

  test("a native reset reverts the native control and leaves the widget and its signal in step", async ({ page }) => {
    await mountForm(page);
    await page.fill("#native", "edited");
    await page.click("#u-in");

    await page.evaluate(() => document.querySelector<HTMLFormElement>("#form")?.reset());

    // `form.reset()` restores a native control's default and does not touch `aria-pressed`. The
    // property that matters is that the widget's DOM and its signal never diverge from each other —
    // one reverting without the other is the bug this scenario exists to catch.
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>("#native")?.value)).toBe("start");
    expect(await agreement(page)).toEqual({ dom: "in", signal: "in" });
  });

  test("clicking again after a reset still reconciles the whole group", async ({ page }) => {
    await mountForm(page);
    await page.click("#u-in");
    await page.evaluate(() => document.querySelector<HTMLFormElement>("#form")?.reset());

    await page.click("#u-mm");

    const pressed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-slot~='toggle-group-item']")].map((el) => el.getAttribute("aria-pressed")),
    );
    expect(pressed).toEqual(["true", "false", "false"]);
    expect(await agreement(page)).toEqual({ dom: "mm", signal: "mm" });
  });
});

// ─── 4. Widgets inside a web component ───────────────────────────────────────

test.describe("widgets inside a shadow root", () => {
  // Each case attaches its own open shadow root and mounts exactly what that case needs, because
  // what differs between them is *which* half of the boundary problem is under test: delegated
  // dispatch out of the root, or a controller's view of focus inside it.

  test("a delegated click from inside a shadow root routes to the right action", async ({ page }) => {
    const group = BoundToggleGroup({
      type: "single",
      children: ["mm", "cm"].map((value) => BoundToggleGroup.Item({ id: `s-${value}`, bind: "choice", value, action: "pick", children: value })),
    });
    const html = await render(Resumable({ name: "demo", children: group }));
    await mount(page, `<div id="host"></div><template id="source">${html}</template>`, EXPOSE);
    await page.evaluate(() => {
      const host = document.querySelector("#host");
      const template = document.querySelector<HTMLTemplateElement>("#source");
      if (host && template) host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    });
    await start(page);

    await page.evaluate(() => {
      const item = document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("#s-cm");
      item?.click();
    });

    // `event.target` on a composed event reports the **host**, so a dispatcher reading it would look
    // for `[data-on-click]` on `<div id="host">` and find nothing. `composedPath()[0]` reports the
    // button, and `closestAcross` climbs out of the shadow root to reach the scope.
    expect(await page.evaluate(() => window.activations)).toEqual(["s-cm"]);
  });

  test("a Menu mounted inside a shadow root answers the keyboard there", async ({ page }) => {
    const html = await render(
      Menu({
        children: [
          menuTrigger("shadow-menu", "shadow-trigger", "Options"),
          Menu.Popup({
            id: "shadow-menu",
            children: [
              Menu.Item({ id: "s-a", for: "shadow-menu", children: "Alpha" }),
              Menu.Item({ id: "s-b", for: "shadow-menu", children: "Beta" }),
            ],
          }),
        ],
      }),
    );
    await mount(page, `<div id="host"></div><template id="source">${html}</template>`, EXPOSE);
    await page.evaluate(() => {
      const host = document.querySelector("#host");
      const template = document.querySelector<HTMLTemplateElement>("#source");
      if (!host || !template) return;
      const root = host.attachShadow({ mode: "open" });
      root.append(template.content.cloneNode(true));
      // A plain `resume()`, with nothing said about the shadow root: its eager pass descends into
      // open roots, so the Menu scope inside one is discovered like any other.
      window.forgeResume.resume();
    });

    await page.evaluate(() => document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("[data-ref='shadow-trigger']")?.click());

    /** `document.activeElement` stops at the host; the deep walk is the only way to ask. */
    const deepFocus = () => page.evaluate(() => document.querySelector("#host")?.shadowRoot?.activeElement?.id ?? null);
    await expect.poll(deepFocus).toBe("s-a");

    await page.keyboard.press("ArrowDown");
    expect(await deepFocus()).toBe("s-b");
  });

  test("roving focus reports the focused item, not the shadow host", async ({ page }) => {
    await mount(
      page,
      '<div id="host"></div><template id="source"><div id="bar"><button id="t0" data-item>0</button><button id="t1" data-item>1</button></div></template>',
      EXPOSE,
    );
    await page.evaluate(() => {
      const host = document.querySelector("#host");
      const template = document.querySelector<HTMLTemplateElement>("#source");
      if (!host || !template) return;
      const root = host.attachShadow({ mode: "open" });
      root.append(template.content.cloneNode(true));
      const bar = root.querySelector<HTMLElement>("#bar");
      if (bar) window.forgeComposite.mountRovingFocus(bar, { items: "[data-item]" });
    });

    await page.evaluate(() => document.querySelector("#host")?.shadowRoot?.querySelector<HTMLElement>("#t0")?.focus());
    await page.keyboard.press("ArrowRight");

    // "Which item has focus" is the question the controller exists to answer, and bare
    // `document.activeElement` answers "the host" here — which is never a composite item.
    expect(await page.evaluate(() => document.querySelector("#host")?.shadowRoot?.activeElement?.id)).toBe("t1");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("host");
  });
});

// ─── 5. Focus restoration across unmount ─────────────────────────────────────

test.describe("focus restoration when the focused item is removed", () => {
  test("a Toolbar puts focus on a sibling rather than on <body>", async ({ page }) => {
    const html = await render(
      Toolbar({
        children: [
          Toolbar.Button({ id: "tb0", children: "Bold" }),
          Toolbar.Button({ id: "tb1", children: "Italic" }),
          Toolbar.Button({ id: "tb2", children: "Underline" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await page.focus("#tb1");
    await page.evaluate(() => document.querySelector("#tb1")?.remove());

    // At the consumer level, not against a synthetic `<div id="root">` harness: this is the markup a
    // consumer of `core/Toolbar` actually gets, driven through the scope it actually stamps.
    await expect.poll(() => focusedId(page)).toBe("tb2");
  });

  test("a Menu keeps the keyboard inside itself when a row is removed", async ({ page }) => {
    const html = await render(
      Menu({
        children: [
          menuTrigger("shrink-menu", "shrink-trigger", "Options"),
          Menu.Popup({ id: "shrink-menu", children: ["a", "b", "c"].map((k) => Menu.Item({ id: `m-${k}`, for: "shrink-menu", children: k })) }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click(triggerRef("shrink-trigger"));
    await expect.poll(() => focusedId(page)).toBe("m-a");

    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("m-b");
    await page.evaluate(() => document.querySelector("#m-b")?.remove());

    await expect.poll(() => focusedId(page)).toBe("m-c");
    // And the ring still navigates after the removal, rather than being stranded on a stale index.
    await page.keyboard.press("ArrowUp");
    expect(await focusedId(page)).toBe("m-a");
  });
});

// ─── 6. RTL ──────────────────────────────────────────────────────────────────

test.describe("RTL — every composite consumer inherits it and each can break it alone", () => {
  test("a Toolbar's ArrowLeft moves forward under dir=rtl", async ({ page }) => {
    const html = await render(
      Toolbar({
        children: [
          Toolbar.Button({ id: "r0", children: "0" }),
          Toolbar.Button({ id: "r1", children: "1" }),
          Toolbar.Button({ id: "r2", children: "2" }),
        ],
      }),
    );
    await mount(page, `<div dir="rtl">${html}</div>`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await page.focus("#r0");
    await page.keyboard.press("ArrowLeft");
    expect(await focusedId(page)).toBe("r1");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("r0");
  });

  test("a Tabs list's ArrowLeft moves forward under dir=rtl, and the selection follows", async ({ page }) => {
    const html = await render(
      Tabs({
        children: [
          Tabs.List({
            children: [
              Tabs.Tab({ id: "tab-1", for: "panel-1", selected: true, children: "One" }),
              Tabs.Tab({ id: "tab-2", for: "panel-2", children: "Two" }),
            ],
          }),
          Tabs.Panel({ id: "panel-1", selected: true, children: "First" }),
          Tabs.Panel({ id: "panel-2", children: "Second" }),
        ],
      }),
    );
    await mount(page, `<div dir="rtl">${html}</div>`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await page.focus("#tab-1");
    await page.keyboard.press("ArrowLeft");

    expect(await focusedId(page)).toBe("tab-2");
    // Automatic activation rides `focusin`, so a direction bug would move focus and the panel with it.
    expect(await page.evaluate(() => document.querySelector<HTMLElement>("#panel-2")?.hidden)).toBe(false);
  });

  test("a Menu's vertical navigation is unaffected by dir=rtl", async ({ page }) => {
    const html = await render(
      Menu({
        children: [
          menuTrigger("rtl-menu", "rtl-trigger", "Options"),
          Menu.Popup({ id: "rtl-menu", children: ["a", "b"].map((k) => Menu.Item({ id: `rtl-${k}`, for: "rtl-menu", children: k })) }),
        ],
      }),
    );
    await mount(page, `<div dir="rtl">${html}</div>`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click(triggerRef("rtl-trigger"));
    await expect.poll(() => focusedId(page)).toBe("rtl-a");

    await page.keyboard.press("ArrowDown");

    // Direction reverses the horizontal axis and only that. A controller that swapped Up and Down
    // too would make every RTL menu navigate backwards.
    expect(await focusedId(page)).toBe("rtl-b");
  });

  test("direction is read from the widget, so an RTL island inside an LTR page navigates as RTL", async ({ page }) => {
    const html = await render(Toolbar({ children: [Toolbar.Button({ id: "i0", children: "0" }), Toolbar.Button({ id: "i1", children: "1" })] }));
    await mount(page, `<div dir="ltr"><div dir="rtl">${html}</div></div>`, EXPOSE);
    await page.evaluate(() => window.forgeResume.resume());

    await page.focus("#i0");
    await page.keyboard.press("ArrowLeft");

    // Reading direction off a global would answer "ltr" here and move the wrong way.
    expect(await focusedId(page)).toBe("i1");
  });
});
