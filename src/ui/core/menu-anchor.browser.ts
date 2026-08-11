import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { Navbar, type NavDefinition } from "../chrome/navbar";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "./icon";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

/**
 * **Anchored placement, measured.**
 *
 * Its own file rather than more of `menu.browser.ts`, because this is the only spec in the set that
 * loads a stylesheet. Every other browser spec asserts markup, state and focus with no CSS at all,
 * and that is a deliberate property of theirs worth keeping: it is what makes them immune to a
 * restyle. It is also exactly why this class of defect survived — the anchored block in
 * `forge-ui.css` was dead for every surface it named, and a suite that loads no CSS and
 * asserts no geometry structurally cannot see that.
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

declare global {
  interface Window {
    /** Teardown returned by `resume()`, parked so a later evaluate can dispose every mounted scope. */
    forgeScopeTeardown?: () => void;
  }
}

/** The component rules and nothing else: every case here measures a box, and the anchor bindings and
 * the `side` × `align` placement rules are all in that one file. No case reads a colour, so neither
 * token sheet is loaded. */
const CSS = { css: ["./ui/assets/css/forge-ui.css"] };
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
        const el = document.querySelector<HTMLElement>(selector);
        // Named rather than left to throw on the next line. A case that removes an element and then
        // asks for its box otherwise fails with `null.getBoundingClientRect` deep inside the
        // evaluate, naming neither the key nor the selector that went missing.
        if (!el) throw new Error(`boxes: no element matched ${name} (${selector})`);
        const r = el.getBoundingClientRect();
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

/**
 * **The light-dismiss guard, driven by a real right-click.**
 *
 * Here for the same reason the block above is: it only reproduces with the stylesheet loaded. Without
 * it the coordinate rule never applies, the popup falls back to the UA's centred `[popover]` box —
 * which lands *under* the pointer — and the release therefore hits the panel rather than the surface,
 * so the dismiss pass finds a popover ancestor, declines to match, and the menu survives for a reason
 * the shipped page does not have. Placed at the point, the panel is beside the cursor, the release
 * lands on the surface, and the defect is visible.
 *
 * Both halves are asserted. The unguarded case is what makes the guarded one mean anything: if the
 * platform ever stops dismissing here, the first case starts passing for free and only the second
 * will say so.
 */
test.describe("a context menu against the platform's light-dismiss pass", () => {
  /**
   * A surface whose `contextmenu` opens a coordinate-placed menu, guarded or not.
   *
   * The corner radius is restated, because it is what decides the hit test. `Menu.Popup` ships
   * `rounded-xl`, and no utility resolves under the harness — square corners would put the release
   * point *on* the panel's top-left pixel, the dismiss pass would find a popover ancestor there and
   * decline to match, and the unguarded case below would pass for a reason the real page does not
   * have. Rounded, the point at the corner is outside the panel, exactly as it is for a reader.
   */
  async function contextFixture(page: Page, guard: boolean): Promise<void> {
    const html = await render(Menu.Popup({ id: "ctx", coords: true, children: [Menu.Item({ id: "cut", for: false, children: "Cut" })] }));
    const surface = '<div id="surface" style="position:fixed;top:0;left:0;width:400px;height:300px">surface</div>';
    const radius = '<style>[data-slot~="menu-popup"] { border-radius: 0.75rem }</style>';
    await mount(page, `${FIXTURE_STYLE}${radius}${surface}${html}`, { ...CSS, expose: { forgeAnchor: "./ui/client/popover-anchor" } });
    await page.evaluate((guarded: boolean) => {
      const popup = document.querySelector("#ctx") as HTMLElement;
      document.querySelector("#surface")?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const { clientX, clientY, buttons } = event as MouseEvent;
        (window as unknown as { forgeAnchor: typeof import("../client/popover-anchor") }).forgeAnchor.openPopoverAt(popup, clientX, clientY, {
          afterPointerUp: guarded && buttons !== 0,
        });
      });
    }, guard);
  }

  const isOpen = (page: Page) => page.evaluate(() => document.querySelector("#ctx")?.matches(":popover-open") === true);

  test("stays open past the release of the button that opened it", async ({ page }) => {
    await contextFixture(page, true);
    await page.mouse.click(150, 120, { button: "right" });

    expect(await isOpen(page)).toBe(true);
    // Placed at the point, not merely open: a guard that opened the menu somewhere else would pass a
    // bare open check while putting the panel nowhere near the cursor that asked for it.
    const { popup } = await boxes(page, { popup: "#ctx" });
    expect({ top: popup.top, left: popup.left }).toEqual({ top: 120, left: 150 });
  });

  test("without the guard, the same right-click dismisses it immediately", async ({ page }) => {
    await contextFixture(page, false);
    await page.mouse.click(150, 120, { button: "right" });

    expect(await isOpen(page)).toBe(false);
  });

  test("a later click still light-dismisses the guarded menu", async ({ page }) => {
    // The other side of `once`: the guard belongs to the gesture that armed it, and an ordinary
    // dismissal afterwards has to keep working — a menu that cannot be clicked away is a worse bug
    // than the one being fixed.
    await contextFixture(page, true);
    await page.mouse.click(150, 120, { button: "right" });
    expect(await isOpen(page)).toBe(true);

    await page.mouse.click(350, 260);
    expect(await isOpen(page)).toBe(false);
  });
});

/** A panel with **two** submenu triggers, far enough apart that their `top` differs. This is the
 * case that decided the design: naming the rows binds every open submenu to the *last* trigger in
 * the panel, because an open popup is in the top layer and the resolution algorithm then treats
 * every candidate as laid out before it. Naming the parent panel moves the lookup onto the ancestor
 * branch, where the nearest match wins.
 *
 * `extraStyle` is appended after {@link FIXTURE_STYLE} and before the markup, for the one case that
 * needs a transition of its own — unlayered, so it beats the sheet's `@layer components` rules. */
async function twoSubmenus(page: Page, options: Record<string, unknown> = CSS, extraStyle = ""): Promise<void> {
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
  await mount(page, `${FIXTURE_STYLE}${extraStyle}${html}`, options);
}

const SELECTORS = {
  panel: "#file-menu",
  triggerA: '[commandfor="recent-menu"]',
  triggerB: '[commandfor="export-menu"]',
  subA: "#recent-menu",
  subB: "#export-menu",
};

test.describe("Menu — submenu anchoring", () => {
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
    // **The last observation, not the first.** `names[0]` is the value after the *first* opening,
    // which is a single name by construction whatever the code does — the membership guard in
    // `mountAnchorBinding` has not yet had an earlier list to read back. Delete that guard and the
    // three inline values become one name, then two, then three; only this read sees it.
    expect(names.at(-1)?.split(",").length, `the list grew across openings: ${names.join(" | ")}`).toBe(1);
  });
});

/** A non-zero exit transition for the second submenu, with `display` and `overlay` allowed to
 * transition discretely — which is what keeps the panel **painted and in the top layer** while it
 * fades, and therefore what makes a mid-exit frame measurable at all. The shipped sheet declares no
 * transition (the components carry Tailwind utilities, and none resolve under this harness), so the
 * fade has to be supplied here. */
const FADE_STYLE = `<style>
  #export-menu { opacity: 0; transition: opacity 400ms linear, display 400ms allow-discrete, overlay 400ms allow-discrete; }
  #export-menu:popover-open { opacity: 1; }
</style>`;

/** One sampled frame of a closing panel: its box, whether the popover is still open, and the opacity
 * that says whether the exit transition was actually running when the frame was taken. */
interface ExitFrame {
  top: number;
  left: number;
  height: number;
  open: boolean;
  opacity: number;
}

/**
 * **What a *later* open inherits from an earlier one.**
 *
 * Every case above measures the open that *wrote* the two inline declarations `mountAnchorBinding`
 * owns — `position-anchor` on the popup, `anchor-name` on the row. These measure the opens after it:
 * one that resolves no trigger, one that has since become coordinate-placed, and one from a different
 * row than last time.
 *
 * A stale inline `position-anchor` is strictly worse than none. It names an element no longer on the
 * page, so every `anchor()` in the placement matrix resolves to nothing and the UA's `[popover]`
 * default centres the panel — where dropping the declaration falls back to the stylesheet's
 * coarse-but-correct panel binding, exactly what the disposer already goes to lengths to leave
 * behind.
 */
test.describe("Menu — a submenu re-opened after its first binding", () => {
  test("an open that resolves no trigger drops the dead name and falls back to the panel binding", async ({ page }) => {
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    // The stale declaration, named before it is stale — read from `el.style` rather than from the
    // cascade, because the inline write is the thing that outlives the trigger. Without this the case
    // below could pass on a first open that wrote nothing at all.
    const bound = await page.evaluate(() => (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"));
    expect(bound, "the first open wrote no inline anchor, so there is nothing stale to clear").toBe("--forge-anchor-1");

    // Close, take the row away, and re-open the popup **programmatically**. Both halves matter: with
    // no `[commandfor]` left, `triggersFor` returns `[]` and the handler reaches its no-trigger
    // return, which is the branch under test.
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.querySelector('[commandfor="recent-menu"]')?.remove();
      (document.querySelector("#recent-menu") as HTMLElement).showPopover();
    });

    // **Measured without the row, because the row is the thing the case removed.** The fallback under
    // test is expressed entirely in the panel's box and the popup's — `subA.top ≈ panel.top` and
    // `subA.left ≈ panel.right + GAP` — and asking for `triggerA` here would only be asking for the
    // element whose absence *is* the arrangement.
    const remaining = { panel: SELECTORS.panel, subA: SELECTORS.subA };

    await expect
      .poll(async () => {
        const box = await boxes(page, remaining);
        return near(box.subA.top, box.panel.top) && near(box.subA.left, box.panel.right + GAP);
      })
      .toBe(true);

    const box = await boxes(page, remaining);
    const after = await page.evaluate(() => (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"));

    expect(after, "the dead name survived the open").toBe("");
    expect(near(box.subA.top, box.panel.top), `subA.top ${box.subA.top} vs panel.top ${box.panel.top}`).toBe(true);
    expect(near(box.subA.left, box.panel.right + GAP), `subA.left ${box.subA.left} vs panel.right ${box.panel.right} + ${GAP}`).toBe(true);
  });

  test("a closing submenu stays on its own row for every frame it is still painted", async ({ page }) => {
    // **The ordering case, and the reason the `newState !== "open"` return sits *above* the clear.**
    // Move the clear above it and a panel still fading out loses its anchor mid-exit, visibly jumping
    // while the user watches. A single post-close sample cannot see that — by then the panel is gone —
    // so this samples every animation frame of the exit and asserts all of them.
    //
    // `export-menu`, not `recent-menu`: the first row of the panel sits at the panel's own top edge
    // and spans its full width, so for that row "anchored to the row" and "anchored to the panel" are
    // the same box and no drift could be measured. The sixth row is five rows lower.
    await twoSubmenus(page, CSS_AND_JS, FADE_STYLE);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerB);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subB.top, box.triggerB.top);
      })
      .toBe(true);

    const before = await boxes(page, SELECTORS);
    expect(before.triggerB.top, "the row and the panel share a top edge — nothing here could drift").not.toBe(before.panel.top);

    // Closed and sampled inside one evaluate, so the first frame of the exit is not missed.
    const frames = await page.evaluate(
      () =>
        new Promise<ExitFrame[]>((resolve) => {
          const sub = document.querySelector("#export-menu") as HTMLElement;
          const out: ExitFrame[] = [];
          sub.hidePopover();
          const tick = () => {
            const rect = sub.getBoundingClientRect();
            out.push({
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              height: Math.round(rect.height),
              open: sub.matches(":popover-open"),
              opacity: Number(getComputedStyle(sub).opacity),
            });
            if (out.length < 12) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );

    // Painted but no longer open: the frames the transition owns, and the only ones worth asserting.
    const exiting = frames.filter((frame) => !frame.open && frame.height > 0);
    expect(exiting.length, `no frame caught the panel mid-exit: ${JSON.stringify(frames)}`).toBeGreaterThan(0);
    expect(
      exiting.some((frame) => frame.opacity > 0 && frame.opacity < 1),
      `the exit transition never ran, so no frame could have caught a drift: ${JSON.stringify(exiting)}`,
    ).toBe(true);

    for (const frame of exiting) {
      expect(near(frame.top, before.triggerB.top), `frame at opacity ${frame.opacity}: top ${frame.top} vs row ${before.triggerB.top}`).toBe(true);
      expect(
        near(frame.left, before.triggerB.right + GAP),
        `frame at opacity ${frame.opacity}: left ${frame.left} vs row right ${before.triggerB.right} + ${GAP}`,
      ).toBe(true);
    }
  });

  test("a coordinate open after an anchored one honours the coordinates and keeps no residual anchor", async ({ page }) => {
    // The mirror of the case above: a popup that *gains* coordinates after an anchored open. The
    // `data-coords` return sits below the clear, so the inline anchor goes even though nothing
    // replaces it.
    const options = { ...CSS_AND_JS, expose: { ...CSS_AND_JS.expose, forgeAnchor: "./ui/client/popover-anchor" } };
    await twoSubmenus(page, options);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    await page.evaluate(() => {
      (window as unknown as { forgeAnchor: typeof import("../client/popover-anchor") }).forgeAnchor.openPopoverAt(
        document.querySelector("#recent-menu") as HTMLElement,
        300,
        220,
      );
    });

    const box = await boxes(page, SELECTORS);
    expect({ top: box.subA.top, left: box.subA.left }).toEqual({ top: 220, left: 300 });

    // Re-opened, now carrying `data-coords`. **Geometry cannot establish this half**: every anchored
    // selector is guarded by `:not([data-coords])`, so the coordinate rule would win over a residual
    // name too and the box would read correct either way. The inline declaration is the subject here,
    // so the inline declaration is the assertion.
    const reopened = await page.evaluate(() => {
      const el = document.querySelector("#recent-menu") as HTMLElement;
      el.hidePopover();
      el.showPopover();
      const rect = el.getBoundingClientRect();
      return { anchor: el.style.getPropertyValue("position-anchor"), top: Math.round(rect.top), left: Math.round(rect.left) };
    });
    expect(reopened).toEqual({ anchor: "", top: 220, left: 300 });
  });

  test("re-opening from a different row unwinds the previous one, so at most one trigger is retained", async ({ page }) => {
    // The retention bound, asserted through what it costs the DOM: `anchored` holds exactly one
    // element, so the row that loses first-in-document-order must lose its inline `anchor-name` too.
    //
    // **Two invokers for one popup, not two popups.** `mountAnchorBinding` is mounted per popup, so
    // `recent-menu`'s controller and `export-menu`'s share no state and neither could ever unwind the
    // other's row — a case built from `triggerA` and `triggerB` would assert nothing.
    await twoSubmenus(page, CSS_AND_JS);
    await page.evaluate(() => {
      window.forgeScopeTeardown = window.forgeResume.resume();
    });
    await page.click('[data-slot~="menu-trigger"]');
    await page.click(SELECTORS.triggerA);

    await expect
      .poll(async () => {
        const box = await boxes(page, SELECTORS);
        return near(box.subA.top, box.triggerA.top);
      })
      .toBe(true);

    // Rows rebuilt between openings — the scenario both doc comments name. A second invoker for the
    // same popup inserted *before* the first is what makes the next open resolve a different trigger,
    // since the handler takes the first in document order.
    const rebuilt = await render(Menu.SubmenuTrigger({ id: "recent-menu", children: "Recent again" }));
    await page.keyboard.press("Escape");
    await page.evaluate((html) => {
      document.querySelector('[commandfor="recent-menu"]')?.insertAdjacentHTML("beforebegin", html);
    }, rebuilt);
    await page.locator(SELECTORS.triggerA).first().click();

    const after = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[commandfor="recent-menu"]')];
      const fresh = rows[0];
      const previous = rows[1];
      return {
        rows: rows.length,
        fresh: fresh?.style.getPropertyValue("anchor-name") ?? "",
        previousInline: previous?.style.getPropertyValue("anchor-name") ?? "",
        previousDeclared: previous ? getComputedStyle(previous).getPropertyValue("anchor-name") : "",
        popup: (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"),
      };
    });

    // Two names minted on this page, one per row that has been first in document order. The counter is
    // module state in this page's own bundle, so the values are exact rather than merely shaped —
    // and `previousInline: ""` beside a *non-empty* `fresh` is what stops the pair passing for a
    // controller that writes nothing at all. `none` is the initial value of `anchor-name`: the
    // stylesheet gives a submenu row no name of its own, so the unwind leaves it with none.
    expect(after).toEqual({ rows: 2, fresh: "--forge-anchor-2", previousInline: "", previousDeclared: "none", popup: "--forge-anchor-2" });

    // Disposal leaves nothing inline on either row or on the popup, which is what makes the
    // stylesheet's panel binding the resting state of a torn-down menu.
    await page.evaluate(() => window.forgeScopeTeardown?.());
    const disposed = await page.evaluate(() => ({
      rows: [...document.querySelectorAll<HTMLElement>('[commandfor="recent-menu"]')].map((row) => row.style.getPropertyValue("anchor-name")),
      popup: (document.querySelector("#recent-menu") as HTMLElement).style.getPropertyValue("position-anchor"),
    }));
    expect(disposed).toEqual({ rows: ["", ""], popup: "" });
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

// ─── The logical inline sides, measured in both directions ───────────────────

/**
 * **`side="inline-end"` resolves against the subtree's own direction, and nothing upstream of the
 * CSS knows which direction that is.**
 *
 * Driven through `Navbar` rather than through a hand-built `Menu`, because `Navbar` is the compound
 * that actually passes the logical side — a fixture that spelled `inline-end` itself would keep
 * passing after the component stopped emitting it.
 */
const NAV_ICON = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-hamburger": "0 0 22 22", "icon-close": "0 0 22 22" });

/** One bar menu holding one nested submenu, so the submenu row is also the panel's *first* row and
 * the opening focus lands on it with no arrow keys in between. */
const NAV_CONFIG: NavDefinition = {
  sections: [{ items: [{ label: "File", items: [{ label: "Recent", items: [{ label: "Yesterday", href: "yesterday" }] }] }] }],
};

/** `id` fixes the generated menu ids: `navbar-menu-geo-0` is the bar panel, `-1` the submenu. */
function renderNavbar(): Promise<string> {
  return render(Navbar({ config: NAV_CONFIG, resolveHref: (key: string) => `/${key}`, icon: NAV_ICON, id: "geo" }));
}

/**
 * **The trigger is centred, not at {@link FIXTURE_STYLE}'s `left: 120px`.** A 160px panel opening
 * inline-start of a panel that starts 120px from the viewport edge does not fit, `flip-inline` fires,
 * and what RTL then measures is the fallback rather than the rule under test — the same box the LTR
 * rule would have produced, which is precisely the reading this suite must not accept.
 */
const CENTRED_TRIGGER = `<style>[data-slot~="menu-trigger"] { left: 595px; }</style>`;

/**
 * **The discriminator.** `flip-inline` produces *exactly* the box the opposite rule would, so
 * geometry alone cannot tell a working `:dir()` rule from a flipped LTR one. Disabling the fallback
 * list and getting a byte-identical box is what proves the placement came from the rule. Unlayered,
 * so it beats the sheet's `@layer components` declaration.
 */
const NO_FALLBACK_STYLE = `<style>[data-slot~="menu-popup"] { position-try-fallbacks: none; }</style>`;

/** An LTR document with one `dir`-bearing island — the arrangement the logical sides exist for,
 * where the root's direction is not the subtree's. */
function inDirection(dir: "ltr" | "rtl", html: string, extraStyle = ""): string {
  return `${FIXTURE_STYLE}${CENTRED_TRIGGER}${extraStyle}<div dir="${dir}">${html}</div>`;
}

const NAV = {
  trigger: '[data-slot~="menu-trigger"]',
  panel: "#navbar-menu-geo-0",
  row: '[data-slot~="menu-submenu-trigger"]',
  sub: "#navbar-menu-geo-1",
};

/** The bar collapses to a closed `<details>` on mobile, and no Tailwind utility resolves under this
 * harness to expand it — so the disclosure is opened directly. Nothing about placement depends on
 * which of the two layouts is showing. */
function revealBar(page: Page): Promise<void> {
  return page.evaluate(() => {
    (document.querySelector("details") as HTMLDetailsElement).open = true;
  });
}

/** `inline-end` named physically, per direction: the edge the panel's text *ends* at. */
function expectOnInlineEnd(dir: "ltr" | "rtl", sub: Box, anchor: Box): void {
  if (dir === "ltr") {
    expect(near(sub.left, anchor.right + GAP), `ltr: sub.left ${sub.left} vs anchor.right ${anchor.right} + ${GAP}`).toBe(true);
    return;
  }
  expect(near(sub.right, anchor.left - GAP), `rtl: sub.right ${sub.right} vs anchor.left ${anchor.left} - ${GAP}`).toBe(true);
}

test.describe("Menu — a logical side is resolved by CSS, not by the server", () => {
  test("one SSR string mounted under both directions reads data-side=inline-end in each", async ({ page }) => {
    // **Rendered once, mounted twice.** Rendering per direction would leave open the possibility that
    // the Worker inspected something and stamped a direction-specific value; one string cannot have.
    const html = await renderNavbar();
    const observed: Record<string, { side: string | null; direction: string }> = {};

    for (const dir of ["ltr", "rtl"] as const) {
      await mount(page, inDirection(dir, html), CSS);
      observed[dir] = await page.evaluate(() => {
        const el = document.querySelector("#navbar-menu-geo-1") as HTMLElement;
        return { side: el.getAttribute("data-side"), direction: getComputedStyle(el).direction };
      });
    }

    // The `direction` half is what stops this passing vacuously: the two mounts really did resolve to
    // different directions, and the attribute still read the same literal in both.
    expect(observed).toEqual({ ltr: { side: "inline-end", direction: "ltr" }, rtl: { side: "inline-end", direction: "rtl" } });
  });
});

test.describe("Menu — inline-end mirrors with the subtree direction, in CSS alone", () => {
  /** Pointer-driven and stylesheet-only: no client bundle, so this is the no-JavaScript floor where
   * the submenu pins to the *panel* rather than to its row. */
  async function openNested(page: Page, dir: "ltr" | "rtl", html: string, extraStyle = ""): Promise<Record<keyof typeof NAV, Box>> {
    await mount(page, inDirection(dir, html, extraStyle), CSS);
    await revealBar(page);
    await page.click(NAV.trigger);
    await page.click(NAV.row);
    return boxes(page, NAV);
  }

  for (const dir of ["ltr", "rtl"] as const) {
    test(`dir=${dir}: the submenu opens on the panel's inline-end edge`, async ({ page }) => {
      const html = await renderNavbar();
      const box = await openNested(page, dir, html);

      expectOnInlineEnd(dir, box.sub, box.panel);
      // **Not padding.** An over-eager mirroring that flipped *both* axes would satisfy the inline
      // assertion above perfectly; only the block axis staying put catches it.
      expect(near(box.sub.top, box.panel.top), `${dir}: sub.top ${box.sub.top} vs panel.top ${box.panel.top}`).toBe(true);

      // The same arrangement with the fallback list removed. An identical box means no `flip-inline`
      // was involved and the placement is the rule's own answer.
      const control = await openNested(page, dir, html, NO_FALLBACK_STYLE);
      expect(control, `${dir}: a position-try fallback was supplying the placement`).toEqual(box);
    });
  }
});

/**
 * **Keys and placement, established in one run.**
 *
 * The defect this task fixes is that the two disagreed — the keyboard mirrored with direction and the
 * placement did not — so a spec that opened the submenu in one test and measured it in another could
 * pass while they still disagreed. The press and the measurement are therefore the same page state.
 */
test.describe("Menu — the key that opens a submenu and the edge it opens on agree", () => {
  const CSS_AND_CHROME_JS = { ...CSS_AND_JS, expose: { ...CSS_AND_JS.expose, forgeChromeClient: "./ui/chrome/client" } };

  /** The same table `menu.browser.ts` drives its key cases from: the key pointing *at* the submenu. */
  const TOWARD = [
    { dir: "ltr", toward: "ArrowRight" },
    { dir: "rtl", toward: "ArrowLeft" },
  ] as const;

  for (const { dir, toward } of TOWARD) {
    test(`dir=${dir}: ${toward} opens the submenu, and the panel appears on that same edge`, async ({ page }) => {
      await mount(page, inDirection(dir, await renderNavbar()), CSS_AND_CHROME_JS);
      await revealBar(page);
      await page.evaluate(() => window.forgeResume.resume());
      await page.click(NAV.trigger);
      // The submenu row is the panel's only row, so the opening focus lands on it directly. The row is
      // rendered by `Navbar` rather than by this fixture, so the read is parsed to its token list and
      // the row's own token asked for by name — a further chrome-supplied token is not this case's
      // business, and must not turn "focus landed on the row" into a failure.
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-slot")?.split(" ") ?? []))
        .toContain("menu-submenu-trigger");

      await page.keyboard.press(toward);

      await expect.poll(() => page.evaluate(() => document.querySelector("#navbar-menu-geo-1")?.matches(":popover-open") ?? false)).toBe(true);

      // Read after the same press that opened it — with the client bundle the submenu is row-accurate,
      // so the row is the anchor, and the block axis must still not have mirrored.
      const box = await boxes(page, NAV);
      expectOnInlineEnd(dir, box.sub, box.row);
      expect(near(box.sub.top, box.row.top), `${dir}: sub.top ${box.sub.top} vs row.top ${box.row.top}`).toBe(true);
    });
  }
});
