import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { parseMarkdown } from "../../../render/markdown/document";
import { renderMarkdownHtml } from "../../../render/markdown/html";
import { MARKDOWN_ELEMENTS } from "../../../render/markdown/html-schema";
import { mount } from "../../client/browser.fixture";

const SHEET = readFileSync(fileURLToPath(new URL("./markdown.css", import.meta.url)), "utf-8");

const SOURCE = "- [ ] a\n- [x] b\n\n| l | r |\n|---|--:|\n| 1 | 2 |\n\n---\n\nNote[^1].\n\n[^1]: Text.\n";

const BODY = renderMarkdownHtml(parseMarkdown(SOURCE), {
  schema: { elements: MARKDOWN_ELEMENTS, url: ({ value }) => value },
  tasks: { name: "task" },
});

async function mountMarkdown(page: Page, appRule = ""): Promise<void> {
  await mount(page, `<style>${appRule}</style><style>${SHEET}</style><div class="markdown" id="in">${BODY}</div><div id="out">${BODY}</div>`);
}

function computed(page: Page, reads: Record<string, [selector: string, property: string]>): Promise<Record<string, string>> {
  return page.evaluate(
    (targets) =>
      Object.fromEntries(
        Object.entries(targets).map(([name, [selector, property]]) => [
          name,
          getComputedStyle(document.querySelector(selector) as HTMLElement).getPropertyValue(property),
        ]),
      ),
    reads,
  );
}

test.describe("markdown.css", { tag: "@cross-engine" }, () => {
  test("styles the task list inside a .markdown wrapper and leaves the same markup outside one alone", async ({ page }) => {
    await mountMarkdown(page);

    expect(
      await computed(page, { inside: ["#in .contains-task-list", "list-style-type"], outside: ["#out .contains-task-list", "list-style-type"] }),
    ).toEqual({ inside: "none", outside: "disc" });
  });

  test("a one-class app rule placed before the sheet still beats it", async ({ page }) => {
    await mountMarkdown(page, ".contains-task-list { list-style-type: square; }");

    expect(await computed(page, { inside: ["#in .contains-task-list", "list-style-type"] })).toEqual({ inside: "square" });
  });

  test("a --markdown-border set on the wrapper colours the thematic break", async ({ page }) => {
    await mountMarkdown(page, ".markdown { --markdown-border: rgb(255, 0, 0); }");

    expect(await computed(page, { hr: ["#in hr", "border-block-start-color"] })).toEqual({ hr: "rgb(255, 0, 0)" });
  });

  test("a right-aligned column computes right, and an unaligned header and cell compute start", async ({ page }) => {
    await mountMarkdown(page);

    expect(
      await computed(page, {
        alignedHeader: ["#in th[align='right']", "text-align"],
        alignedCell: ["#in td[align='right']", "text-align"],
        unalignedHeader: ["#in th:not([align])", "text-align"],
        unalignedCell: ["#in td:not([align])", "text-align"],
      }),
    ).toEqual({ alignedHeader: "right", alignedCell: "right", unalignedHeader: "start", unalignedCell: "start" });
  });

  test("the footnotes' hidden heading is a 1px box", async ({ page }) => {
    await mountMarkdown(page);
    const box = await page.locator("#in h2.sr-only").boundingBox();

    expect({ width: box?.width, height: box?.height }).toEqual({ width: 1, height: 1 });
  });
});
