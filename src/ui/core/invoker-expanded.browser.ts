import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { Toolbar } from "../chrome/toolbar";
import { mount } from "../client/browser-test-helper";
import { createIcon } from "./icon";
import { Menu } from "./menu";
import { Popover } from "./popover";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const icon = createIcon("/sprite.svg");

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function expanded(page: Page, selector: string): Promise<string | null | undefined> {
  return page.evaluate((sel) => document.querySelector(sel)?.getAttribute("aria-expanded"), selector);
}

const MENU = () =>
  render(
    Menu({ children: [Menu.Trigger({ id: "m", children: "File" }), Menu.Popup({ id: "m", children: Menu.Item({ for: "m", children: "New" }) })] }),
  );

test.describe("popover invokers expose their expanded state", () => {
  // The measurement the fix was decided on. `command`/`commandfor` is specified to map to
  // `aria-expanded`, but no engine ships it reliably — this records what the engine under test
  // actually does, so the explicit stamping below is never mistaken for belt-and-braces.
  test("the platform does not supply the mapping for a bare commandfor invoker", async ({ page }) => {
    await mount(page, '<button type="button" command="toggle-popover" commandfor="p">Open</button><div id="p" popover="auto">Panel</div>');

    const supplied = await page.evaluate(async () => {
      const button = document.querySelector("button");
      const before = await ((
        window as unknown as { getComputedAccessibleNode?: (el: Element) => Promise<{ expanded?: boolean }> }
      ).getComputedAccessibleNode?.(button as Element) ?? null);
      return before === null ? "unavailable" : String(before.expanded);
    });

    // Either the API is absent (most engines) or it reports no expanded state — both mean forge must
    // stamp the attribute itself.
    expect(["unavailable", "undefined", "null"]).toContain(supplied);
  });

  test("Menu.Trigger names its popup and tracks its open state through both directions", async ({ page }) => {
    await mount(page, await MENU(), EXPOSE);
    await start(page);

    expect(await page.evaluate(() => document.querySelector("[data-slot~='menu-trigger']")?.getAttribute("aria-controls"))).toBe("m");
    expect(await expanded(page, "[data-slot~='menu-trigger']")).toBe("false");

    await page.click("[data-slot~='menu-trigger']");
    expect(await expanded(page, "[data-slot~='menu-trigger']")).toBe("true");

    await page.keyboard.press("Escape");
    expect(await expanded(page, "[data-slot~='menu-trigger']")).toBe("false");
  });

  test("a light dismiss returns the trigger to collapsed, not only an explicit close", async ({ page }) => {
    await mount(page, await MENU(), EXPOSE);
    await start(page);

    await page.click("[data-slot~='menu-trigger']");
    expect(await expanded(page, "[data-slot~='menu-trigger']")).toBe("true");

    await page.mouse.click(5, 5);
    expect(await expanded(page, "[data-slot~='menu-trigger']")).toBe("false");
  });

  test("Popover.Trigger tracks its content the same way", async ({ page }) => {
    const html = await render(
      Popover({ children: [Popover.Trigger({ id: "p", children: "Open" }), Popover.Content({ id: "p", children: "Panel" })] }),
    );
    await mount(page, html, EXPOSE);
    await start(page);

    expect(await page.evaluate(() => document.querySelector("[data-slot~='popover-trigger']")?.getAttribute("aria-controls"))).toBe("p");
    await page.click("[data-slot~='popover-trigger']");
    expect(await expanded(page, "[data-slot~='popover-trigger']")).toBe("true");

    await page.keyboard.press("Escape");
    expect(await expanded(page, "[data-slot~='popover-trigger']")).toBe("false");
  });

  test("a toolbar flyout trigger tracks its own flyout", async ({ page }) => {
    const html = await render(
      Toolbar({ icon, config: { groups: [{ items: [{ kind: "popover", icon: "search", label: "Tools", content: "body" }] }] } }),
    );
    await mount(page, html, EXPOSE);
    await start(page);

    expect(await expanded(page, "[data-slot~='toolbar-trigger']")).toBe("false");
    await page.click("[data-slot~='toolbar-trigger']");
    expect(await expanded(page, "[data-slot~='toolbar-trigger']")).toBe("true");
  });

  test("a submenu trigger tracks its nested popup independently of its parent", async ({ page }) => {
    const html = await render(
      Menu({
        children: [
          Menu.Trigger({ id: "m", children: "File" }),
          Menu.Popup({ id: "m", children: Menu.SubmenuTrigger({ id: "sub", children: "More" }) }),
          Menu.Popup({ id: "sub", children: Menu.Item({ for: "sub", children: "Deep" }) }),
        ],
      }),
    );
    await mount(page, html, EXPOSE);
    await start(page);

    await page.click("[data-slot~='menu-trigger']");
    await page.click("[data-slot~='menu-submenu-trigger']");

    expect(await expanded(page, "[data-slot~='menu-trigger']")).toBe("true");
    expect(await expanded(page, "[data-slot~='menu-submenu-trigger']")).toBe("true");
  });
});
