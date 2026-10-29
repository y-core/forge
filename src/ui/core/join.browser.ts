import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Button } from "./button";
import { Join } from "./join";

interface Member {
  rounded: string[];
  overlap: number;
  drift: number;
}

async function mountJoins(page: Page): Promise<void> {
  const member = (label: string) => Button({ appearance: "outline", children: label });
  const html = await render([
    Join({ id: "row", children: [member("A"), member("B"), member("C")] }),
    Join({ id: "column", orientation: "vertical", children: [member("D"), member("E"), member("F")] }),
  ]);
  await mount(page, await withCompiledCss(html));
}

function members(page: Page, id: string): Promise<{ border: number; members: Member[] }> {
  return page.evaluate((groupId) => {
    const group = document.getElementById(groupId) as HTMLElement;
    const vertical = group.dataset.orientation === "vertical";
    const children = [...group.children];
    const first = children[0] as Element;
    const corners = ["start-start", "start-end", "end-start", "end-end"] as const;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      border: parseFloat(getComputedStyle(first).borderInlineStartWidth),
      members: children.map((child, i) => {
        const style = getComputedStyle(child);
        const box = child.getBoundingClientRect();
        const prev = children[i - 1]?.getBoundingClientRect();
        const origin = first.getBoundingClientRect();
        return {
          rounded: corners.filter((corner) => parseFloat(style.getPropertyValue(`border-${corner}-radius`)) > 0),
          overlap: prev ? round(vertical ? prev.bottom - box.top : prev.right - box.left) : 0,
          drift: round(vertical ? box.left - origin.left : box.top - origin.top),
        };
      }),
    };
  }, id);
}

test.describe("Join — the members read as one shape", { tag: "@cross-engine" }, () => {
  test("a row squares its inner corners and overlaps each pair by one border width, so no border doubles", async ({ page }) => {
    await mountJoins(page);
    const { border, members: row } = await members(page, "row");

    expect(row).toEqual([
      { rounded: ["start-start", "end-start"], overlap: 0, drift: 0 },
      { rounded: [], overlap: border, drift: 0 },
      { rounded: ["start-end", "end-end"], overlap: border, drift: 0 },
    ]);
    expect(border).toBeGreaterThan(0);
  });

  test("a column does the same on the block axis and squares no inline pair", async ({ page }) => {
    await mountJoins(page);
    const { border, members: column } = await members(page, "column");

    expect(column).toEqual([
      { rounded: ["start-start", "start-end"], overlap: 0, drift: 0 },
      { rounded: [], overlap: border, drift: 0 },
      { rounded: ["end-start", "end-end"], overlap: border, drift: 0 },
    ]);
    expect(border).toBeGreaterThan(0);
  });
});
