import { expect, type Page, test } from "@playwright/test";
import { render } from "../../testing/render";
import { mount } from "../client/browser-test-helper";
import { Collapsible } from "./collapsible";
import { createIcon } from "./icon";
import { Popover } from "./popover";

const ICON = createIcon("/sprite.svg");

const CSS = { css: ["./ui/assets/css/forge-ui.css"] };

/** What the Tailwind classes a consumer writes compile to — `starting:opacity-0` is `@starting-style`,
 * and `transition-discrete` is `transition-behavior: allow-discrete`. Specs get no Tailwind build,
 * so the compiled form is written out. */
const MOTION = `<style>
  body { margin: 0; }
  [data-slot~="popover-trigger"] { position: fixed; top: 200px; left: 120px; }
  [data-slot~="popover-content"] {
    opacity: 1;
    translate: 0 0;
    transition: opacity 300ms linear, translate 300ms linear, display 300ms allow-discrete, overlay 300ms allow-discrete;
  }
  @starting-style { [data-slot~="popover-content"]:popover-open { opacity: 0; translate: 0 8px; } }
  [data-slot~="popover-content"]:not(:popover-open) { opacity: 0; translate: 0 8px; }
</style>`;

function markup(): Promise<string> {
  return render(
    Popover({ children: [Popover.Trigger({ id: "tips", children: "Tips" }), Popover.Content({ id: "tips", side: "bottom", children: "Body" })] }),
  );
}

async function open(page: Page): Promise<void> {
  await mount(page, `${MOTION}${await markup()}`, CSS);
  await page.click('[data-slot~="popover-trigger"]');
}

const panelOpacity = (page: Page) => page.evaluate(() => Number(getComputedStyle(document.querySelector("#tips") as HTMLElement).opacity));

test.describe("overlay motion is the platform's", () => {
  // The double-rAF the deleted `mountTransitionState` used existed only to give the enter a "from"
  // value one frame late. The UA does it inside the style engine, so the first painted frame is
  // already the starting one.
  test("@starting-style supplies the enter's from-value in the same task as the click", async ({ page }) => {
    await open(page);

    // A ceiling, not an exact `0`: by the time the value is read the transition has legitimately
    // begun, so under parallel load a frame or two of it has already elapsed. What the test is for
    // is that the enter *had* a from-value at all — a missing one paints at full opacity, which no
    // amount of scheduling noise can push below this bound.
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

  // `transition-behavior: allow-discrete` on `display` plus `overlay` is what the JavaScript could
  // not do at all: the old controller kept the box painted with a timer it derived by string-parsing
  // `getComputedStyle`, and could not keep the element in the top layer for a single frame.
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

const DISCLOSURE = `<style>
  [data-slot~="collapsible-panel"] { display: block; block-size: 60px; }
</style>`;

test.describe("the disclosure height animation", () => {
  // The one place `forge-ui-interaction-no-motion-on-layout` permits animating a layout property,
  // and it is only expressible because `interpolate-size` makes `auto` an interpolable keyword.
  test("::details-content interpolates to auto rather than snapping open", async ({ page }) => {
    const html = await render(
      Collapsible({
        children: [Collapsible.Trigger({ icon: ICON, children: "More" }), Collapsible.Panel({ children: "Body copy that occupies real height." })],
      }),
    );
    await mount(page, `${DISCLOSURE}${html}`, CSS);

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
