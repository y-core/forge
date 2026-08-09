import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Toolbar } from "./toolbar";

/**
 * `Toolbar` driven through the scope `ui/core/client` registers — the whole path a consumer gets,
 * from SSR markup to keyboard behaviour, with no test-only wiring in between.
 */

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

/** Real SSR markup, flanked by plain buttons so "one Tab stop" is falsifiable. */
async function pageMarkup(orientation?: "horizontal" | "vertical"): Promise<string> {
  const toolbar = await render(
    Toolbar({
      ...(orientation ? { orientation } : {}),
      children: [
        Toolbar.Button({ id: "bold", children: "Bold" }),
        Toolbar.Separator({}),
        Toolbar.Group({ children: [Toolbar.Input({ id: "search", value: "hello" }), Toolbar.Button({ id: "clear", children: "Clear" })] }),
        Toolbar.Link({ id: "docs", href: "/docs", children: "Docs" }),
      ],
    }),
  );
  return `<button id="before">before</button>${toolbar}<button id="after">after</button>`;
}

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

test.describe("Toolbar — markup", () => {
  test("announces itself as a toolbar with its orientation", async ({ page }) => {
    await mount(page, await pageMarkup("vertical"), EXPOSE);

    const attrs = await page.evaluate(() => {
      const el = document.querySelector("[data-slot~='toolbar']");
      return {
        role: el?.getAttribute("role"),
        ariaOrientation: el?.getAttribute("aria-orientation"),
        dataOrientation: el?.getAttribute("data-orientation"),
      };
    });

    expect(attrs).toEqual({ role: "toolbar", ariaOrientation: "vertical", dataOrientation: "vertical" });
  });

  test("marks buttons, links and inputs as focus stops but not groups or separators", async ({ page }) => {
    await mount(page, await pageMarkup(), EXPOSE);

    const marked = await page.evaluate(() => [...document.querySelectorAll("[data-toolbar-item]")].map((el) => el.id));

    expect(marked).toEqual(["bold", "search", "clear", "docs"]);
  });
});

test.describe("Toolbar — one Tab stop", () => {
  test("Tab enters once and Tab again leaves, however many items there are", async ({ page }) => {
    await mount(page, await pageMarkup(), EXPOSE);
    await start(page);

    await page.focus("#before");
    await page.keyboard.press("Tab");
    expect(await focusedId(page)).toBe("bold");
    await page.keyboard.press("Tab");
    // Four focusable items inside; without roving tabindex this would be `search`.
    expect(await focusedId(page)).toBe("after");
  });

  test("resumes eagerly, so the tab stop exists before any interaction", async ({ page }) => {
    await mount(page, await pageMarkup(), EXPOSE);
    await start(page);

    const tabIndexes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-toolbar-item]")].map((el) => el.tabIndex));

    expect(tabIndexes).toEqual([0, -1, -1, -1]);
  });
});

test.describe("Toolbar — arrow navigation", () => {
  test("moves between items with the arrow keys and wraps", async ({ page }) => {
    await mount(page, await pageMarkup(), EXPOSE);
    await start(page);

    await page.focus("#bold");
    // End is pressed from a button, not from `#search`: inside a text field End belongs to the
    // caret, which the `Toolbar.Input` cases below pin separately.
    await page.keyboard.press("End");
    expect(await focusedId(page)).toBe("docs");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("bold");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("search");
  });

  test("a vertical toolbar navigates with Up and Down", async ({ page }) => {
    await mount(page, await pageMarkup("vertical"), EXPOSE);
    await start(page);

    await page.focus("#bold");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("bold");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("search");
  });
});

test.describe("Toolbar.Input", () => {
  test("keeps ArrowRight for its own caret", async ({ page }) => {
    await mount(page, await pageMarkup(), EXPOSE);
    await start(page);

    await page.focus("#search");
    await page.evaluate(() => document.querySelector<HTMLInputElement>("#search")?.setSelectionRange(0, 0));
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("search");
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>("#search")?.selectionStart)).toBe(1);
  });

  test("releases the key at the end of its text", async ({ page }) => {
    await mount(page, await pageMarkup(), EXPOSE);
    await start(page);

    await page.focus("#search");
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#search");
      field?.setSelectionRange(field.value.length, field.value.length);
    });
    await page.keyboard.press("ArrowRight");

    expect(await focusedId(page)).toBe("clear");
  });
});
