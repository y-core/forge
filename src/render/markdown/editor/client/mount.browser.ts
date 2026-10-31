import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount } from "../../../../ui/client/browser.fixture";
import type { ViewportController, ViewportMode, ViewportRendering } from "./types";

declare global {
  interface Window {
    forgeViewport: typeof import("./mount");
    forgeViewportDialect: typeof import("./dialect.fixture");
    viewport: ViewportController;
    changes: number;
    htmlCalls: boolean[];
  }
}

const FIXTURE = `<div id="scroller" style="height: 300px; overflow: auto"><div id="host"></div></div>`;
const MARKDOWN = "# Title\n\nA *word*, #tag and [[id:7|Seven]].\n\n> [!note] Heads up\n> body\n\n- [ ] task\n";
const EXPOSE = { forgeViewport: "./render/markdown/editor/client/mount", forgeViewportDialect: "./render/markdown/editor/client/dialect.fixture" };

async function openViewport(page: Page, markdown: string, mode: ViewportMode, rendering: ViewportRendering): Promise<void> {
  await page.evaluate(
    (opened) => {
      window.changes = 0;
      window.htmlCalls = [];
      const host = document.getElementById("host") as HTMLElement;
      window.viewport = window.forgeViewport.mountMarkdownViewport(host, {
        ...opened,
        label: "Body",
        scroller: document.getElementById("scroller") as HTMLElement,
        onChange: () => (window.changes += 1),
        onHtml: (container) => window.htmlCalls.push(container === host.querySelector(":scope > [data-viewport-html]") && !container.hidden),
        dialect: {
          calloutKinds: ["note"],
          html: window.forgeViewportDialect.testDialectHtml,
          spans: (text) => {
            const spans: {
              kind: "tag" | "wikilink";
              from: number;
              to: number;
              labelFrom: number;
              chip: { label: string; target: string } | undefined;
            }[] = [];
            for (const match of text.matchAll(/#[a-z]+/g))
              spans.push({ kind: "tag", from: match.index, to: match.index + match[0].length, labelFrom: 0, chip: undefined });
            for (const match of text.matchAll(/\[\[(id:\d+)\|([^\]]+)\]\]/g)) {
              const [whole, target = "", label = ""] = match;
              spans.push({ kind: "wikilink", from: match.index, to: match.index + whole.length, labelFrom: 0, chip: { label, target } });
            }
            return spans.sort((a, b) => a.from - b.from);
          },
        },
      });
    },
    { markdown, mode, rendering },
  );
}

async function mountViewport(page: Page, markdown: string, mode: ViewportMode, rendering: ViewportRendering): Promise<void> {
  await mount(page, FIXTURE, { expose: EXPOSE });
  await openViewport(page, markdown, mode, rendering);
}

const content = (page: Page) => page.locator("#host .cm-content");
const htmlContainer = (page: Page) => page.locator("#host > [data-viewport-html]");
const markdownOf = (page: Page) => page.evaluate(() => window.viewport.getMarkdown());

test("mounts one editor in the host's shadow root, and hands the text back byte for byte across every mode and rendering", async ({ page }) => {
  const markdown = "Setext\n======\n\n* star  \n\ttab\\*\r\nlast";
  await mountViewport(page, markdown, "view", "raw");
  for (const mode of ["edit", "view"] as const) {
    for (const rendering of ["styled", "raw", "html"] as const) {
      await page.evaluate((state) => (window.viewport.setMode(state.mode), window.viewport.setRendering(state.rendering)), { mode, rendering });
      await expect(page.locator("#host .cm-editor")).toHaveCount(1);
      expect(await markdownOf(page)).toBe(markdown);
    }
  }
  expect(await page.evaluate(() => document.getElementById("host")?.shadowRoot !== null)).toBe(true);
});

test("takes typing only in edit mode, and reports each change", async ({ page }) => {
  await mountViewport(page, "a", "view", "raw");
  await expect(content(page)).toHaveAttribute("contenteditable", "false");

  await page.evaluate(() => window.viewport.setMode("edit"));
  await content(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" [b](");

  expect(await page.evaluate(() => [window.viewport.getMarkdown(), window.changes > 0])).toEqual(["a [b](", true]);
});

test("continues a list on Enter, ends it on an empty item, and breaks a line plainly after it", async ({ page }) => {
  await mountViewport(page, "1. one", "edit", "raw");
  await content(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(await markdownOf(page)).toBe("1. one\n2. two\n");

  await page.keyboard.press("Enter");
  await page.keyboard.type("a");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");
  expect(await markdownOf(page)).toBe("1. one\n2. two\n\na\nb");
});

test("wraps the selection on Mod-B, Mod-I and Mod-E and unwraps it on a second press, and selects the url Mod-K writes", async ({ page }) => {
  await mountViewport(page, "word", "edit", "raw");
  await content(page).click();
  const wrapped: string[] = [];
  for (const key of ["b", "i", "e"]) {
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press(`ControlOrMeta+${key}`);
    wrapped.push(await markdownOf(page));
    await page.keyboard.press(`ControlOrMeta+${key}`);
    wrapped.push(await markdownOf(page));
  }
  expect(wrapped).toEqual(["**word**", "word", "*word*", "word", "`word`", "word"]);

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+k");
  expect(await markdownOf(page)).toBe("[word](url)");
  await page.keyboard.type("https://x.test");
  expect(await markdownOf(page)).toBe("[word](https://x.test)");
});

test("leaves Enter to the input method while it is composing, continuing no list", async ({ page }) => {
  await mountViewport(page, "- a", "edit", "raw");
  await content(page).click();
  await page.keyboard.press("End");
  const session = await page.context().newCDPSession(page);
  await session.send("Input.imeSetComposition", { text: "\u304B", selectionStart: 1, selectionEnd: 1 });
  await expect.poll(() => markdownOf(page)).toBe("- a\u304B");

  await page.keyboard.press("Enter");

  expect(await markdownOf(page)).not.toMatch(/\n- /);
});

test("ticks a task when its checkbox is clicked in an editable viewport", async ({ page }) => {
  await mountViewport(page, "- [ ] task", "edit", "styled");

  await page.locator("#host input.cm-md-task").click();

  expect(await markdownOf(page)).toBe("- [x] task");
});

test("swaps in replaced text without reporting a change, keeping the cursor, and the reader's undo keeps it", async ({ page }) => {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await mountViewport(page, "one\ntwo\nthree", "edit", "raw");
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  const typedChanges = await page.evaluate(() => window.changes);

  await page.evaluate(() => window.viewport.replace("ONE\ntwo\nthree!", { preserveSelection: true }));
  expect(await page.evaluate(() => [window.viewport.getMarkdown(), window.changes])).toEqual(["ONE\ntwo\nthree!", typedChanges]);

  await page.keyboard.type("?");
  expect(await page.evaluate(() => window.viewport.getMarkdown())).toBe("ONE\ntwo\nthree!?");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.viewport.getMarkdown())).toBe("ONE\ntwo\nthree");
});

test("draws the injected dialect when styled: a chip for a link it resolves, its tag, and its callout kind", async ({ page }) => {
  await mountViewport(page, MARKDOWN, "view", "styled");

  await expect(page.locator("#host .cm-md-link-chip")).toHaveText("Seven");
  await expect(page.locator("#host .cm-md-link-chip")).toHaveAttribute("title", "id:7");
  await expect(page.locator("#host .cm-md-tag")).toHaveText("#tag");
  await expect(page.locator("#host .cm-md-callout-note")).toHaveCount(2);
  await expect(page.locator("#host input.cm-md-task")).toBeDisabled();
});

test("shows the raw text with no dialect drawn when raw", async ({ page }) => {
  await mountViewport(page, MARKDOWN, "view", "raw");

  await expect(page.locator("#host .cm-md-link-chip, #host .cm-md-tag, #host .cm-md-callout")).toHaveCount(0);
  await expect(content(page)).toContainText("[[id:7|Seven]]");
});

test("shows the dialect's HTML in html as one light-DOM .markdown document slotted into the shadow root, hiding the editor", async ({ page }) => {
  await mountViewport(page, "# Title\n\nA *word*.\n", "view", "html");

  await expect(htmlContainer(page)).toBeVisible();
  await expect(htmlContainer(page)).toHaveClass("markdown");
  await expect(htmlContainer(page).locator("h1")).toHaveText("Title");
  await expect(htmlContainer(page).locator("em")).toHaveText("word");
  await expect(page.locator("#host .cm-editor")).toBeHidden();
  expect(
    await page.evaluate(() => {
      const host = document.getElementById("host") as HTMLElement;
      return host.querySelector<HTMLElement>(":scope > [data-viewport-html]")?.assignedSlot?.getRootNode() === host.shadowRoot;
    }),
  ).toBe(true);
});

test("hides the HTML and shows the editor again on leaving html", async ({ page }) => {
  await mountViewport(page, "# Title", "view", "html");

  await page.evaluate(() => window.viewport.setRendering("raw"));

  await expect(htmlContainer(page)).toBeHidden();
  await expect(content(page)).toHaveText("# Title");
});

test("ignores typing in html whatever mode was asked for, and applies that mode on leaving html", async ({ page }) => {
  await mountViewport(page, "a", "view", "html");
  await page.evaluate(() => window.viewport.setMode("edit"));
  await htmlContainer(page).click();
  await page.keyboard.type("x");
  expect([await markdownOf(page), await page.evaluate(() => window.changes)]).toEqual(["a", 0]);

  await page.evaluate(() => window.viewport.setRendering("styled"));
  await content(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");

  expect(await markdownOf(page)).toBe("a!");
});

test("re-renders the HTML when the text is replaced in html, calling onHtml with the shown container each time", async ({ page }) => {
  await mountViewport(page, "# One", "view", "html");

  await page.evaluate(() => window.viewport.replace("# Two"));

  await expect(htmlContainer(page).locator("h1")).toHaveText("Two");
  expect(await page.evaluate(() => window.htmlCalls)).toEqual([true, true]);
});

test("writes the HTML once per text, and not at all until html is first shown", async ({ page }) => {
  await mountViewport(page, "# One", "view", "raw");
  await expect(htmlContainer(page)).toHaveCount(0);

  await page.evaluate(() => (window.viewport.setRendering("html"), window.viewport.setRendering("raw"), window.viewport.setRendering("html")));

  expect(await page.evaluate(() => window.htmlCalls)).toEqual([true]);
});

test("refuses to switch to html without a dialect that renders it", async ({ page }) => {
  await mount(page, FIXTURE, { expose: EXPOSE });

  const refused = await page.evaluate(() => {
    const viewport = window.forgeViewport.mountMarkdownViewport(document.getElementById("host") as HTMLElement, {
      markdown: "a",
      mode: "view",
      rendering: "raw",
      label: "Body",
      scroller: document.getElementById("scroller") as HTMLElement,
      onChange: () => {},
    });
    try {
      viewport.setRendering("html");
      return null;
    } catch (error) {
      return [error instanceof TypeError, viewport.getMarkdown(), document.querySelectorAll("#host > [data-viewport-html]").length];
    }
  });

  expect(refused).toEqual([true, "a", 0]);
});

const LONG = Array.from({ length: 200 }, (_, line) => `line ${line + 1} with *marks*`).join("\n\n");

const settledAnchor = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.viewport.topAnchor().line;
  });

async function scrolledAnchor(page: Page): Promise<number> {
  await page.evaluate(() => {
    const scroller = document.getElementById("scroller") as HTMLElement;
    scroller.scrollTop = 2000;
  });
  let before = await settledAnchor(page);
  for (let next = await settledAnchor(page); next !== before; next = await settledAnchor(page)) before = next;
  return before;
}

test("keeps the reader's line at the top when the rendering changes", { tag: "@cross-engine" }, async ({ page }) => {
  await mountViewport(page, LONG, "view", "raw");
  const before = await scrolledAnchor(page);
  expect(before).toBeGreaterThan(1);

  await page.evaluate(() => window.viewport.setRendering("styled"));

  await expect.poll(() => page.evaluate(() => window.viewport.topAnchor().line)).toBe(before);
});

test("anchors on the next line holding text when a blank line is at the top", { tag: "@cross-engine" }, async ({ page }) => {
  await mountViewport(page, LONG, "view", "raw");
  for (const scrollTop of [2000, 2010, 2020, 2030]) {
    await page.evaluate((top) => {
      (document.getElementById("scroller") as HTMLElement).scrollTop = top;
    }, scrollTop);

    expect((await settledAnchor(page)) % 2).toBe(1);
  }
});

test("keeps the reader's line at the top from html to raw and back", { tag: "@cross-engine" }, async ({ page }) => {
  await mountViewport(page, LONG, "view", "html");
  const before = await scrolledAnchor(page);
  expect(before).toBeGreaterThan(1);

  await page.evaluate(() => window.viewport.setRendering("raw"));
  await expect.poll(() => page.evaluate((line) => Math.abs(window.viewport.topAnchor().line - line), before)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.viewport.setRendering("html"));

  await expect.poll(() => settledAnchor(page)).toBe(before);
});

test("leaves the host and its shadow root empty once destroyed", async ({ page }) => {
  await mountViewport(page, "a", "edit", "styled");
  await page.evaluate(() => window.viewport.setRendering("html"));

  await page.evaluate(() => window.viewport.destroy());

  expect(
    await page.evaluate(() => {
      const host = document.getElementById("host") as HTMLElement;
      return [host.shadowRoot?.childNodes.length, host.childNodes.length];
    }),
  ).toEqual([0, 0]);
});
