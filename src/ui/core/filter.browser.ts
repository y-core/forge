import { expect, type Page, test } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, mount } from "../client/browser-test-helper";
import { Filter } from "./filter";

// Server-rendered with `b` chosen: the reset must restore that, not clear it.
const markup = () =>
  render(
    Filter({
      id: "facets",
      children: [
        Filter.Reset({ id: "facets-reset" }),
        Filter.Item({ name: "facet", value: "a", id: "facet-a", children: "A" }),
        Filter.Item({ name: "facet", value: "b", id: "facet-b", checked: true, children: "B" }),
        Filter.Item({ name: "facet", value: "c", id: "facet-c", children: "C" }),
      ],
    }),
  );

interface Visible {
  reset: boolean;
  chips: boolean[];
  checked: string | null;
}

function visible(page: Page): Promise<Visible> {
  return page.evaluate(() => {
    const shown = (el: Element | null) => (el ? getComputedStyle(el).display !== "none" : false);
    const chips = [...document.querySelectorAll("[data-slot~='filter-item']")].map(shown);
    const checked = document.querySelector<HTMLInputElement>("input[name='facet']:checked")?.value ?? null;
    return { reset: shown(document.getElementById("facets-reset")), chips, checked };
  });
}

async function mountFilter(page: Page): Promise<void> {
  const html = await markup();
  await mount(page, html);
  const candidates = [...classesOf(html, "filter"), ...classesOf(html, "filter-reset"), ...classesOf(html, "filter-item"), "sr-only"];
  await page.addStyleTag({ content: await compiledCss(candidates) });
}

test.describe("Filter", () => {
  test("the chosen chip stays and its siblings hide, with the reset shown, all through :has() and no script", async ({ page }) => {
    await mountFilter(page);
    expect(await visible(page)).toEqual({ reset: true, chips: [false, true, false], checked: "b" });

    await page.click("#facets-reset");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [false, true, false], checked: "b" });
  });

  test("reset restores the server-rendered choice rather than clearing the group", async ({ page }) => {
    await mountFilter(page);
    await page.evaluate(() => (document.getElementById("facet-a") as HTMLInputElement).click());
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, false, false], checked: "a" });

    await page.click("#facets-reset");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [false, true, false], checked: "b" });
  });

  test("with no initial choice every chip shows and the reset is hidden until one is chosen", async ({ page }) => {
    const html = await render(
      Filter({
        children: [
          Filter.Reset({ id: "facets-reset" }),
          Filter.Item({ name: "facet", value: "a", id: "facet-a", children: "A" }),
          Filter.Item({ name: "facet", value: "b", id: "facet-b", children: "B" }),
        ],
      }),
    );
    await mount(page, html);
    await page.addStyleTag({
      content: await compiledCss([...classesOf(html, "filter"), ...classesOf(html, "filter-reset"), ...classesOf(html, "filter-item"), "sr-only"]),
    });
    expect(await visible(page)).toEqual({ reset: false, chips: [true, true], checked: null });

    await page.click("label:has(#facet-a)");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, false], checked: "a" });

    await page.click("#facets-reset");
    await expect.poll(() => visible(page)).toEqual({ reset: false, chips: [true, true], checked: null });
  });
});
