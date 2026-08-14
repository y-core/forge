import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Separator } from "./separator";

const SEPARATOR = "[data-slot~='separator']";

const UTILITY_CSS: Record<string, string> = {
  "h-full": "height: 100%",
  "min-h-full": "min-height: 100%",
  "self-stretch": "align-self: stretch",
  "w-px": "width: 1px",
  "border-0": "border-width: 0",
  "bg-border": "background-color: rgb(0, 0, 255)",
  "h-5": "height: 1.25rem",
};

function compileRenderedClasses(html: string): string {
  const match = /class="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error("no class attribute on the rendered separator");
  const declarations = match[1].split(" ").map((utility) => {
    const css = UTILITY_CSS[utility];
    if (css === undefined) throw new Error(`no compiled CSS for "${utility}" — add it to UTILITY_CSS`);
    return css;
  });
  return `<style>${SEPARATOR} { ${declarations.join("; ")} }</style>`;
}

// Tailwind's preflight zeroes the UA's `hr` block margin; production pages never paint the inset box without it.
const PREFLIGHT = "<style>hr { margin: 0 }</style>";

function markup(html: string, rowStyle: string): string {
  return `${PREFLIGHT}${compileRenderedClasses(html)}
    <div id="row" style="display: flex; align-items: center; gap: 8px; ${rowStyle}">
      <button id="control" type="button" style="height: 34px; border: 0">Rename</button>
      ${html}
      <button type="button" style="height: 34px; border: 0">Delete</button>
    </div>`;
}

interface Boxes {
  separator: { width: number; height: number };
  control: number;
  rowContent: number;
}

async function measure(page: Page): Promise<Boxes> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement;
    const row = document.querySelector("#row") as HTMLElement;
    const control = document.querySelector("#control") as HTMLElement;
    const { width, height } = el.getBoundingClientRect();
    return { separator: { width, height }, control: control.getBoundingClientRect().height, rowContent: row.clientHeight };
  }, SEPARATOR);
}

test("a vertical separator in an auto-height flex row has a visible height", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical" }));
  await mount(page, markup(html, ""));

  const boxes = await measure(page);

  expect(boxes.separator.height).toBeGreaterThan(0);
  expect(boxes.separator.width).toBeGreaterThan(0);
});

test("a vertical separator in a definite-height flex row still fills the line", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical" }));
  await mount(page, markup(html, "height: 72px"));

  const boxes = await measure(page);

  expect(boxes.separator.height).toBeGreaterThan(boxes.control);
  expect(boxes.separator.height).toBeLessThanOrEqual(boxes.rowContent);
});

test("a caller's explicit height wins over the base, which emits both", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical", class: "h-5" }));
  await mount(page, markup(html, "height: 72px"));

  const boxes = await measure(page);

  expect(boxes.separator.height).toBeGreaterThan(0);
  expect(boxes.separator.height).toBeLessThan(boxes.rowContent);
});
