import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Tabs } from "./tabs";
import { Toggle } from "./toggle";
import { ToggleGroup } from "./toggle-group";

async function mountWithoutScript(page: Page, body: string): Promise<void> {
  await mount(page, await withCompiledCss(`<form id="f" action="/submit">${body}</form>`));
}

/** The FormData a native submit would carry, read without running any page script. */
async function submitted(page: Page): Promise<Array<[string, string]>> {
  const [request] = await Promise.all([page.waitForRequest("**/submit*"), page.locator("#go").click()]);
  return [...new URL(request.url()).searchParams.entries()];
}

test.describe("the four components that used to be inert without script", { tag: "@cross-engine" }, () => {
  test.use({ javaScriptEnabled: false });

  test("Tabs: every panel is reachable by following a tab's fragment", async ({ page }) => {
    const html = await render(
      Tabs({
        children: [
          Tabs.List({
            label: "Views",
            children: [Tabs.Tab({ for: "p-a", selected: true, children: "A" }), Tabs.Tab({ for: "p-b", children: "B" })],
          }),
          Tabs.Content({ id: "p-a", selected: true, children: "First panel" }),
          Tabs.Content({ id: "p-b", children: "Second panel" }),
        ],
      }),
    );
    await mountWithoutScript(page, html);

    await expect(page.locator("#p-a")).toBeVisible();
    await expect(page.locator("#p-b")).toBeHidden();

    await page.locator('[role="tab"][aria-controls="p-b"]').click();

    await expect(page.locator("#p-b")).toBeVisible();
    await expect(page.locator("#p-a")).toBeHidden();
  });

  test("Tabs: a tab is a real link naming the panel it controls", async ({ page }) => {
    const html = await render(Tabs({ children: Tabs.List({ label: "Views", children: Tabs.Tab({ for: "p-a", children: "A" }) }) }));
    await mountWithoutScript(page, html);

    const tab = page.locator('[role="tab"]');
    await expect(tab).toHaveAttribute("href", "#p-a");
    await expect(tab).toHaveAttribute("aria-controls", "p-a");
  });

  test("Toggle: clicking it toggles, and it appears in the submission", async ({ page }) => {
    const html = `${await render(Toggle({ name: "bold", value: "on", children: "Bold" }))}<button id="go" type="submit">Go</button>`;
    await mountWithoutScript(page, html);

    const input = page.locator('[data-slot~="toggle-input"]');
    await expect(input).not.toBeChecked();

    await page.locator('[data-slot~="toggle"]').click();
    await expect(input).toBeChecked();

    expect(await submitted(page)).toEqual([["bold", "on"]]);
  });

  test("Toggle: an unchecked one contributes nothing, as a checkbox should", async ({ page }) => {
    const html = `${await render(Toggle({ name: "bold", value: "on", children: "Bold" }))}<button id="go" type="submit">Go</button>`;
    await mountWithoutScript(page, html);

    expect(await submitted(page)).toEqual([]);
  });

  test("ToggleGroup: single selection is exclusive and submits the chosen value", async ({ page }) => {
    const html = `${await render(
      ToggleGroup({
        label: "Align",
        children: [
          ToggleGroup.Item({ name: "align", value: "left", pressed: true, children: "L" }),
          ToggleGroup.Item({ name: "align", value: "right", children: "R" }),
        ],
      }),
    )}<button id="go" type="submit">Go</button>`;
    await mountWithoutScript(page, html);

    await page.locator('[data-slot~="toggle-group-item"]', { hasText: "R" }).click();

    expect(await submitted(page)).toEqual([["align", "right"]]);
  });

  test("ToggleGroup: a single group is one tab stop the arrow keys move within", async ({ page }) => {
    const html = await render(
      ToggleGroup({
        label: "Align",
        children: [
          ToggleGroup.Item({ name: "align", value: "left", pressed: true, children: "L" }),
          ToggleGroup.Item({ name: "align", value: "right", children: "R" }),
        ],
      }),
    );
    await mountWithoutScript(page, html);

    await page.locator('input[value="left"]').focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.locator('input[value="right"]')).toBeChecked();
  });

  test("ToggleGroup: type=multiple submits every chosen value", async ({ page }) => {
    const html = `${await render(
      ToggleGroup({
        type: "multiple",
        label: "Overlays",
        children: [
          ToggleGroup.Item({ type: "multiple", name: "overlay", value: "grid", pressed: true, children: "Grid" }),
          ToggleGroup.Item({ type: "multiple", name: "overlay", value: "rulers", children: "Rulers" }),
        ],
      }),
    )}<button id="go" type="submit">Go</button>`;
    await mountWithoutScript(page, html);

    await page.locator('[data-slot~="toggle-group-item"]', { hasText: "Rulers" }).click();

    expect(await submitted(page)).toEqual([
      ["overlay", "grid"],
      ["overlay", "rulers"],
    ]);
  });
});
