import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { mount } from "../../../../ui/client/browser.fixture";
import type { ViewportController, ViewportMode, ViewportRendering } from "./types";

declare global {
  interface Window {
    forgeViewport: typeof import("./mount");
    viewport: ViewportController;
    changes: number;
  }
}

const FIXTURE = `<div id="scroller" style="height: 300px; overflow: auto"><div id="host"></div></div>`;
const MARKDOWN = "# Title\n\nA *word*, #tag and [[id:7|Seven]].\n\n> [!note] Heads up\n> body\n\n- [ ] task\n";

async function mountViewport(page: Page, markdown: string, mode: ViewportMode, rendering: ViewportRendering): Promise<void> {
  await mount(page, FIXTURE, { expose: { forgeViewport: "./render/markdown/editor/client/mount" } });
  await page.evaluate(
    (opened) => {
      window.changes = 0;
      const host = document.getElementById("host") as HTMLElement;
      window.viewport = window.forgeViewport.mountMarkdownViewport(host, {
        ...opened,
        label: "Body",
        scroller: document.getElementById("scroller") as HTMLElement,
        onChange: () => (window.changes += 1),
        dialect: {
          calloutKinds: ["note"],
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

const content = (page: Page) => page.locator("#host .cm-content");

test("mounts one editor in the host's shadow root, and hands the text back byte for byte across every mode and rendering", async ({ page }) => {
  const markdown = "Setext\n======\n\n* star  \n\ttab\\*\r\nlast";
  await mountViewport(page, markdown, "view", "raw");
  for (const [mode, rendering] of [
    ["edit", "rendered"],
    ["view", "rendered"],
    ["edit", "raw"],
    ["view", "raw"],
  ] as const) {
    await page.evaluate((state) => (window.viewport.setMode(state.mode), window.viewport.setRendering(state.rendering)), { mode, rendering });
    await expect(page.locator("#host .cm-editor")).toHaveCount(1);
  }
  expect(await page.evaluate(() => [document.getElementById("host")?.shadowRoot !== null, window.viewport.getMarkdown()])).toEqual([
    true,
    markdown,
  ]);
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

test("swaps in replaced text without reporting a change, keeping the cursor, and the reader's undo keeps it", async ({ page }) => {
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

test("draws the injected dialect when rendered: a chip for a link it resolves, its tag, and its callout kind", async ({ page }) => {
  await mountViewport(page, MARKDOWN, "view", "rendered");

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

test("keeps the reader's line at the top when the rendering changes", async ({ page }) => {
  const markdown = Array.from({ length: 200 }, (_, line) => `line ${line + 1} with *marks*`).join("\n\n");
  await mountViewport(page, markdown, "view", "raw");
  await page.evaluate(() => {
    const scroller = document.getElementById("scroller") as HTMLElement;
    scroller.scrollTop = 2000;
  });
  const settledAnchor = () =>
    page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.viewport.topAnchor().line;
    });
  let before = await settledAnchor();
  for (let next = await settledAnchor(); next !== before; next = await settledAnchor()) before = next;
  expect(before).toBeGreaterThan(1);

  await page.evaluate(() => window.viewport.setRendering("rendered"));

  await expect.poll(() => page.evaluate(() => window.viewport.topAnchor().line)).toBe(before);
});

test("leaves the shadow root empty once destroyed", async ({ page }) => {
  await mountViewport(page, "a", "edit", "rendered");

  await page.evaluate(() => window.viewport.destroy());

  expect(await page.evaluate(() => document.getElementById("host")?.shadowRoot?.childNodes.length)).toBe(0);
});
