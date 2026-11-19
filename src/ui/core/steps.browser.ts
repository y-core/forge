import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createElement } from "../../render/jsx/element";
import { render } from "../../testing/render";
import { mount, withCompiledCss } from "../client/browser.fixture";
import { Steps } from "./steps";
import { Timeline } from "./timeline";
import type { StepState } from "./utils/types";

const STATES: readonly StepState[] = ["complete", "current", "upcoming"];

/** One item per state rendered as that state, and one per state the client will move to another. */
async function trails(): Promise<string> {
  const items = (item: typeof Steps.Step | typeof Timeline.Item) =>
    STATES.flatMap((state) => [
      createElement(item, { state, "data-rendered": state, marker: "1" }),
      createElement(item, { state, "data-moved": state, marker: "1" }),
    ]);
  const steps = await render(createElement(Steps, { id: "steps", orientation: "vertical", children: items(Steps.Step) }));
  const timeline = await render(createElement(Timeline, { id: "timeline", children: items(Timeline.Item) }));
  return `${steps}${timeline}`;
}

type Paint = { background: string; border: string; text: string };

/** Moves each `data-moved` item from its rendered state to `to`, then reads its marker beside the marker of an item rendered as `to`. */
function moveAndRead(page: Page, root: string, marker: string, to: StepState): Promise<{ moved: Paint[]; rendered: Paint }> {
  return page.evaluate(
    (args) => {
      const paint = (item: Element): Paint => {
        const style = getComputedStyle(item.querySelector(`[data-slot~='${args.marker}']`) as HTMLElement);
        return { background: style.backgroundColor, border: style.borderTopColor, text: style.color };
      };
      const moved = [...document.querySelectorAll(`#${args.root} [data-moved]`)];
      for (const item of moved) item.setAttribute("data-state", args.to);
      return { moved: moved.map(paint), rendered: paint(document.querySelector(`#${args.root} [data-rendered='${args.to}']`) as Element) };
    },
    { root, marker, to },
  );
}

test.describe("Steps and Timeline — a marker follows the state the client sets", { tag: "@cross-engine" }, () => {
  for (const [root, marker] of [
    ["steps", "steps-marker"],
    ["timeline", "timeline-marker"],
  ] as const) {
    for (const to of STATES) {
      test(`a ${root} item set to ${to} paints its marker as one rendered ${to}`, async ({ page }) => {
        await mount(page, await withCompiledCss(await trails()));

        const { moved, rendered } = await moveAndRead(page, root, marker, to);

        expect(moved).toEqual(STATES.map(() => rendered));
      });
    }
  }

  test("a Steps nested in a complete Timeline item paints each marker from its own step, not the outer item", async ({ page }) => {
    const nested = createElement(Steps, {
      children: (["upcoming", "current"] as const).map((state) => createElement(Steps.Step, { state, "data-nested": state, marker: "1" })),
    });
    const outer = await render(
      createElement(Timeline, { id: "outer", children: createElement(Timeline.Item, { state: "complete", children: nested }) }),
    );
    await mount(page, await withCompiledCss(`${await trails()}${outer}`));

    const painted = await page.evaluate(() => {
      const paint = (item: Element) => {
        const style = getComputedStyle(item.querySelector("[data-slot~='steps-marker']") as HTMLElement);
        return `${style.backgroundColor} ${style.borderTopColor} ${style.color}`;
      };
      return (["upcoming", "current"] as const).map((state) => [
        paint(document.querySelector(`#outer [data-nested='${state}']`) as Element),
        paint(document.querySelector(`#steps [data-rendered='${state}']`) as Element),
      ]);
    });

    expect(painted.map(([inner, alone]) => inner === alone)).toEqual([true, true]);
  });

  test("the three states paint three different markers, so an equal paint is not a vacuous one", async ({ page }) => {
    await mount(page, await withCompiledCss(await trails()));

    const painted = await page.evaluate(() =>
      [...document.querySelectorAll("#steps [data-rendered] [data-slot~='steps-marker']")].map((marker) => {
        const style = getComputedStyle(marker);
        return `${style.backgroundColor} ${style.borderTopColor} ${style.color}`;
      }),
    );

    expect(new Set(painted).size).toBe(3);
  });
});
