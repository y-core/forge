import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../../testing/render";
import { compiledCss, mount, renderedClasses } from "../../client/browser.fixture";
import { Filter } from "../../core/filter";
import { ToggleGroup } from "../../core/toggle-group";

async function mountCompiled(page: Page, html: string): Promise<void> {
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`);
}

function filterMarkup(checked: string | undefined): Promise<string> {
  return render(
    Filter({
      id: "facets",
      children: Filter.Group({
        label: "Category",
        children: ["a", "b", "c"].map((value) =>
          Filter.Item({ name: "facet", value, id: `chip-${value}`, checked: value === checked, children: value.toUpperCase() }),
        ),
      }),
    }),
  );
}

function toggleGroupMarkup(): Promise<string> {
  return render(
    ToggleGroup({
      label: "Alignment",
      children: ["a", "b", "c"].map((value) =>
        ToggleGroup.Item({ name: "align", value, id: `chip-${value}`, pressed: value === "a", children: value.toUpperCase() }),
      ),
    }),
  );
}

function chipBoxShadow(page: Page, id: string): Promise<string> {
  return page.evaluate((target) => {
    const chip = document.getElementById(target)?.closest("label");
    return chip ? getComputedStyle(chip).boxShadow : "no-element";
  }, id);
}

async function arrowFromCheckedChip(page: Page): Promise<string> {
  await page.keyboard.press("Tab");
  await expect(page.locator("#chip-a")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#chip-b")).toBeFocused();
  return chipBoxShadow(page, "chip-b");
}

async function pressChip(page: Page): Promise<string> {
  await page.locator("label:has(#chip-b)").click();
  await expect(page.locator("#chip-b")).toBeFocused();
  return chipBoxShadow(page, "chip-b");
}

test.describe("focus-ring — a chip built on a hidden radio", { tag: "@cross-engine" }, () => {
  test("a Filter chip reached by an arrow key draws the inset ring", async ({ page }) => {
    await mountCompiled(page, await filterMarkup("a"));

    expect(await arrowFromCheckedChip(page)).toContain("inset");
  });

  test("a single-select ToggleGroup item reached by an arrow key draws the inset ring", async ({ page }) => {
    await mountCompiled(page, await toggleGroupMarkup());

    expect(await arrowFromCheckedChip(page)).toContain("inset");
  });

  test("a Filter chip pressed by the pointer draws no ring", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit does not match :focus-visible on an arrow-focused radio; the ring follows :focus there");
    await mountCompiled(page, await filterMarkup(undefined));

    expect(await pressChip(page)).toBe("none");
  });

  test("a ToggleGroup item pressed by the pointer draws no ring", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "WebKit does not match :focus-visible on an arrow-focused radio; the ring follows :focus there");
    await mountCompiled(page, await toggleGroupMarkup());

    expect(await pressChip(page)).toBe("none");
  });
});
