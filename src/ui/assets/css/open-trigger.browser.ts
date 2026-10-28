import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../../render/jsx/jsx-runtime";
import { render } from "../../../testing/render";
import { Toolbar } from "../../chrome/toolbar";
import { compiledCss, mount, paintedHex, renderedClasses } from "../../client/browser.fixture";
import { createIcon } from "../../core/icon";
import { Menu } from "../../core/menu";
import { Popover } from "../../core/popover";

async function mountCompiled(page: Page, html: string): Promise<void> {
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`);
}

function showPopovers(page: Page, ids: readonly string[]): Promise<void> {
  return page.evaluate((targets) => {
    for (const id of targets) document.getElementById(id)?.showPopover();
  }, ids);
}

async function paintedBackground(page: Page, selector: string): Promise<string> {
  const computed = await page.evaluate((target) => getComputedStyle(document.querySelector(target) as HTMLElement).backgroundColor, selector);
  return paintedHex(page, computed);
}

test.describe("Open-trigger state — an open panel's trigger is highlighted over its own utilities", { tag: "@cross-engine" }, () => {
  test.use({ reducedMotion: "reduce" });

  test("a chrome Toolbar flyout trigger paints --primary while its flyout is open", async ({ page }) => {
    const config = {
      label: "Scene tools",
      groups: [
        { items: [{ kind: "popover" as const, icon: "layers", label: "Layers", ref: "layers", content: jsx("p", { children: "Inside" }) }] },
      ],
    };
    await mountCompiled(page, await render(Toolbar({ config, icon: createIcon("/sprite.svg") })));
    const flyout = await page.evaluate(() => document.querySelector("[data-slot~='toolbar-flyout']")?.id ?? "");
    await showPopovers(page, [flyout]);

    const background = await paintedBackground(page, "[data-ref='layers']");

    expect(background).toBe(await paintedHex(page, "var(--primary)"));
  });

  test("a Menu.SubmenuTrigger paints --accent while its submenu is open", async ({ page }) => {
    const submenu = Menu.Popup({ triggered: true, id: "recent-menu", children: Menu.Item({ id: "r0", for: "recent-menu", children: "alpha" }) });
    const popup = Menu.Popup({
      triggered: true,
      id: "file-menu",
      children: [
        Menu.Item({ id: "new", for: "file-menu", children: "New" }),
        Menu.SubmenuTrigger({ for: "recent-menu", children: "Recent" }),
        submenu,
      ],
    });
    await mountCompiled(page, await render(Menu({ children: [Menu.Trigger({ for: "file-menu", children: "File" }), popup] })));
    await showPopovers(page, ["file-menu", "recent-menu"]);

    const background = await paintedBackground(page, "[data-slot~='menu-submenu-trigger']");

    expect(background).toBe(await paintedHex(page, "var(--accent)"));
  });

  test("a Popover.Trigger with bg-transparent paints --accent while its content is open", async ({ page }) => {
    const html = await render(
      Popover({
        children: [
          Popover.Trigger({ for: "tips", class: "bg-transparent", children: "Tips" }),
          Popover.Content({ id: "tips", label: "Tips", children: "Body" }),
        ],
      }),
    );
    await mountCompiled(page, html);
    await showPopovers(page, ["tips"]);

    const background = await paintedBackground(page, "[data-slot~='popover-trigger']");

    expect(background).toBe(await paintedHex(page, "var(--accent)"));
  });
});
