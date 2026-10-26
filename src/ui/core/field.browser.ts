import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createElement } from "../../render/jsx/element";
import type { JSXNode } from "../../render/jsx/types";
import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import { FormField } from "./field-layout";
import { createIcon } from "./icon";
import { Input } from "./input";
import { Select } from "./select";
import { Switch } from "./switch";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

const CONTAINER_WIDTH = 600;

const TAILWIND_W_40_PX = 160;

function inField(children: JSXNode): JSXNode {
  return createElement(FormField, { children: [createElement(FormField.Label, { name: "pick", children: "Pick" }), children] });
}

async function mountInContainer(page: Page, node: JSXNode): Promise<void> {
  const html = await render(node);
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style><div style="width: ${CONTAINER_WIDTH}px">${html}</div>`);
}

function widthOf(page: Page, slot: string): Promise<number> {
  return page.evaluate((selector) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0, `[data-slot~='${slot}']`);
}

test.describe("FormField — a vertical field leaves its direct children's widths to them", { tag: "@cross-engine" }, () => {
  test("a Select sized w-40 keeps its width beside the label", async ({ page }) => {
    await mountInContainer(
      page,
      inField(
        createElement(Select, {
          icon,
          class: "w-40",
          field: { name: "pick" },
          children: createElement(Select.Option, { value: "a", children: "A" }),
        }),
      ),
    );

    expect(await widthOf(page, "select-wrapper")).toBe(TAILWIND_W_40_PX);
  });

  test("a w-fit Switch is as wide inside the field as outside it", async ({ page }) => {
    await mountInContainer(page, createElement(Switch, { class: "w-fit", field: { name: "pick" }, children: "Pick" }));
    const outside = await widthOf(page, "switch");

    await mountInContainer(page, inField(createElement(Switch, { class: "w-fit", field: { name: "pick" }, children: "Pick" })));

    expect(await widthOf(page, "switch")).toBe(outside);
  });

  test("an unsized Input still fills the field", async ({ page }) => {
    await mountInContainer(page, inField(createElement(Input, { field: { name: "pick" } })));

    expect(await widthOf(page, "input")).toBe(CONTAINER_WIDTH);
  });
});
