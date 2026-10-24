import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../../render/jsx/jsx-runtime";
import { render } from "../../../testing/render";
import { Toolbar } from "../../chrome/toolbar";
import { mount } from "../../client/browser.fixture";
import { createIcon } from "../../core/icon";
import { Menu } from "../../core/menu";
import { Popover } from "../../core/popover";

declare global {
  interface Window {
    forgeResume: typeof import("../../client/resume");
  }
}

const CSS = { css: ["./ui/assets/css/forge-ui.css"] };
const CSS_AND_RESUME = { ...CSS, expose: { forgeResume: "./ui/client/resume", forgeChromeClient: "./ui/chrome/client" } };

const FIXTURE_STYLE = `<style>
  body { margin: 0; }
  [data-slot~="menu-trigger"], [data-slot~="popover-trigger"] { position: fixed; top: 200px; left: 120px; width: 90px; height: 30px; }
  [data-slot~="toolbar"] { position: fixed; top: 200px; left: 120px; width: 48px; }
  [data-slot~="toolbar-trigger"] { display: block; width: 40px; height: 40px; }
  [data-slot~="menu-popup"], [data-slot~="popover-content"] { width: 160px; }
  [data-slot~="toolbar-flyout"] { width: 180px; height: 90px; }
</style>`;

const GAP = 6;
const RAIL_GAP = 8;

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface Placement {
  trigger: Rect;
  panel: Rect;
  positionAnchor: string;
}

function measurePlacement(page: Page, trigger: string, panel: string): Promise<Placement> {
  return page.evaluate(
    ([triggerSelector, panelSelector]) => {
      const round = (selector: string) => {
        const r = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      };
      const positionAnchor = getComputedStyle(document.querySelector(panelSelector) as HTMLElement).getPropertyValue("position-anchor");
      return { trigger: round(triggerSelector), panel: round(panelSelector), positionAnchor };
    },
    [trigger, panel] as const,
  );
}

function expectNear(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(2);
}

test.describe("Anchored placement — every engine resolves the invoker's implicit anchor", { tag: "@cross-engine" }, () => {
  test.use({ reducedMotion: "reduce" });

  test("a bottom-side Menu.Popup opens under its trigger", async ({ page }) => {
    const popup = Menu.Popup({
      triggered: true,
      id: "file-menu",
      side: "bottom",
      children: [Menu.Item({ id: "new", for: "file-menu", children: "New" }), Menu.Item({ id: "open", for: "file-menu", children: "Open" })],
    });
    const html = await render(Menu({ children: [Menu.Trigger({ for: "file-menu", children: "File" }), popup] }));
    await mount(page, `${FIXTURE_STYLE}${html}`, CSS);
    await page.click('[data-slot~="menu-trigger"]');

    const { trigger, panel, positionAnchor } = await measurePlacement(page, '[data-slot~="menu-trigger"]', "#file-menu");

    expectNear(panel.top, trigger.bottom + GAP, "popup.top against trigger.bottom + gap");
    expectNear(panel.left, trigger.left, "popup.left against trigger.left");
    expect(positionAnchor).toBe("auto");
  });

  test("a bottom-side Popover.Content opens under its trigger", async ({ page }) => {
    const html = await render(
      Popover({
        children: [
          Popover.Trigger({ for: "tips", children: "Tips" }),
          Popover.Content({ id: "tips", label: "Tips", side: "bottom", children: "Body" }),
        ],
      }),
    );
    await mount(page, `${FIXTURE_STYLE}${html}`, CSS);
    await page.click('[data-slot~="popover-trigger"]');

    const { trigger, panel, positionAnchor } = await measurePlacement(page, '[data-slot~="popover-trigger"]', "#tips");

    expectNear(panel.top, trigger.bottom + GAP, "content.top against trigger.bottom + gap");
    expectNear(panel.left, trigger.left, "content.left against trigger.left");
    expect(positionAnchor).toBe("auto");
  });

  test("a left rail's Toolbar flyout opens beside its trigger", async ({ page }) => {
    const config = {
      label: "Scene tools",
      groups: [
        {
          items: [
            {
              kind: "popover" as const,
              icon: "layers",
              label: "Layers",
              ref: "layers",
              content: jsx("button", { id: "in-flyout", children: "Inside" }),
            },
          ],
        },
      ],
    };
    const html = await render(Toolbar({ config, icon: createIcon("/sprite.svg"), placement: "left" }));
    await mount(page, `${FIXTURE_STYLE}<div data-scope="app">${html}</div>`, CSS_AND_RESUME);
    await page.evaluate(() => window.forgeResume.resume());
    await page.click("[data-ref='layers']");

    const { trigger, panel, positionAnchor } = await measurePlacement(page, "[data-ref='layers']", "[data-slot~='toolbar-flyout']");

    expectNear(panel.left, trigger.right + RAIL_GAP, "flyout.left against trigger.right + rail gap");
    expectNear(panel.top, trigger.top, "flyout.top against trigger.top");
    expect(positionAnchor).toBe("auto");
  });
});
