import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Separator } from "./separator";

/**
 * A vertical divider is a layout question, and a layout question is a question about boxes. The
 * markup a unit case reads is identical whether the rule sizes the element or resolves to nothing,
 * so only a measured bounding box can tell the two apart: a percentage height needs an ancestor with
 * a definite height, and the commonest host for a vertical divider — an auto-height `flex
 * items-center` toolbar row — has none.
 *
 * The page loads no Tailwind, so the component's own classes are compiled here. The table is
 * exhaustive and unknown classes throw, which is what keeps a base change from quietly turning these
 * cases vacuous: a new utility fails loudly rather than measuring an unstyled element.
 */

const SEPARATOR = "[data-slot~='separator']";

/** The declaration this fixture paints for each utility a Separator, or a case's own override
 * class, can emit. Geometry matches Tailwind's; the colour is arbitrary, since nothing measures it. */
const UTILITY_CSS: Record<string, string> = {
  "h-full": "height: 100%",
  "min-h-full": "min-height: 100%",
  "self-stretch": "align-self: stretch",
  "w-px": "width: 1px",
  "border-0": "border-width: 0",
  "bg-border": "background-color: rgb(0, 0, 255)",
  "h-5": "height: 1.25rem",
};

/** The class list the component actually rendered, compiled into one rule for `[data-slot~=…]`.
 *
 * Reading the classes off the markup rather than naming them here means the fixture cannot style a
 * utility the component does not emit — nor miss one it does. */
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

/** Tailwind's preflight zeroes every element's margin, and the UA gives `hr` a block margin of half
 * a line. Without this the fixture would measure a box no production page ever paints — a stretched
 * divider inset by 8px at each end. */
const PREFLIGHT = "<style>hr { margin: 0 }</style>";

/** A toolbar row: a flex line whose height comes from a 34px control unless the fixture pins one. */
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

  // The regression: `h-full` against an auto-height parent resolved to zero and the divider vanished.
  expect(boxes.separator.height).toBeGreaterThan(0);
  expect(boxes.separator.width).toBeGreaterThan(0);
});

test("a vertical separator in a definite-height flex row still fills the line", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical" }));
  await mount(page, markup(html, "height: 72px"));

  const boxes = await measure(page);

  // The case a stretch-based base could regress: the divider still spans the whole line rather than
  // collapsing to its own content, and still does not overflow the row.
  expect(boxes.separator.height).toBeGreaterThan(boxes.control);
  expect(boxes.separator.height).toBeLessThanOrEqual(boxes.rowContent);
});

test("a caller's explicit height wins over the base, which emits both", async ({ page }) => {
  const html = await render(Separator({ orientation: "vertical", class: "h-5" }));
  await mount(page, markup(html, "height: 72px"));

  const boxes = await measure(page);

  // `self-` and `h-` are separate conflict groups, so both survive `cn`. That is correct CSS: a
  // definite cross size beats `align-self: stretch`, which only applies when the cross size is auto.
  expect(boxes.separator.height).toBeGreaterThan(0);
  expect(boxes.separator.height).toBeLessThan(boxes.rowContent);
});
