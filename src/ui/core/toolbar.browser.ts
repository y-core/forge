import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../jsx/jsx-runtime";
import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { scopeAttrs } from "../contracts/scope-attrs";
import { Resumable } from "../server/resumable";
import { Toolbar } from "./toolbar";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function pageMarkup(orientation?: "horizontal" | "vertical"): Promise<string> {
  const toolbar = await render(
    Toolbar({
      label: "Formatting",
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

// `state-disabled` is `pointer-events-none`, so a pointer test cannot see this: the keyboard reaches
// an `aria-disabled` item the ring deliberately keeps focusable, and Enter synthesises a click on it.
test.describe("Toolbar — an aria-disabled item is focusable but inert", () => {
  test("Enter on a disabled button runs no action", async ({ page }) => {
    const toolbar = Toolbar({
      label: "Formatting",
      children: [
        Toolbar.Button({ id: "bold", children: "Bold" }),
        Toolbar.Button({ id: "paste", "aria-disabled": "true", ...scopeAttrs({ onClick: "act" }), children: "Paste" }),
      ],
    });
    await mount(page, await render(Resumable({ name: "editor", children: toolbar })), EXPOSE);
    await page.evaluate(() => {
      window.forgeResume.registerScope("editor", { on: { act: () => document.body.setAttribute("data-ran", "") } });
      window.forgeResume.resume();
    });

    await page.focus("#bold");
    await page.keyboard.press("ArrowRight");
    expect(await focusedId(page)).toBe("paste");
    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => document.body.hasAttribute("data-ran"))).toBe(false);
  });

  // An inert anchor renders `tabindex="0"` so it stays arrowable, which is the one item in a toolbar
  // whose markup carries the attribute — it must not be mistaken for the entry point the ring chose.
  test("is never the Tab entry point, even though its markup carries tabindex=0", async ({ page }) => {
    const toolbar = await render(
      Toolbar({
        label: "Formatting",
        children: [
          Toolbar.Button({ id: "bold", children: "Bold" }),
          Toolbar.Link({ id: "docs", href: "/docs", "aria-disabled": "true", children: "Docs" }),
          Toolbar.Button({ id: "wrap", "data-composite-item-active": "", children: "Wrap" }),
        ],
      }),
    );
    await mount(page, toolbar, EXPOSE);
    await start(page);

    const stops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-toolbar-item]")].map((el) => el.tabIndex));

    expect(stops).toEqual([-1, -1, 0]);
  });

  test("Enter on a disabled asChild link does not navigate", async ({ page }) => {
    const toolbar = await render(
      Toolbar({
        label: "Formatting",
        children: [
          Toolbar.Button({ id: "bold", children: "Bold" }),
          Toolbar.Button({ asChild: true, disabled: true, children: jsx("a", { id: "gone", href: "/deleted", children: "Delete" }) }),
        ],
      }),
    );
    await mount(page, toolbar, EXPOSE);
    await start(page);
    const before = page.url();

    await page.focus("#gone");
    await page.keyboard.press("Enter");

    expect(page.url()).toBe(before);
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
