import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Tooltip } from "./tooltip";

/**
 * `Tooltip` — the accessibility contract most implementations get wrong, pinned here.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

test.describe("Tooltip", () => {
  const markup = () =>
    render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
          Tooltip.Content({ id: "save-tip", children: "Writes the file to disk" }),
        ],
      }),
    );

  function isShown(page: Page): Promise<boolean> {
    return page.evaluate(() => document.querySelector("#save-tip")?.matches(":popover-open") ?? false);
  }

  test("describes its trigger rather than labelling it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);

    const wiring = await page.evaluate(() => {
      const trigger = document.querySelector("#save");
      const tip = document.querySelector("#save-tip");
      return {
        describedby: trigger?.getAttribute("aria-describedby"),
        labelledby: trigger?.getAttribute("aria-labelledby"),
        role: tip?.getAttribute("role"),
      };
    });

    expect(wiring).toEqual({ describedby: "save-tip", labelledby: null, role: "tooltip" });
  });

  test("is never focusable", async ({ page }) => {
    await mount(page, `${await markup()}<button id="after">after</button>`, EXPOSE);
    await start(page);

    const hasTabindex = await page.evaluate(() => document.querySelector("#save-tip")?.hasAttribute("tabindex"));
    expect(hasTabindex).toBe(false);

    await page.focus("#save");
    await page.keyboard.press("Tab");
    // Tab skips straight past the tooltip: a focusable tooltip is a keyboard trap.
    expect(await focusedId(page)).toBe("after");
  });

  test("opens on keyboard focus", async ({ page }) => {
    await mount(page, `<button id="before">b</button>${await markup()}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");

    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);
  });

  test("opens on hover and closes when the pointer leaves", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.hover("#save");
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);

    await page.mouse.move(0, 0);
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(false);
  });

  test("closes on Escape", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.hover("#save");
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);

    await page.keyboard.press("Escape");

    await expect.poll(() => isShown(page)).toBe(false);
  });

  test("publishes its open state for CSS", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.hover("#save");
    await expect.poll(() => page.evaluate(() => document.querySelector("#save-tip")?.hasAttribute("data-open")), { timeout: 3000 }).toBe(true);
  });
});

// ─── Tooltips across a shadow boundary ───────────────────────────────────────

/** Which tree a case reads its markup out of — the light document, or the host's open shadow root. */
type Tree = "light" | "shadow";

/**
 * Whether the tip is open, read out of whichever tree the case mounted into.
 *
 * **Opening is the falsifiable difference, and nothing weaker will do.** `mountTooltip` resolves its
 * content from the trigger's own `aria-describedby`; a document-scoped lookup answers `null` for an
 * id that lives in a shadow tree, the `if (!trigger || !content)` guard returns the no-op disposer,
 * and **no listener is ever bound**. Every ARIA-wiring assertion in this file is served by SSR alone
 * and stays green through that, so only a tip that actually appears distinguishes the two.
 */
function isShownIn(page: Page, tree: Tree): Promise<boolean> {
  return page.evaluate((where) => {
    const root: ParentNode | null | undefined = where === "shadow" ? document.querySelector("#host")?.shadowRoot : document;
    if (!root) throw new Error("no tree to read: the shadow root was never attached");
    return root.querySelector("#save-tip")?.matches(":popover-open") ?? false;
  }, tree);
}

test.describe("Tooltip — inside a shadow root", () => {
  const markup = () =>
    render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
          Tooltip.Content({ id: "save-tip", children: "Writes the file to disk" }),
        ],
      }),
    );

  /** Attach the template's contents to a shadow root, then resume — whose eager pass descends into
   * open roots at any depth, so a tooltip scope inside one is discovered like any other. */
  async function attachAndResume(page: Page, hostSelector: string): Promise<void> {
    await page.evaluate((selector) => {
      const host = document.querySelector(selector);
      const template = document.querySelector<HTMLTemplateElement>("#source");
      if (!host || !template) return;
      host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
      window.forgeResume.resume();
    }, hostSelector);
  }

  test("a tooltip inside an open shadow root still opens on hover and closes on Escape", async ({ page }) => {
    await mount(page, `<div id="host"></div><template id="source">${await markup()}</template>`, EXPOSE);
    await attachAndResume(page, "#host");

    // Asserted, not assumed: it is the precondition that makes this case about a shadow boundary at
    // all. With the content id visible to the document, a document-scoped lookup would pass too.
    expect(await page.evaluate(() => document.getElementById("save-tip") === null)).toBe(true);
    expect(await isShownIn(page, "shadow")).toBe(false);

    await page.hover("#save");
    await expect.poll(() => isShownIn(page, "shadow"), { timeout: 3000 }).toBe(true);

    // The keydown listener sits on the owner document and is bound by the same guarded block, so it
    // is dead in exactly the same way when the content does not resolve.
    await page.keyboard.press("Escape");

    await expect.poll(() => isShownIn(page, "shadow")).toBe(false);
  });

  test("the identical markup in the light DOM opens on hover and closes on Escape", async ({ page }) => {
    // The parity half. Without it a regression that broke the ordinary document path could hide
    // behind a green shadow case, because the shadow lookup and the document lookup are one call.
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await isShownIn(page, "light")).toBe(false);

    await page.hover("#save");
    await expect.poll(() => isShownIn(page, "light"), { timeout: 3000 }).toBe(true);

    await page.keyboard.press("Escape");

    await expect.poll(() => isShownIn(page, "light")).toBe(false);
  });
});

/**
 * **Placement, measured.** The first coverage the tooltip's twelve `side` × `align` rules have ever
 * had: the suite loads no CSS anywhere else, so nothing until now could tell a resolved `anchor()`
 * from one that silently evaluated to nothing.
 *
 * Loading the raw stylesheet means no Tailwind utility resolves, so the fixture sizes its trigger and
 * its hint with an explicit `<style>` rather than with classes.
 */
const PLACEMENT_CSS = { css: ["./ui/assets/css/theme-base.css"], expose: EXPOSE.expose };

const PLACEMENT_STYLE = `<style>
  body { margin: 0; }
  [data-slot~="tooltip-trigger"] { position: fixed; top: 300px; left: 300px; width: 100px; height: 40px; }
  [data-slot~="tooltip-content"] { width: 120px; height: 24px; }
</style>`;

const GAP = 6; // 0.375rem

test.describe("Tooltip — anchored placement", () => {
  async function show(page: Page, side: string, align: string) {
    const html = await render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
          // biome-ignore lint/suspicious/noExplicitAny: the matrix is driven by data, not by literals
          Tooltip.Content({ id: "save-tip", side: side as any, align: align as any, children: "Writes the file" }),
        ],
      }),
    );
    await mount(page, `${PLACEMENT_STYLE}${html}`, PLACEMENT_CSS);
    await start(page);
    await page.hover("#save");
    await expect.poll(() => isShownAt(page), { timeout: 3000 }).toBe(true);
    return page.evaluate(() => {
      const round = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      };
      return { trigger: round(document.querySelector("#save") as Element), tip: round(document.querySelector("#save-tip") as Element) };
    });
  }

  function isShownAt(page: Page): Promise<boolean> {
    return page.evaluate(() => document.querySelector("#save-tip")?.matches(":popover-open") ?? false);
  }

  interface Box {
    top: number;
    left: number;
    right: number;
    bottom: number;
  }

  /** A pair of values that must agree, rather than a bare `number[]` — the tuple is what lets the
   * destructuring below stay free of undefined checks. */
  type Pair = (tip: Box, trigger: Box) => [number, number];

  /** Which edge of the tip must meet which edge of the trigger, per side. */
  const SIDES: ReadonlyArray<{ side: string; edge: Pair }> = [
    { side: "top", edge: (t, g) => [t.bottom, g.top - GAP] },
    { side: "bottom", edge: (t, g) => [t.top, g.bottom + GAP] },
    { side: "left", edge: (t, g) => [t.right, g.left - GAP] },
    { side: "right", edge: (t, g) => [t.left, g.right + GAP] },
  ];

  /** And which edge the alignment pins along the perpendicular axis. */
  const ALIGNS: Record<string, { start: Pair; end: Pair }> = {
    top: { start: (t, g) => [t.left, g.left], end: (t, g) => [t.right, g.right] },
    bottom: { start: (t, g) => [t.left, g.left], end: (t, g) => [t.right, g.right] },
    left: { start: (t, g) => [t.top, g.top], end: (t, g) => [t.bottom, g.bottom] },
    right: { start: (t, g) => [t.top, g.top], end: (t, g) => [t.bottom, g.bottom] },
  };

  for (const { side, edge } of SIDES) {
    for (const align of ["start", "center", "end"] as const) {
      test(`side=${side} align=${align} meets the trigger on the named edges`, async ({ page }) => {
        const { trigger, tip } = await show(page, side, align);

        const [actual, expected] = edge(tip, trigger);
        expect(Math.abs(actual - expected), `side edge: ${actual} vs ${expected}`).toBeLessThanOrEqual(2);

        if (align === "center") {
          const block = side === "top" || side === "bottom";
          const tipMid = block ? (tip.left + tip.right) / 2 : (tip.top + tip.bottom) / 2;
          const triggerMid = block ? (trigger.left + trigger.right) / 2 : (trigger.top + trigger.bottom) / 2;
          expect(Math.abs(tipMid - triggerMid), `centre: ${tipMid} vs ${triggerMid}`).toBeLessThanOrEqual(2);
        } else {
          const pin = ALIGNS[side]?.[align];
          if (!pin) throw new Error(`no alignment rule for ${side}/${align}`);
          const [a, b] = pin(tip, trigger);
          expect(Math.abs(a - b), `align edge: ${a} vs ${b}`).toBeLessThanOrEqual(2);
        }
      });
    }
  }
});
