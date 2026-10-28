import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Table } from "./table";

const rowBackgrounds = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((row) => getComputedStyle(row).backgroundColor));

test.describe("Table — zebra stripes", { tag: "@cross-engine" }, () => {
  test("an even selected or toned row keeps its own tint, and only a plain even row takes the stripe", async ({ page }) => {
    const row = (index: number) =>
      Table.Row({ selected: index < 2, tone: index >= 2 && index < 4 ? "info" : undefined, children: Table.Cell({ children: `r${index + 1}` }) });
    const html = await render(Table({ label: "Projects", zebra: true, children: Table.Body({ children: [0, 1, 2, 3, 4, 5].map(row) }) }));
    await mount(page, await withCompiledCss(html));

    const [first, second, third, fourth, fifth, sixth] = await rowBackgrounds(page);

    expect(second).toBe(first);
    expect(fourth).toBe(third);
    expect(sixth).not.toBe(fifth);
  });
});

test.describe("Table — pinned header", { tag: "@cross-engine" }, () => {
  test("the header cell stays at the scroller's top after the rows scroll under it", async ({ page }) => {
    const rows = Array.from({ length: 60 }, (_, index) => Table.Row({ children: Table.Cell({ children: `r${index + 1}` }) }));
    const html = await render(
      Table({
        label: "Projects",
        pinRows: true,
        children: [Table.Header({ children: Table.Row({ children: Table.Head({ children: "Name" }) }) }), Table.Body({ children: rows })],
      }),
    );
    await mount(page, await withCompiledCss(`<div style="max-height:200px">${html}</div>`));

    await page.hover("[data-slot='table-scroll']");
    await page.mouse.wheel(0, 700);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document.querySelector("[data-slot='table-scroll']") as HTMLElement;
          const head = document.querySelector("th") as HTMLElement;
          const pinned = head.getBoundingClientRect().top === scroller.getBoundingClientRect().top + scroller.clientTop;
          return { pinned, scrolled: scroller.scrollTop > 0 };
        }),
      )
      .toEqual({ pinned: true, scrolled: true });
  });

  test("a parent sized by height alone leaves the wrapper unscrolled, so the header scrolls away with the page", async ({ page }) => {
    const rows = Array.from({ length: 60 }, (_, index) => Table.Row({ children: Table.Cell({ children: `r${index + 1}` }) }));
    const html = await render(
      Table({
        label: "Projects",
        pinRows: true,
        children: [Table.Header({ children: Table.Row({ children: Table.Head({ children: "Name" }) }) }), Table.Body({ children: rows })],
      }),
    );
    await mount(page, await withCompiledCss(`<div style="height:200px">${html}</div>`));
    const headTopAtRest = await page.evaluate(() => (document.querySelector("th") as HTMLElement).getBoundingClientRect().top + window.scrollY);

    await page.hover("[data-slot='table-scroll']");
    await page.mouse.wheel(0, 700);

    await expect
      .poll(() =>
        page.evaluate((restTop) => {
          const scroller = document.querySelector("[data-slot='table-scroll']") as HTMLElement;
          const head = document.querySelector("th") as HTMLElement;
          return {
            pageScrolled: window.scrollY > 0,
            wrapperScrollTop: scroller.scrollTop,
            headMovedWithPage: head.getBoundingClientRect().top === restTop - window.scrollY,
          };
        }, headTopAtRest),
      )
      .toEqual({ pageScrolled: true, wrapperScrollTop: 0, headMovedWithPage: true });
  });
});
