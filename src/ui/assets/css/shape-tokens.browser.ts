import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../../render/jsx/jsx-runtime";
import type { JSXNode } from "../../../render/jsx/types";
import { render } from "../../../testing/render";
import { Toolbar as ChromeToolbar } from "../../chrome/toolbar";
import { mount, withCompiledCss } from "../../client/browser.fixture";
import { Button } from "../../core/button";
import { Card } from "../../core/card";
import { CheckboxGroup } from "../../core/checkbox-group";
import { Dialog } from "../../core/dialog";
import { createIcon } from "../../core/icon";
import { Input } from "../../core/input";
import { Menu } from "../../core/menu";
import { NumberField } from "../../core/number-field";
import { Popover } from "../../core/popover";
import { RadioGroup } from "../../core/radio-group";
import { Toggle } from "../../core/toggle";
import { ToggleGroup } from "../../core/toggle-group";
import { Toolbar } from "../../core/toolbar";

const SHAPES = { default: "", compact: readFileSync(fileURLToPath(new URL("./shape-compact.css", import.meta.url)), "utf-8") } as const;

const SIZES = ["sm", "md", "lg"] as const;

const icon = createIcon("/sprite.svg", { "icon-layers": "0 0 24 24" });

const BORDERED: Record<string, string> = {
  card: "[data-slot~='card']",
  dialog: "#bordered-dialog",
  "popover-content": "#bordered-popover",
  "menu-popup": "#bordered-menu",
  "toolbar-flyout": "[data-slot~='toolbar-flyout']",
  "number-field-decrement": "[data-slot~='number-field-decrement']",
  "number-field-increment": "[data-slot~='number-field-increment']",
  "toolbar-input": "[data-slot~='toolbar-input']",
  "checkbox-group-input": "[data-slot~='checkbox-group-input']",
  "radio-group-input": "[data-slot~='radio-group-input']",
  input: "[data-slot~='input']",
  "toggle-group-item-horizontal": "#bordered-toggle-row > [data-slot~='toggle-group-item']:first-child",
  "toggle-group-item-vertical": "#bordered-toggle-column > [data-slot~='toggle-group-item']:first-child",
};

const borderedSurfaces = (): JSXNode => [
  Card({ children: "Card body" }),
  Dialog({ id: "bordered-dialog", label: "Rename", open: true, children: Dialog.Content({ children: "Body." }) }),
  Popover({
    children: [
      Popover.Trigger({ for: "bordered-popover", children: jsx("span", { id: "bordered-popover-trigger", children: "Share" }) }),
      Popover.Content({ id: "bordered-popover", labelledby: "bordered-popover-trigger", children: "Share options" }),
    ],
  }),
  Menu({
    children: [
      Menu.Trigger({ for: "bordered-menu", children: "Options" }),
      Menu.Popup({ id: "bordered-menu", triggered: true, children: Menu.Item({ for: "bordered-menu", children: "Rename" }) }),
    ],
  }),
  ChromeToolbar({
    icon,
    config: { label: "Scene tools", groups: [{ items: [{ kind: "popover", icon: "layers", label: "Layers", content: "Layer list" }] }] },
  }),
  NumberField({ children: [NumberField.Decrement({}), NumberField.Input({ "aria-label": "Quantity" }), NumberField.Increment({})] }),
  Toolbar({ label: "Find bar", children: Toolbar.Input({ "aria-label": "Find" }) }),
  CheckboxGroup({ name: "cg", children: CheckboxGroup.Item({ name: "cg", value: "a", children: "Olives" }) }),
  RadioGroup({ name: "rg", children: RadioGroup.Item({ name: "rg", value: "s", children: "Small" }) }),
  Input({ "aria-label": "Name" }),
  ToggleGroup({
    id: "bordered-toggle-row",
    label: "Alignment",
    children: [
      ToggleGroup.Item({ name: "tg-row", value: "start", children: "Start" }),
      ToggleGroup.Item({ name: "tg-row", value: "end", children: "End" }),
    ],
  }),
  ToggleGroup({
    id: "bordered-toggle-column",
    label: "View",
    orientation: "vertical",
    children: [
      ToggleGroup.Item({ name: "tg-col", value: "list", children: "List" }),
      ToggleGroup.Item({ name: "tg-col", value: "grid", children: "Grid" }),
    ],
  }),
];

async function mountMarkup(page: Page, markup: JSXNode, css: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const html = await render(markup);
  await mount(page, await withCompiledCss(`<style>${css}</style>${html}`));
}

function borderWidths(page: Page): Promise<Record<string, number[]>> {
  return page.evaluate((selectors) => {
    for (const el of document.querySelectorAll<HTMLElement>("[popover]")) el.showPopover();
    return Object.fromEntries(
      Object.entries(selectors).map(([slot, selector]) => {
        const style = getComputedStyle(document.querySelector(selector) as HTMLElement);
        const sides = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
        return [slot, sides.map((width) => Number.parseFloat(width))];
      }),
    );
  }, BORDERED);
}

const everySlot = (widths: number[]): Record<string, number[]> => Object.fromEntries(Object.keys(BORDERED).map((slot) => [slot, widths]));

test.describe("--border-width reaches every bordered surface", { tag: "@cross-engine" }, () => {
  test("every surface's four borders are 2px under --border-width: 2px", async ({ page }) => {
    await mountMarkup(page, borderedSurfaces(), ":root { --border-width: 2px; }");

    expect(await borderWidths(page)).toEqual(everySlot([2, 2, 2, 2]));
  });

  test("the same surfaces are 1px with no override, so the 2px case is the token at work", async ({ page }) => {
    await mountMarkup(page, borderedSurfaces(), "");

    expect(await borderWidths(page)).toEqual(everySlot([1, 1, 1, 1]));
  });
});

interface ControlBox {
  height: number;
  paddingInlineStart: string;
  whiteSpace: string;
}

function boxesOf(page: Page, selectors: Record<string, string>): Promise<Record<string, ControlBox>> {
  return page.evaluate(
    (targets) =>
      Object.fromEntries(
        Object.entries(targets).map(([name, selector]) => {
          const el = document.querySelector(selector) as HTMLElement;
          const style = getComputedStyle(el);
          return [name, { height: el.getBoundingClientRect().height, paddingInlineStart: style.paddingInlineStart, whiteSpace: style.whiteSpace }];
        }),
      ),
    selectors,
  );
}

const CONTROLS = {
  button: "[data-slot~='button']",
  toggle: "[data-slot~='toggle']",
  decrement: "[data-slot~='number-field-decrement']",
  numberInput: "[data-slot~='number-field-input']",
  increment: "[data-slot~='number-field-increment']",
  toolbarInput: "[data-slot~='toolbar-input']",
};

const sizedControls = (size: (typeof SIZES)[number]): JSXNode => [
  Button({ size, children: "Save" }),
  Toggle({ size, children: "B" }),
  NumberField({
    children: [NumberField.Decrement({ size }), NumberField.Input({ size, "aria-label": "Quantity" }), NumberField.Increment({ size })],
  }),
  Toolbar({ label: "Find bar", children: Toolbar.Input({ size, "aria-label": "Find" }) }),
];

test.describe("a control is its size's control height, under both shapes", { tag: "@cross-engine" }, () => {
  for (const [shape, css] of Object.entries(SHAPES)) {
    for (const size of SIZES) {
      test(`under the ${shape} shape at ${size}, Toggle, both steppers, NumberField.Input and Toolbar.Input are the Button's height`, async ({
        page,
      }) => {
        await mountMarkup(page, sizedControls(size), css);
        const boxes = await boxesOf(page, CONTROLS);
        const height = boxes.button?.height;

        expect({
          toggle: boxes.toggle?.height,
          decrement: boxes.decrement?.height,
          numberInput: boxes.numberInput?.height,
          increment: boxes.increment?.height,
          toolbarInput: boxes.toolbarInput?.height,
        }).toEqual({ toggle: height, decrement: height, numberInput: height, increment: height, toolbarInput: height });
      });

      test(`under the ${shape} shape at ${size}, Toggle and Toolbar.Input pad like the Button, and Toggle does not wrap`, async ({ page }) => {
        await mountMarkup(page, sizedControls(size), css);
        const boxes = await boxesOf(page, CONTROLS);
        const padding = boxes.button?.paddingInlineStart;

        expect({
          toggle: boxes.toggle?.paddingInlineStart,
          toolbarInput: boxes.toolbarInput?.paddingInlineStart,
          toggleWrap: boxes.toggle?.whiteSpace,
        }).toEqual({ toggle: padding, toolbarInput: padding, toggleWrap: "nowrap" });
      });
    }
  }

  test("an md control is 40px tall under the default shape", async ({ page }) => {
    await mountMarkup(page, sizedControls("md"), SHAPES.default);
    const boxes = await boxesOf(page, CONTROLS);

    expect(Object.fromEntries(Object.entries(boxes).map(([name, box]) => [name, box.height]))).toEqual({
      button: 40,
      toggle: 40,
      decrement: 40,
      numberInput: 40,
      increment: 40,
      toolbarInput: 40,
    });
  });

  test("a default Toolbar.Input in a vertical toolbar's group is the sm Button's height, 32px default and 28px compact", async ({ page }) => {
    const heights: Record<string, { button: number | undefined; toolbarInput: number | undefined }> = {};
    for (const [shape, css] of Object.entries(SHAPES)) {
      await mountMarkup(
        page,
        [
          Button({ size: "sm", children: "Save" }),
          Toolbar({ label: "Find rail", orientation: "vertical", children: Toolbar.Group({ children: Toolbar.Input({ "aria-label": "Find" }) }) }),
        ],
        css,
      );
      const boxes = await boxesOf(page, { button: CONTROLS.button, toolbarInput: CONTROLS.toolbarInput });
      heights[shape] = { button: boxes.button?.height, toolbarInput: boxes.toolbarInput?.height };
    }

    expect(heights).toEqual({ default: { button: 32, toolbarInput: 32 }, compact: { button: 28, toolbarInput: 28 } });
  });
});
