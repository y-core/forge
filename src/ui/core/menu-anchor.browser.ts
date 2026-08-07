import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

/**
 * **Anchored placement, measured.**
 *
 * Its own file rather than more of `menu.browser.ts`, because this is the only spec in the set that
 * loads a stylesheet. Every other browser spec asserts markup, state and focus with no CSS at all,
 * and that is a deliberate property of theirs worth keeping: it is what makes them immune to a
 * restyle. It is also exactly why this class of defect survived — the anchored block in
 * `theme-base.css` was dead for every surface it named, and a suite that loads no CSS and asserts no
 * geometry structurally cannot see that.
 *
 * Every assertion here is therefore a **box**, not a declaration. `getComputedStyle().positionAnchor`
 * reports the name a rule *declared*, which reads identically whether it resolved against the right
 * element, the wrong one, or nothing at all — so it is worth exactly one case as a typo guard and no
 * more.
 *
 * The stylesheet loads raw, with no Tailwind build: `@theme inline` is discarded as an unknown
 * at-rule, `@layer components` is honoured, and **no utility class resolves**. Fixtures are therefore
 * sized by content and by explicit inline `<style>`, never by a `class`.
 */

const CSS = { css: ["./ui/assets/css/theme-base.css"] };
const CSS_AND_JS = { ...CSS, expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

/** The trigger is put at a known place, and the panels given a size, without any utility class. */
const FIXTURE_STYLE = `<style>
  body { margin: 0; }
  [data-slot~="menu-trigger"], [data-slot~="tooltip-trigger"] { position: fixed; top: 200px; left: 120px; width: 90px; height: 30px; }
  [data-slot~="menu-popup"], [data-slot~="popover-content"] { width: 160px; }
  [data-slot~="menu-item"], [data-slot~="menu-submenu-trigger"] { display: block; width: 100%; height: 36px; }
</style>`;

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Rounded, because sub-pixel layout is not what any of these cases is about. Generic over the key
 * set so a caller reads `box.trigger` as a `Box` rather than as a possibly-missing one. */
function boxes<K extends string>(page: Page, ids: Record<K, string>): Promise<Record<K, Box>> {
  return page.evaluate(
    (map: Record<string, string>) => {
      const out: Record<string, Box> = {};
      for (const [name, selector] of Object.entries(map)) {
        const el = document.querySelector(selector);
        const r = (el as HTMLElement).getBoundingClientRect();
        out[name] = {
          top: Math.round(r.top),
          left: Math.round(r.left),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      }
      return out;
    },
    ids as Record<string, string>,
  ) as Promise<Record<K, Box>>;
}

/** Layout is settled before the read, so a poll is only needed where a controller races it. */
function near(actual: number, expected: number, tolerance = 2): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const GAP = 6; // 0.375rem, the gap every anchored panel keeps from its trigger

test.describe("Menu — anchored to its trigger", () => {
  async function simpleMenu(page: Page, options = CSS): Promise<void> {
    const popup = Menu.Popup({
      id: "file-menu",
      children: [Menu.Item({ id: "new", for: "file-menu", children: "New" }), Menu.Item({ id: "open", for: "file-menu", children: "Open" })],
    });
    const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, options);
  }

  test("opens under its trigger rather than centred in the viewport", async ({ page }) => {
    // **The dead-rule regression.** Asserted positively: "is not centred" would pass for any number
    // of wrong reasons, including a panel that resolved against some entirely unrelated element.
    // Before the explicit `anchor-name` binding this popup computed `position-anchor: normal`, every
    // `anchor()` resolved to nothing, and the UA's `[popover]` default put it in the middle.
    await simpleMenu(page);
    await page.click('[data-slot~="menu-trigger"]');

    const { trigger, popup } = await boxes(page, { trigger: '[data-slot~="menu-trigger"]', popup: "#file-menu" });

    expect(near(popup.top, trigger.bottom + GAP), `popup.top ${popup.top} should be trigger.bottom ${trigger.bottom} + ${GAP}`).toBe(true);
    expect(near(popup.left, trigger.left), `popup.left ${popup.left} should be trigger.left ${trigger.left}`).toBe(true);
  });

  test("declares the anchor name the trigger publishes", async ({ page }) => {
    // The one declaration-level case, and only as a typo guard: this reads the same whether the name
    // resolved against the right element or against nothing.
    await simpleMenu(page);

    const declared = await page.evaluate(() => ({
      trigger: getComputedStyle(document.querySelector('[data-slot~="menu-trigger"]') as HTMLElement).getPropertyValue("anchor-name"),
      popup: getComputedStyle(document.querySelector("#file-menu") as HTMLElement).getPropertyValue("position-anchor"),
      scope: getComputedStyle(document.querySelector('[data-slot~="menu"]') as HTMLElement).getPropertyValue("anchor-scope"),
    }));

    expect(declared).toEqual({ trigger: "--forge-menu", popup: "--forge-menu", scope: "--forge-menu" });
  });

  test("side and align move the panel to the named corner", async ({ page }) => {
    const popup = Menu.Popup({ id: "file-menu", side: "top", align: "end", children: [Menu.Item({ id: "new", for: false, children: "New" })] });
    const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, CSS);
    await page.click('[data-slot~="menu-trigger"]');

    const { trigger, popup: box } = await boxes(page, { trigger: '[data-slot~="menu-trigger"]', popup: "#file-menu" });

    expect(near(box.bottom, trigger.top - GAP), `bottom ${box.bottom} vs trigger.top ${trigger.top} - ${GAP}`).toBe(true);
    expect(near(box.right, trigger.right), `right ${box.right} vs trigger.right ${trigger.right}`).toBe(true);
  });

  test("a coordinate-placed menu ignores the anchored rules entirely", async ({ page }) => {
    // `Menu.Popup` emits `data-side` even with `coords` set, so the anchored selectors really do match
    // this element. They are guarded by `:not([data-coords])` rather than by source order.
    const html = await render(Menu.Popup({ id: "ctx", coords: true, children: [Menu.Item({ id: "cut", for: false, children: "Cut" })] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, { ...CSS, expose: { forgeAnchor: "./ui/client/popover-anchor" } });

    await page.evaluate(() => {
      (window as unknown as { forgeAnchor: typeof import("../client/popover-anchor") }).forgeAnchor.openPopoverAt(
        document.querySelector("#ctx") as HTMLElement,
        300,
        200,
      );
    });

    const { popup } = await boxes(page, { popup: "#ctx" });
    expect({ top: popup.top, left: popup.left }).toEqual({ top: 200, left: 300 });
  });
});

test.describe("Menu — submenu anchoring", () => {
  /** A panel with **two** submenu triggers, far enough apart that their `top` differs. This is the
   * case that decided the design: naming the rows binds every open submenu to the *last* trigger in
   * the panel, because an open popup is in the top layer and the resolution algorithm then treats
   * every candidate as laid out before it. Naming the parent panel moves the lookup onto the ancestor
   * branch, where the nearest match wins. */
  async function twoSubmenus(page: Page, options: Record<string, unknown> = CSS): Promise<void> {
    const sub = (id: string, label: string) =>
      Menu.Popup({ id, side: "right", children: [Menu.Item({ id: `${id}-row`, for: false, children: label })] });
    const popup = Menu.Popup({
      id: "file-menu",
      children: [
        Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent" }),
        sub("recent-menu", "alpha"),
        Menu.Item({ id: "spacer1", for: false, children: "Spacer" }),
        Menu.Item({ id: "spacer2", for: false, children: "Spacer" }),
        Menu.Item({ id: "spacer3", for: false, children: "Spacer" }),
        Menu.SubmenuTrigger({ id: "export-menu", children: "Export" }),
        sub("export-menu", "beta"),
      ],
    });
    const html = await render(Menu({ children: [Menu.Trigger({ id: "file-menu", children: "File" }), popup] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, options);
  }

  const SELECTORS = {
    panel: "#file-menu",
    triggerA: '[commandfor="recent-menu"]',
    triggerB: '[commandfor="export-menu"]',
    subA: "#recent-menu",
    subB: "#export-menu",
  };

  test("without JavaScript, a submenu pins to the panel edge — and not to the other trigger's row", async ({ page }) => {
    // The CSS-only floor. Coarse on purpose: top-aligned to the panel rather than to the row. What it
    // must *not* be is the second trigger's row, which is what row-naming produced for every submenu
    // but the last.
    await twoSubmenus(page);
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    const box = await boxes(page, SELECTORS);

    expect(box.triggerA.top, "the fixture must place the two rows apart for this case to mean anything").not.toBe(box.triggerB.top);
    expect(near(box.subA.left, box.panel.right + GAP), `subA.left ${box.subA.left} vs panel.right ${box.panel.right} + ${GAP}`).toBe(true);
    expect(near(box.subA.top, box.panel.top), `subA.top ${box.subA.top} vs panel.top ${box.panel.top}`).toBe(true);
    expect(box.subA.top, "bound to the wrong trigger's row — the row-named failure this design avoids").not.toBe(box.triggerB.top);
  });

  test("with the client bundle, each submenu is row-accurate", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    // Polled: `mountAnchorBinding` writes on `beforetoggle`, so the binding lands before the first
    // paint, but the read here can still race the layout that follows it.
    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    const box = await boxes(page, SELECTORS);
    expect(near(box.subA.left, box.triggerA.right + GAP), `subA.left ${box.subA.left} vs triggerA.right ${box.triggerA.right}`).toBe(true);
  });

  test("the second submenu binds to its own row, not to the first", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerB);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subB.top, box.triggerB.top);
      })
      .toBe(true);

    const box = await boxes(page, SELECTORS);
    expect(box.subB.top, "bound to the other trigger's row").not.toBe(box.triggerA.top);
  });

  test("re-opening reuses the minted name rather than growing the list", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');

    const names: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await page.click(SELECTORS.triggerA);
      names.push(
        await page.evaluate(() => (document.querySelector('[commandfor="recent-menu"]') as HTMLElement).style.getPropertyValue("anchor-name")),
      );
      await page.keyboard.press("Escape");
    }

    // One name, and the same one each time: without the `WeakMap` the list grows by one per opening.
    expect(new Set(names).size, `anchor-name changed between openings: ${names.join(" | ")}`).toBe(1);
    expect(names[0]?.split(",").length).toBe(1);
  });
});

test.describe("Menu — a composed trigger anchors both of its compounds", () => {
  test("a tooltip wrapping a menu trigger keeps both anchor names", async ({ page }) => {
    // The only case that catches the `anchor-name` cascade collision. `anchor-name` is one
    // declaration rather than a set that unions across rules, so two rules each naming this button
    // would let the cascade pick one — and the menu, declared earlier, would lose. It fails without
    // both the `data-slot` token merge and the explicit pair rule.
    const trigger = Tooltip.Trigger({ id: "file", for: "file-tip", asChild: true, children: Menu.Trigger({ id: "file-menu", children: "File" }) });
    const popup = Menu.Popup({ id: "file-menu", children: [Menu.Item({ id: "new", for: false, children: "New" })] });
    const html = await render(
      Menu({ children: [Tooltip({ children: [trigger, Tooltip.Content({ id: "file-tip", children: "Open the File menu" })] }), popup] }),
    );
    await mount(page, `${FIXTURE_STYLE}${html}`, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());

    const slot = await page.evaluate(() => document.querySelector("#file")?.getAttribute("data-slot"));
    expect(slot?.split(" ").sort()).toEqual(["menu-trigger", "tooltip-trigger"]);

    // The tooltip first, on hover — `mountTooltip` opens on `pointerenter` after its show delay, and
    // its `focusin` path is gated on `:focus-visible`, which a click does not produce.
    await page.hover("#file");
    await expect.poll(() => page.evaluate(() => document.querySelector("#file-tip")?.matches(":popover-open"))).toBe(true);

    // `Tooltip.Content` defaults to side="top" align="center".
    const tipBox = await boxes(page, { trigger: "#file", tip: "#file-tip" });
    expect(near(tipBox.tip.bottom, tipBox.trigger.top - GAP), "the tooltip is centred — it lost its anchor to the menu rule").toBe(true);
    expect(near(tipBox.tip.left + tipBox.tip.width / 2, tipBox.trigger.left + tipBox.trigger.width / 2)).toBe(true);

    await page.click("#file");
    const menuBox = await boxes(page, { trigger: "#file", popup: "#file-menu" });
    expect(near(menuBox.popup.top, menuBox.trigger.bottom + GAP), "the menu lost its anchor to the tooltip rule").toBe(true);
    expect(near(menuBox.popup.left, menuBox.trigger.left)).toBe(true);
  });
});
