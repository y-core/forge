import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { classesOf, compiledCss, mount } from "../client/browser.fixture";
import { Filter } from "./filter";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

interface Setup {
  chips?: string[];
  checked?: string;
  nested?: boolean;
  script?: boolean;
}

async function mountFilter(page: Page, { chips = ["a", "b", "c"], checked, nested = false, script = false }: Setup = {}): Promise<void> {
  const filter = await render(
    Filter({
      id: "facets",
      nested,
      children: [
        Filter.Reset({ id: "facets-reset" }),
        Filter.Group({
          label: "Category",
          children: chips.map((value) =>
            Filter.Item({ name: "facet", value, id: `facet-${value}`, checked: value === checked, children: value.toUpperCase() }),
          ),
        }),
      ],
    }),
  );
  const body = nested ? `<form id="consumer"><input id="q" name="q">${filter}</form>` : filter;
  const html = `<button id="before">Before</button>${body}<button id="after">After</button>`;
  if (script) await mount(page, html, EXPOSE);
  else await mount(page, html);
  const candidates = [
    ...classesOf(filter, "filter"),
    ...classesOf(filter, "filter-group"),
    ...classesOf(filter, "filter-reset"),
    ...classesOf(filter, "filter-item"),
    "sr-only",
  ];
  await page.addStyleTag({ content: await compiledCss(candidates) });
  if (script) await page.evaluate(() => window.forgeResume.resume());
}

interface Visible {
  reset: boolean;
  chips: boolean[];
  checked: string | null;
}

function visible(page: Page): Promise<Visible> {
  return page.evaluate(() => {
    const shown = (el: Element | null) => (el ? el.getBoundingClientRect().width > 1 : false);
    const chips = [...document.querySelectorAll("[data-slot~='filter-item']")].map(shown);
    const checked = document.querySelector<HTMLInputElement>("input[name='facet']:checked")?.value ?? null;
    return { reset: shown(document.getElementById("facets-reset")), chips, checked };
  });
}

function focused(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

async function tabFromBefore(page: Page, presses: number): Promise<void> {
  await page.locator("#before").focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press("Tab");
}

test.describe("Filter", { tag: "@cross-engine" }, () => {
  test("× clears a server-checked chip to none and leaves focus on the group's first chip", async ({ page }) => {
    await mountFilter(page, { checked: "b", script: true });
    expect(await visible(page)).toEqual({ reset: true, chips: [false, true, false], checked: "b" });

    await page.click("#facets-reset");

    await expect.poll(() => visible(page)).toEqual({ reset: false, chips: [true, true, true], checked: null });
    expect(await focused(page)).toBe("facet-a");
  });

  test("with no script, a server-checked chip can be changed by keyboard alone, the checked chip always the one showing", async ({ page }) => {
    await mountFilter(page, { checked: "b" });

    await tabFromBefore(page, 1);
    expect(await focused(page)).toBe("facets-reset");
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("facet-b");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [false, true, false], checked: "b" });

    await page.keyboard.press("ArrowRight");
    expect(await focused(page)).toBe("facet-c");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [false, false, true], checked: "c" });

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect(await focused(page)).toBe("facet-a");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, false, false], checked: "a" });

    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("after");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, false, false], checked: "a" });
  });

  test("with no script, each of five chips is reached and checked by keyboard alone", async ({ page }) => {
    await mountFilter(page, { chips: ["a", "b", "c", "d", "e"] });

    await tabFromBefore(page, 1);
    expect(await focused(page)).toBe("facet-a");
    await page.keyboard.press("Space");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, false, false, false, false], checked: "a" });

    for (const value of ["b", "c", "d", "e"]) {
      await page.keyboard.press("ArrowRight");
      expect(await focused(page)).toBe(`facet-${value}`);
      await expect
        .poll(() => visible(page))
        .toEqual({ reset: true, chips: ["a", "b", "c", "d", "e"].map((chip) => chip === value), checked: value });
    }
  });

  test("with no script, a clipped chip given focus is shown beside the checked one, which stays checked", async ({ page }) => {
    await mountFilter(page, { checked: "b" });

    await page.locator("#facet-a").focus();

    expect(await focused(page)).toBe("facet-a");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, true, false], checked: "b" });
  });

  test("every chip stays a radio in the accessibility tree while one is checked", async ({ page }) => {
    await mountFilter(page, { checked: "b" });

    await expect(page.getByRole("radio")).toHaveCount(3);
  });

  test("× inside a consumer's own form clears only the chips, leaving the form's other fields as typed", async ({ page }) => {
    await mountFilter(page, { checked: "b", nested: true, script: true });
    await page.fill("#q", "typed");

    await page.click("#facets-reset");

    await expect.poll(() => visible(page)).toEqual({ reset: false, chips: [true, true, true], checked: null });
    expect(await page.inputValue("#q")).toBe("typed");
  });

  test("with no script and no initial choice every chip shows and the reset is hidden until one is chosen", async ({ page }) => {
    await mountFilter(page, { chips: ["a", "b"] });
    expect(await visible(page)).toEqual({ reset: false, chips: [true, true], checked: null });

    await page.click("label:has(#facet-a)");
    await expect.poll(() => visible(page)).toEqual({ reset: true, chips: [true, false], checked: "a" });

    await page.click("#facets-reset");
    await expect.poll(() => visible(page)).toEqual({ reset: false, chips: [true, true], checked: null });
  });
});
