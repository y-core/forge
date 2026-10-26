import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createElement } from "../../render/jsx/element";
import type { JSXNode } from "../../render/jsx/types";
import { render } from "../../testing/render";
import { mount } from "../client/browser.fixture";
import { Field } from "./field-stack";
import { createIcon } from "./icon";
import { Select } from "./select";
import { Slider } from "./slider";
import { Switch } from "./switch";

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16" });

interface AxNode {
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
}

function field(label: string, children: JSXNode): Promise<string> {
  return render(createElement(Field, { label, children }));
}

async function accessibleNames(page: Page, role: string): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  const { nodes } = (await session.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
  return nodes.filter((node) => !node.ignored && node.role?.value === role).map((node) => node.name?.value ?? "");
}

test.describe("Field — the caption is the wrapped control's accessible name", () => {
  test("names a Select from its caption", async ({ page }) => {
    const select = createElement(Select, {
      icon,
      field: { name: "theme" },
      children: createElement(Select.Option, { value: "dark", children: "Dark" }),
    });
    await mount(page, await field("Theme", select));

    expect(await accessibleNames(page, "combobox")).toEqual(["Theme"]);
  });

  test("names a Slider from its caption", async ({ page }) => {
    await mount(page, await field("Volume", createElement(Slider, { id: "volume" })));

    expect(await accessibleNames(page, "slider")).toEqual(["Volume"]);
  });

  test("names a bare Switch from its caption", async ({ page }) => {
    await mount(page, await field("Alerts", createElement(Switch, { field: { name: "alerts" } })));

    expect(await accessibleNames(page, "switch")).toEqual(["Alerts"]);
  });
});
