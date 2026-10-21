import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses } from "../client/browser.fixture";
import { Collapsible } from "./collapsible";
import { Dialog } from "./dialog";
import { createIcon } from "./icon";
import { Menu } from "./menu";
import { Popover } from "./popover";
import { Tooltip } from "./tooltip";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const ICON = createIcon("/sprite.svg");

const FIXTURE = `<style>
  body { margin: 0; }
  [data-slot~="popover-trigger"] { position: fixed; top: 200px; left: 120px; }
</style>`;

const DISCLOSURE = `<style>
  [data-slot~="collapsible-content"] { display: block; block-size: 60px; }
</style>`;

const CONSUMER_MOTION =
  "translate-y-0 opacity-100 not-open:translate-y-2 not-open:opacity-0 motion-safe:transition-[opacity,translate,display,overlay] motion-safe:transition-discrete motion-safe:duration-300 motion-safe:ease-linear motion-safe:starting:open:translate-y-2 motion-safe:starting:open:opacity-0";

function markup(): Promise<string> {
  return render(
    Popover({
      children: [
        Popover.Trigger({ for: "tips", children: "Tips" }),
        Popover.Content({ id: "tips", label: "Tips", side: "bottom", class: CONSUMER_MOTION, children: "Body" }),
      ],
    }),
  );
}

async function open(page: Page): Promise<void> {
  const html = await markup();
  await mount(page, `${FIXTURE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`);
  await page.click('[data-slot~="popover-trigger"]');
}

const panelOpacity = (page: Page) => page.evaluate(() => Number(getComputedStyle(document.querySelector("#tips") as HTMLElement).opacity));

test.describe("overlay motion is the platform's", () => {
  // The UA applies `@starting-style` inside the style engine, so the first painted frame is already
  // the starting one — no frame of scheduling is needed to produce a from-value.
  test("@starting-style supplies the enter's from-value in the same task as the click", async ({ page }) => {
    await open(page);

    // A ceiling, not an exact `0`: under parallel load a frame or two of the transition has already
    // elapsed by the time the value is read.
    expect(await panelOpacity(page), "the first frame painted at full opacity — the enter never had a from-value").toBeLessThan(0.5);
    expect(await page.evaluate(() => document.querySelector("#tips")?.matches(":popover-open")), "already open, and still transparent").toBe(true);
  });

  test("the enter interpolates rather than snapping", async ({ page }) => {
    await open(page);
    const mid = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const panel = document.querySelector("#tips") as HTMLElement;
          let frames = 0;
          const tick = () => {
            frames += 1;
            if (frames < 3) {
              requestAnimationFrame(tick);
              return;
            }
            resolve(Number(getComputedStyle(panel).opacity));
          };
          requestAnimationFrame(tick);
        }),
    );

    expect(mid > 0 && mid < 1, `mid-enter opacity ${mid} is not strictly between 0 and 1`).toBe(true);
    await expect.poll(() => panelOpacity(page)).toBe(1);
  });

  // Only `transition-behavior: allow-discrete` on `display` and `overlay` can hold the element in
  // the top layer through the exit; no script can.
  test("Escape leaves the panel painted and in the top layer for the whole exit", async ({ page }) => {
    await open(page);
    await expect.poll(() => panelOpacity(page)).toBe(1);

    const frames = await page.evaluate(
      () =>
        new Promise<Array<{ open: boolean; height: number; display: string; overlay: string; opacity: number }>>((resolve) => {
          const panel = document.querySelector("#tips") as HTMLElement;
          const out: Array<{ open: boolean; height: number; display: string; overlay: string; opacity: number }> = [];
          panel.hidePopover();
          const tick = () => {
            const style = getComputedStyle(panel);
            out.push({
              open: panel.matches(":popover-open"),
              height: Math.round(panel.getBoundingClientRect().height),
              display: style.display,
              overlay: style.getPropertyValue("overlay"),
              opacity: Number(style.opacity),
            });
            if (out.length < 12) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );

    const exiting = frames.filter((frame) => !frame.open);
    expect(exiting.length, `no frame caught the panel after the close: ${JSON.stringify(frames)}`).toBeGreaterThan(0);
    for (const frame of exiting) {
      expect(frame.height, `a closing frame had no box: ${JSON.stringify(frame)}`).toBeGreaterThan(0);
      expect(frame.display, `a closing frame was already display:none: ${JSON.stringify(frame)}`).not.toBe("none");
      expect(frame.overlay, `a closing frame left the top layer: ${JSON.stringify(frame)}`).toBe("auto");
    }
    expect(
      exiting.some((frame) => frame.opacity > 0 && frame.opacity < 1),
      `the exit never interpolated: ${JSON.stringify(exiting)}`,
    ).toBe(true);
  });
});

const CLIENT = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function mountDefaults(page: Page): Promise<void> {
  const html = await render([
    Popover({
      children: [
        Popover.Trigger({ for: "tips", children: "Tips" }),
        Popover.Content({ id: "tips", label: "Tips", side: "bottom", align: "center", children: "Body" }),
      ],
    }),
    Menu({
      children: [
        Menu.Trigger({ for: "file-menu", children: "File" }),
        Menu.Popup({
          triggered: true,
          id: "file-menu",
          children: [Menu.Item({ id: "new", for: "file-menu", children: "New" }), Menu.Item({ id: "open", for: "file-menu", children: "Open" })],
        }),
      ],
    }),
    Tooltip({
      children: [
        Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
        Tooltip.Content({ id: "save-tip", children: "Writes the file" }),
      ],
    }),
  ]);
  await mount(page, `${FIXTURE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`, CLIENT);
  await page.evaluate(() => window.forgeResume.resume());
}

interface OpeningFrame {
  opacity: number;
  scale: number;
  transitions: string[];
  duration: string;
}

// A `null` trigger shows the popup directly: a tooltip has no invoker to click.
function clickAndRead(page: Page, trigger: string | null, popup: string): Promise<OpeningFrame> {
  return page.evaluate(
    ([triggerSelector, popupSelector]) => {
      const el = document.querySelector(popupSelector) as HTMLElement;
      if (triggerSelector === null) el.showPopover();
      else (document.querySelector(triggerSelector) as HTMLElement).click();
      return {
        opacity: Number(getComputedStyle(el).opacity),
        scale: getComputedStyle(el).scale === "none" ? 1 : Number(getComputedStyle(el).scale),
        transitions: el.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty),
        duration: getComputedStyle(el).transitionDuration,
      };
    },
    [trigger, popup] as const,
  );
}

function exitFrames(page: Page, popup: string): Promise<Array<{ open: boolean; display: string; overlay: string; opacity: number }>> {
  return page.evaluate(
    (selector) =>
      new Promise<Array<{ open: boolean; display: string; overlay: string; opacity: number }>>((resolve) => {
        const el = document.querySelector(selector) as HTMLElement;
        const out: Array<{ open: boolean; display: string; overlay: string; opacity: number }> = [];
        el.hidePopover();
        const tick = () => {
          const style = getComputedStyle(el);
          out.push({
            open: el.matches(":popover-open"),
            display: style.display,
            overlay: style.getPropertyValue("overlay"),
            opacity: Number(style.opacity),
          });
          if (out.length < 4) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
    popup,
  );
}

const POPUPS: Array<{ name: string; trigger: string | null; popup: string }> = [
  { name: "Popover", trigger: '[data-slot~="popover-trigger"]', popup: "#tips" },
  { name: "Menu", trigger: '[data-slot~="menu-trigger"]', popup: "#file-menu" },
  { name: "Tooltip", trigger: null, popup: "#save-tip" },
];

const opacityOf = (page: Page, selector: string) =>
  page.evaluate((target) => Number(getComputedStyle(document.querySelector(target) as HTMLElement).opacity), selector);

test.describe("forge's default popup motion, with no consumer classes", () => {
  for (const { name, trigger, popup } of POPUPS) {
    test(`${name} fades in over --forge-motion-enter from a first frame below half opacity`, async ({ page }) => {
      await mountDefaults(page);
      const frame = await clickAndRead(page, trigger, popup);

      expect(frame.transitions, `no opacity transition ran on open: ${JSON.stringify(frame)}`).toContain("opacity");
      expect(frame.transitions).toContain("scale");
      expect(frame.opacity).toBeLessThan(0.5);
      expect(frame.duration).toBe("0.15s");
      await expect.poll(() => opacityOf(page, popup)).toBe(1);
    });

    test(`${name} stays painted in the top layer through a --forge-motion-exit fade`, async ({ page }) => {
      await mountDefaults(page);
      await clickAndRead(page, trigger, popup);
      await expect.poll(() => opacityOf(page, popup)).toBe(1);

      const exiting = (await exitFrames(page, popup)).filter((frame) => !frame.open);
      expect(exiting.length).toBeGreaterThan(0);
      const first = exiting[0];
      expect(first?.display, `the exit was display:none at once: ${JSON.stringify(exiting)}`).not.toBe("none");
      expect(first?.overlay, `the exit left the top layer at once: ${JSON.stringify(exiting)}`).toBe("auto");
      expect(await page.evaluate((selector) => getComputedStyle(document.querySelector(selector) as HTMLElement).transitionDuration, popup)).toBe(
        "0.1s, 0.1s, 0.1s, 0.1s",
      );
    });
  }

  test("a token set on the popup retimes its motion", async ({ page }) => {
    await mountDefaults(page);
    await page.evaluate(() => (document.querySelector("#tips") as HTMLElement).style.setProperty("--forge-motion-enter", "400ms"));

    expect((await clickAndRead(page, '[data-slot~="popover-trigger"]', "#tips")).duration).toBe("0.4s");
  });

  test("the closed scale is --forge-motion-scale, and setting it to 1 removes the scale", async ({ page }) => {
    await mountDefaults(page);
    const closedScale = () => page.evaluate(() => getComputedStyle(document.querySelector("#tips") as HTMLElement).scale);

    expect(await closedScale()).toBe("0.97");
    await page.evaluate(() => (document.querySelector("#tips") as HTMLElement).style.setProperty("--forge-motion-scale", "1"));
    expect(await closedScale()).toBe("1");
  });

  test("the enter starts from --forge-motion-scale, so setting it to 1 opens unscaled", async ({ page }) => {
    await mountDefaults(page);
    expect((await clickAndRead(page, '[data-slot~="popover-trigger"]', "#tips")).scale).toBeLessThan(1);

    await mountDefaults(page);
    await page.evaluate(() => (document.querySelector("#tips") as HTMLElement).style.setProperty("--forge-motion-scale", "1"));
    expect((await clickAndRead(page, '[data-slot~="popover-trigger"]', "#tips")).scale).toBe(1);
  });

  test("a caller's transition-none opens a popover instantly", async ({ page }) => {
    const html = await render(
      Popover({
        children: [
          Popover.Trigger({ for: "tips", children: "Tips" }),
          Popover.Content({ id: "tips", label: "Tips", side: "bottom", class: "transition-none", children: "Body" }),
        ],
      }),
    );
    await mount(page, `${FIXTURE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`);

    expect(await clickAndRead(page, '[data-slot~="popover-trigger"]', "#tips")).toMatchObject({ transitions: [], opacity: 1 });
  });

  test("the menu's first item still takes focus on open", async ({ page }) => {
    await mountDefaults(page);
    await page.click('[data-slot~="menu-trigger"]');

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("new");
  });

  test.describe("under reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    for (const { name, trigger, popup } of POPUPS) {
      test(`${name} fades in without scaling`, async ({ page }) => {
        await mountDefaults(page);
        const frame = await clickAndRead(page, trigger, popup);

        expect({ transitions: frame.transitions, scale: frame.scale }).toEqual({ transitions: ["opacity"], scale: 1 });
        await expect.poll(() => opacityOf(page, popup)).toBe(1);
      });
    }
  });
});

interface Origin {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Read once the enter has settled, so the rect is the unscaled box.
async function originOf(page: Page, selector: string): Promise<Origin> {
  await expect.poll(() => opacityOf(page, selector)).toBe(1);
  return page.evaluate((target) => {
    const el = document.querySelector(target) as HTMLElement;
    const rect = el.getBoundingClientRect();
    const [x = Number.NaN, y = Number.NaN] = getComputedStyle(el)
      .transformOrigin.split(" ")
      .map((part) => Number.parseFloat(part));
    return { x, y, width: rect.width, height: rect.height };
  }, selector);
}

async function mountOrigins(page: Page, html: string): Promise<void> {
  await mount(page, `${FIXTURE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`, CLIENT);
  await page.evaluate(() => window.forgeResume.resume());
}

test.describe("the scale grows from the anchor side", () => {
  test("a bottom/start popover scales from its top-left corner", async ({ page }) => {
    await mountOrigins(
      page,
      await render(
        Popover({
          children: [
            Popover.Trigger({ for: "tips", children: "Tips" }),
            Popover.Content({ id: "tips", label: "Tips", side: "bottom", align: "start", children: "Body" }),
          ],
        }),
      ),
    );
    await page.click('[data-slot~="popover-trigger"]');

    expect(await originOf(page, "#tips")).toMatchObject({ x: 0, y: 0 });
  });

  test("a centre-aligned tooltip nested in a bottom/start popover scales from its own centre, not the popover's corner", async ({ page }) => {
    await mountOrigins(
      page,
      await render(
        Popover({
          children: [
            Popover.Trigger({ for: "tips", children: "Tips" }),
            Popover.Content({
              id: "tips",
              label: "Tips",
              side: "bottom",
              align: "start",
              children: Tooltip({
                children: [
                  Tooltip.Trigger({ id: "save", for: "save-tip", children: "Save" }),
                  Tooltip.Content({ id: "save-tip", children: "Writes the file" }),
                ],
              }),
            }),
          ],
        }),
      ),
    );
    await page.click('[data-slot~="popover-trigger"]');
    await page.evaluate(() => (document.querySelector("#save-tip") as HTMLElement).showPopover());

    const { x, y, width, height } = await originOf(page, "#save-tip");
    expect(x).toBeCloseTo(width / 2, 2);
    expect(y).toBeCloseTo(height, 2);
  });

  test("a top/end popover scales from its bottom-right corner", async ({ page }) => {
    await mountOrigins(
      page,
      await render(
        Popover({
          children: [
            Popover.Trigger({ for: "tips", children: "Tips" }),
            Popover.Content({ id: "tips", label: "Tips", side: "top", align: "end", children: "Body" }),
          ],
        }),
      ),
    );
    await page.click('[data-slot~="popover-trigger"]');

    const { x, y, width, height } = await originOf(page, "#tips");
    expect(x).toBeCloseTo(width, 2);
    expect(y).toBeCloseTo(height, 2);
  });

  test("a block-end/start menu under dir=rtl scales from its top-right corner, where its placement aligns it", async ({ page }) => {
    const menu = await render(
      Menu({
        children: [
          Menu.Trigger({ for: "file-menu", children: "File" }),
          Menu.Popup({
            triggered: true,
            id: "file-menu",
            side: "block-end",
            align: "start",
            children: [Menu.Item({ id: "new", for: "file-menu", children: "New" })],
          }),
        ],
      }),
    );
    await mountOrigins(page, `<div dir="rtl">${menu}</div>`);
    await page.click('[data-slot~="menu-trigger"]');

    const { x, y, width } = await originOf(page, "#file-menu");
    expect(x).toBeCloseTo(width, 2);
    expect(y).toBe(0);
  });

  test("a context menu scales from the corner openPopoverAt puts on the click", async ({ page }) => {
    await mountOrigins(
      page,
      await render(Menu.Popup({ id: "ctx", label: "Edit", coords: true, children: [Menu.Item({ id: "cut", for: "ctx", children: "Cut" })] })),
    );
    await page.evaluate(() => (document.querySelector("#ctx") as HTMLElement).showPopover());

    expect(await originOf(page, "#ctx")).toMatchObject({ x: 0, y: 0 });
  });

  test("a Dialog stays centred", async ({ page }) => {
    await mountOrigins(
      page,
      await render([
        Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete" }),
        Dialog({ id: "confirm", titled: true, children: [Dialog.Title({ for: "confirm", children: "Delete project?" })] }),
      ]),
    );
    await page.click("#open-it");

    const { x, y, width, height } = await originOf(page, "#confirm");
    expect(x).toBeCloseTo(width / 2, 2);
    expect(y).toBeCloseTo(height / 2, 2);
  });
});

test.describe("the disclosure height animation", () => {
  // The one place `forge-ui-interaction-no-motion-on-layout` permits animating a layout property,
  // and it is only expressible because `interpolate-size` makes `auto` an interpolable keyword.
  test("::details-content interpolates to auto rather than snapping open", async ({ page }) => {
    const html = await render(
      Collapsible({
        children: [
          Collapsible.Trigger({ icon: ICON, children: "More" }),
          Collapsible.Content({ children: "Body copy that occupies real height." }),
        ],
      }),
    );
    await mount(page, `${DISCLOSURE}<style>${await compiledCss(renderedClasses(html))}</style>${html}`);

    // The shipped rules, read off the pseudo-element rather than assumed from the source file.
    const declared = await page.evaluate(() => {
      const details = document.querySelector("details") as HTMLDetailsElement;
      return {
        root: getComputedStyle(document.documentElement).getPropertyValue("interpolate-size"),
        closedSize: getComputedStyle(details, "::details-content").blockSize,
        transition: getComputedStyle(details, "::details-content").transitionProperty,
      };
    });
    expect(declared.root, "`auto` only interpolates when the opt-in is on the root").toBe("allow-keywords");
    expect(declared.closedSize, "the closed disclosure has no from-value to transition out of").toBe("0px");
    expect(declared.transition.split(", "), "the disclosure declares no height transition").toEqual(["block-size", "content-visibility"]);

    // `mount` injects the sheet with `addStyleTag`, which lands after the first style resolution;
    // measured, the transition only takes from a settled one, so the frames are let run out first.
    const frames = await page.evaluate(
      () =>
        new Promise<{ closed: number; frames: number[]; settled: number }>((resolve) => {
          const details = document.querySelector("details") as HTMLDetailsElement;
          const height = () => Math.round(details.getBoundingClientRect().height);
          let settle = 0;
          const start = () => {
            if (settle++ < 6) {
              requestAnimationFrame(start);
              return;
            }
            const closed = height();
            const out: number[] = [];
            details.open = true;
            const tick = () => {
              out.push(height());
              if (out.length < 8) {
                requestAnimationFrame(tick);
                return;
              }
              setTimeout(() => resolve({ closed, frames: out, settled: height() }), 400);
            };
            requestAnimationFrame(tick);
          };
          start();
        }),
    );

    expect(frames.settled, "the content never contributed height at all").toBeGreaterThan(frames.closed);
    expect(
      frames.frames.some((height) => height > frames.closed && height < frames.settled),
      `every frame was either ${frames.closed} or ${frames.settled} — it snapped: ${JSON.stringify(frames.frames)}`,
    ).toBe(true);
  });
});
