import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import { scopeAttrs } from "../contracts/scope-attrs";
import { Resumable } from "../server/resumable";
import { Toolbar } from "./toolbar";
import { Tooltip } from "./tooltip";

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

  // The blur path is the tooltip's own; Escape below is the `popover="hint"` platform's, and forge
  // holds no handler for it — both are pinned so neither can be lost without a failure here.
  test("closes when focus leaves the trigger", async ({ page }) => {
    await mount(page, `${await markup()}<button id="after">after</button>`, EXPOSE);
    await start(page);

    await page.focus("#save");
    await expect.poll(() => isShown(page), { timeout: 3000 }).toBe(true);
    await page.focus("#after");

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
    await expect.poll(() => page.evaluate(() => document.querySelector("#save-tip")?.matches(":popover-open")), { timeout: 3000 }).toBe(true);
  });
});

test.describe("Tooltip — label kind", () => {
  test("names its trigger by the tooltip text and gives it no description", async ({ page }) => {
    const html = await render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "bold", for: "bold-tip", kind: "label", children: jsx("svg", { "aria-hidden": "true" }) }),
          Tooltip.Content({ id: "bold-tip", children: "Bold" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);

    await expect(page.locator("#bold")).toHaveAccessibleName("Bold");
    await expect(page.locator("#bold")).toHaveAccessibleDescription("");
  });

  test("still opens on hover, found by its slot rather than by aria-describedby", async ({ page }) => {
    const html = await render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "bold", for: "bold-tip", kind: "label", children: "B" }),
          Tooltip.Content({ id: "bold-tip", children: "Bold" }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);
    await start(page);

    await page.hover("#bold");

    await expect.poll(() => page.evaluate(() => document.querySelector("#bold-tip")?.matches(":popover-open")), { timeout: 3000 }).toBe(true);
  });
});

function isOpen(page: Page, id: string): Promise<boolean> {
  return page.evaluate((target) => document.getElementById(target)?.matches(":popover-open") ?? false, id);
}

const pasteToolbar = () =>
  render(
    Toolbar({
      label: "Formatting",
      children: [
        Toolbar.Button({ id: "bold", children: "Bold" }),
        Tooltip({
          children: [
            Tooltip.Trigger({ for: "paste-tip", asChild: true, children: Toolbar.Button({ id: "paste", disabled: true, children: "Paste" }) }),
            Tooltip.Content({ id: "paste-tip", children: "Nothing to paste" }),
          ],
        }),
        Toolbar.Button({ id: "italic", children: "Italic" }),
      ],
    }),
  );

test.describe("Tooltip — an aria-disabled trigger still shows its tooltip", () => {
  test("opens on hover through the state-disabled styling a toolbar item carries", async ({ page }) => {
    const html = await pasteToolbar();
    await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);
    await start(page);
    const box = await page.locator("#paste").boundingBox();
    if (!box) throw new Error("#paste has no box to hover");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await expect.poll(() => isOpen(page, "paste-tip"), { timeout: 3000 }).toBe(true);
  });

  test("takes keyboard focus and opens on it", async ({ page }) => {
    const html = await render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "save", for: "save-tip", disabled: true, children: "Save" }),
          Tooltip.Content({ id: "save-tip", children: "Nothing to save" }),
        ],
      }),
    );
    await mount(page, `<button id="before">b</button>${html}`, EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");

    expect(await focusedId(page)).toBe("save");
    await expect.poll(() => isOpen(page, "save-tip"), { timeout: 3000 }).toBe(true);
  });

  test("stays in its toolbar's roving ring, opening as the arrows pass through it", async ({ page }) => {
    await mount(page, await pasteToolbar(), EXPOSE);
    await start(page);

    await page.focus("#bold");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("paste");
    await expect.poll(() => isOpen(page, "paste-tip"), { timeout: 3000 }).toBe(true);

    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("italic");
  });
});

test.describe("Tooltip — an aria-disabled trigger fires nothing", () => {
  const tip = (id: string, trigger: Parameters<typeof Tooltip.Trigger>[0]) =>
    Tooltip({ children: [Tooltip.Trigger(trigger), Tooltip.Content({ id: `${id}-tip`, children: `${id} hint` })] });

  const markup = async () =>
    (await render(
      Resumable({
        name: "editor",
        children: [
          tip("act", { id: "act", for: "act-tip", disabled: true, ...scopeAttrs({ onClick: "act" }), children: "Act" }),
          tip("cmd", { id: "cmd", for: "cmd-tip", disabled: true, command: "toggle-popover", commandfor: "cmd-pop", children: "Cmd" }),
          tip("pt", { id: "pt", for: "pt-tip", disabled: true, popovertarget: "pt-pop", children: "Pt" }),
          jsx("form", { id: "form", children: tip("sub", { id: "sub", for: "sub-tip", disabled: true, type: "submit", children: "Sub" }) }),
          tip("nav", { for: "nav-tip", asChild: true, children: jsx("a", { id: "nav", href: "#moved", children: "Nav" }) }),
        ],
      }),
    )) + '<div id="cmd-pop" popover="manual">c</div><div id="pt-pop" popover="manual">p</div>';

  async function arm(page: Page): Promise<void> {
    await mount(page, await markup(), EXPOSE);
    await page.evaluate(() => {
      window.forgeResume.registerScope("editor", { on: { act: () => document.body.setAttribute("data-ran", "") } });
      document.getElementById("form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        document.body.setAttribute("data-submitted", "");
      });
      document.getElementById("nav")?.setAttribute("aria-disabled", "true");
      window.forgeResume.resume();
    });
  }

  function outcome(page: Page) {
    return page.evaluate(() => ({
      action: document.body.hasAttribute("data-ran"),
      command: document.getElementById("cmd-pop")?.matches(":popover-open") ?? false,
      popovertarget: document.getElementById("pt-pop")?.matches(":popover-open") ?? false,
      submit: document.body.hasAttribute("data-submitted"),
      navigation: location.hash === "#moved",
    }));
  }

  const TRIGGERS = ["act", "cmd", "pt", "sub", "nav"];

  for (const input of ["click", "Enter"] as const) {
    test(`on ${input}: no action, command, popovertarget, submit or navigation until aria-disabled is lifted`, async ({ page }) => {
      await arm(page);
      const activate = async (id: string) => {
        if (input === "click") await page.click(`#${id}`, { force: true });
        else {
          await page.focus(`#${id}`);
          await page.keyboard.press("Enter");
        }
      };

      for (const id of TRIGGERS) await activate(id);
      const inert = await outcome(page);
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('[aria-disabled="true"]')) el.removeAttribute("aria-disabled");
      });
      for (const id of TRIGGERS) await activate(id);
      const live = await outcome(page);

      expect({ inert, live }).toEqual({
        inert: { action: false, command: false, popovertarget: false, submit: false, navigation: false },
        live: { action: true, command: true, popovertarget: true, submit: true, navigation: true },
      });
    });
  }
});

type Tree = "light" | "shadow";

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

    expect(await page.evaluate(() => document.getElementById("save-tip") === null)).toBe(true);
    expect(await isShownIn(page, "shadow")).toBe(false);

    await page.hover("#save");
    await expect.poll(() => isShownIn(page, "shadow"), { timeout: 3000 }).toBe(true);

    await page.keyboard.press("Escape");

    await expect.poll(() => isShownIn(page, "shadow")).toBe(false);
  });

  test("the identical markup in the light DOM opens on hover and closes on Escape", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await isShownIn(page, "light")).toBe(false);

    await page.hover("#save");
    await expect.poll(() => isShownIn(page, "light"), { timeout: 3000 }).toBe(true);

    await page.keyboard.press("Escape");

    await expect.poll(() => isShownIn(page, "light")).toBe(false);
  });
});

const PLACEMENT_CSS = { css: ["./ui/assets/css/forge-ui.css"], expose: EXPOSE.expose };

const PLACEMENT_STYLE = `<style>
  body { margin: 0; }
  [data-slot~="tooltip-trigger"] { position: fixed; top: 300px; left: 300px; width: 100px; height: 40px; }
  [data-slot~="tooltip-content"] { width: 120px; height: 24px; }
</style>`;

const GAP = 6;

test.describe("Tooltip — anchored placement", () => {
  async function show(page: Page, side: string, align: string) {
    const html = await render(
      Tooltip({
        children: [
          Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
          // oxlint-disable-next-line typescript/no-explicit-any -- the matrix is driven by data, not by literals
          Tooltip.Content({ id: "save-tip", side: side as any, align: align as any, children: "Writes the file" }),
        ],
      }),
    );
    // Reduced motion keeps this a geometry assertion: a settled rect, whatever transition the tip gains later.
    await page.emulateMedia({ reducedMotion: "reduce" });
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

  type Pair = (tip: Box, trigger: Box) => [number, number];

  const SIDES: ReadonlyArray<{ side: string; edge: Pair }> = [
    { side: "top", edge: (t, g) => [t.bottom, g.top - GAP] },
    { side: "bottom", edge: (t, g) => [t.top, g.bottom + GAP] },
    { side: "left", edge: (t, g) => [t.right, g.left - GAP] },
    { side: "right", edge: (t, g) => [t.left, g.right + GAP] },
  ];

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
