import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { jsx } from "../../render/jsx/jsx-runtime";
import { render } from "../../testing/render";
import { compiledCss, mount, renderedClasses, withCompiledCss } from "../client/browser.fixture";
import { Dialog } from "./dialog";
import { Drawer } from "./drawer";

declare global {
  interface Window {
    forgeResume: typeof import("../client/resume");
  }
}

const EXPOSE = { expose: { forgeResume: "./ui/client/resume", forgeCoreClient: "./ui/core/client" } };

async function start(page: Page): Promise<void> {
  await page.evaluate(() => window.forgeResume.resume());
}

function markup(open = false): Promise<string> {
  return render([
    Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete…" }),
    Dialog({
      id: "confirm",
      titled: true,
      ...(open ? { open } : {}),
      children: [
        Dialog.Title({ for: "confirm", children: "Delete project?" }),
        Dialog.Close({ for: "confirm", id: "close-it", children: "Cancel" }),
      ],
    }),
  ]);
}

function state(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("#confirm");
    return { nativeOpen: dialog?.open };
  });
}

test.describe("Dialog", { tag: "@cross-engine" }, () => {
  test("starts closed", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    expect(await state(page)).toEqual({ nativeOpen: false });
  });

  test("the trigger opens it", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: true });
  });

  test("closing clears the platform's own open state", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.click("#close-it");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  test("Escape closes it through the platform's own cancel", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  // `Drawer` pins the same three; a modal `<dialog>` gets them from `showModal()`, and nothing here
  // asserted that forge still reaches that path rather than `show()`.
  test("opening puts focus inside the panel, and closing hands it back to the invoker", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("close-it");

    await page.click("#close-it");

    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("open-it");
  });

  test("Tab is contained by the modal, which is what the top layer buys", async ({ page }) => {
    await mount(page, `<button id="outside">outside</button>${await markup()}`, EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("close-it");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("outside");
  });

  test("a server-rendered open dialog is non-modal, which is the only thing the attribute can mean", async ({ page }) => {
    await mount(page, await markup(true), EXPOSE);
    await start(page);

    // `dialog.open` alone cannot tell the two apart, which is what let the old divergence hide:
    // the trigger opened a modal while `open` rendered a non-modal, and both reported `open: true`.
    expect(await page.evaluate(() => document.querySelector<HTMLDialogElement>("#confirm")?.matches(":modal"))).toBe(false);
    expect(await state(page)).toEqual({ nativeOpen: true });
  });

  test("a non-modal <Dialog open> survives a click into a nearby input and an Escape outside it", async ({ page }) => {
    await mount(page, `<input id="outside">${await markup(true)}`, EXPOSE);
    await start(page);

    await page.click("#outside");
    await page.keyboard.press("Escape");

    expect(await state(page)).toEqual({ nativeOpen: true });
  });

  test("a modal opened by its trigger still closes on a backdrop click", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.mouse.click(5, 5);

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  test("an alert dialog ignores a backdrop click and closes on Escape", async ({ page }) => {
    const html = await render([
      Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete…" }),
      Dialog({
        id: "confirm",
        label: "Delete project?",
        alert: true,
        children: Dialog.Close({ for: "confirm", id: "close-it", children: "Cancel" }),
      }),
    ]);
    await mount(page, html, EXPOSE);
    await start(page);

    await page.click("#open-it");
    await expect.poll(async () => (await state(page)).nativeOpen).toBe(true);
    await page.mouse.click(5, 5);
    expect(await state(page)).toEqual({ nativeOpen: true });
    await page.keyboard.press("Escape");

    await expect.poll(() => state(page)).toEqual({ nativeOpen: false });
  });

  // `open` + `openModal` used to render both attributes, and `showModal()` on an already-open dialog
  // throws `InvalidStateError` — a console exception and no dialog, invisible to any markup check.
  test("an SSR modal asked for both openings resumes modal, throwing nothing", async ({ page }) => {
    const thrown: string[] = [];
    page.on("pageerror", (error) => thrown.push(error.message));
    const html = await render([
      Dialog.Trigger({ for: "confirm", id: "open-it", children: "Delete…" }),
      Dialog({
        id: "confirm",
        label: "Delete project?",
        open: true,
        openModal: true,
        children: Dialog.Close({ for: "confirm", id: "close-it", children: "Cancel" }),
      }),
    ]);
    await mount(page, html, EXPOSE);
    await start(page);

    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLDialogElement>("#confirm")?.matches(":modal"))).toBe(true);
    expect(thrown).toEqual([]);
  });
});

const VIEWPORT = { width: 1280, height: 720 };
const GUTTER = 16; // 1rem, the inset the sheet gives every modal dialog

const CALLER_WIDTH = `<style>
  @layer components, utilities;
  @layer utilities { #confirm { max-width: 20rem; } }
</style>`;

const OVERSIZED = Array.from({ length: 40 }, () => "Deleting this project removes every environment attached to it.").join(" ");

function near(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

async function openDialog(page: Page, style: string, body: string, copies = 1): Promise<void> {
  const children = Array.from({ length: copies }, () => Dialog.Content({ children: body }));
  const html = await render(Dialog({ id: "confirm", label: "Delete project?", children }));
  await page.setViewportSize(VIEWPORT);
  // Reduced motion keeps this a geometry assertion: a settled rect, whatever transition the sheet gains later.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${style}${html}`);
  await page.evaluate(() => (document.querySelector("#confirm") as HTMLDialogElement).showModal());
}

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function box(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const rect = (document.querySelector("#confirm") as HTMLElement).getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

async function closeBoxes(page: Page, close: Record<string, string>): Promise<{ button: DOMRect; icon: DOMRect | undefined }[]> {
  const glyph = () => jsx("svg", { class: "size-4", viewBox: "0 0 16 16", "aria-hidden": "true" });
  const html = await render([
    Dialog({ id: "d", open: true, label: "Panel", children: Dialog.Close({ for: "d", "aria-label": "Close", ...close, children: glyph() }) }),
    Drawer({ id: "dr", open: true, label: "Panel", children: Drawer.Close({ for: "dr", "aria-label": "Close", ...close, children: glyph() }) }),
  ]);
  await mount(page, await withCompiledCss(html));
  return page.evaluate(() =>
    [...document.querySelectorAll("button:has(> svg)")].map((button) => ({
      button: button.getBoundingClientRect().toJSON(),
      icon: button.querySelector("svg")?.getBoundingClientRect().toJSON(),
    })),
  );
}

test.describe("Dialog and Drawer — an icon-only Close", { tag: "@cross-engine" }, () => {
  test('under shape="icon" a 16px icon sits wholly inside a 32px square', async ({ page }) => {
    const boxes = await closeBoxes(page, { shape: "icon" });

    expect(boxes).toHaveLength(2);
    for (const { button, icon } of boxes) {
      if (icon === undefined) throw new Error("the Close lost its icon — the fixture proves nothing");
      expect([button.width, button.height]).toEqual([32, 32]);
      expect([icon.width, icon.height]).toEqual([16, 16]);
      expect(icon.left).toBeGreaterThanOrEqual(button.left);
      expect(icon.right).toBeLessThanOrEqual(button.right);
      expect(icon.top).toBeGreaterThanOrEqual(button.top);
      expect(icon.bottom).toBeLessThanOrEqual(button.bottom);
    }
  });

  test("a size-8 override keeps the box's px-3 and squeezes the icon, which is what shape replaces", async ({ page }) => {
    const boxes = await closeBoxes(page, { class: "size-8" });

    expect(boxes).toHaveLength(2);
    for (const { icon } of boxes) expect(icon?.width).toBeLessThan(16);
  });
});

test.describe("Dialog — the viewport gutter", { tag: "@cross-engine" }, () => {
  test("a caller's own max-width in a later layer still leaves the gutter, and stays centred", async ({ page }) => {
    await openDialog(page, CALLER_WIDTH, OVERSIZED);

    const rect = await box(page);

    expect(rect.width, "the caller's max-width did not apply — the fixture proves nothing").toBe(320);
    expect(near(rect.left, VIEWPORT.width - rect.right), `left ${rect.left} vs right ${rect.right} against ${VIEWPORT.width}`).toBe(true);
    expect(rect.left).toBeGreaterThanOrEqual(GUTTER);
    expect(rect.top).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.height - rect.bottom).toBeGreaterThanOrEqual(GUTTER);
  });

  test("with no caller width, oversized content stays inside the gutter on both axes", async ({ page }) => {
    await openDialog(page, "", OVERSIZED, 8);

    const rect = await box(page);

    expect(rect.left, `left ${rect.left} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(rect.top, `top ${rect.top} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.width - rect.right, `right ${rect.right} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);
    expect(VIEWPORT.height - rect.bottom, `bottom ${rect.bottom} breached the gutter`).toBeGreaterThanOrEqual(GUTTER);

    expect(rect.width, `width ${rect.width} — the content did not overflow, so nothing was clamped`).toBeGreaterThan(VIEWPORT.width - GUTTER * 3);
    expect(rect.height, `height ${rect.height} — the content did not overflow, so nothing was clamped`).toBeGreaterThan(
      VIEWPORT.height - GUTTER * 3,
    );
  });

  test("content smaller than the viewport is centred rather than pinned to the gutter", async ({ page }) => {
    await openDialog(page, "", "Delete project?");

    const rect = await box(page);

    expect(near(rect.left, VIEWPORT.width - rect.right), `left ${rect.left} vs right ${rect.right}`).toBe(true);
    expect(near(rect.top, VIEWPORT.height - rect.bottom), `top ${rect.top} vs bottom ${rect.bottom}`).toBe(true);
    expect(rect.top, "the dialog is pinned to the top gutter rather than centred").toBeGreaterThan(GUTTER);
  });
});

interface MotionRead {
  panel: string[];
  backdrop: string[];
  backdropOpacity: number;
  opacity: number;
  display: string;
}

// Read in the same task as the call, so the first frame of a transition is the one observed.
function actAndRead(page: Page, act: "showModal" | "close" | "none"): Promise<MotionRead> {
  return page.evaluate((call) => {
    const el = document.querySelector("dialog") as HTMLDialogElement;
    if (call !== "none") el[call]();
    const running = el.getAnimations({ subtree: true }) as CSSTransition[];
    const on = (pseudo: string | null) =>
      running.filter((animation) => (animation.effect as KeyframeEffect).pseudoElement === pseudo).map((animation) => animation.transitionProperty);
    return {
      panel: on(null),
      backdrop: on("::backdrop"),
      backdropOpacity: Number(getComputedStyle(el, "::backdrop").opacity),
      opacity: Number(getComputedStyle(el).opacity),
      display: getComputedStyle(el).display,
    };
  }, act);
}

const CONSUMER_SLIDE =
  "[--forge-motion-opacity:1] [--forge-motion-scale:1] not-open:translate-y-2 motion-safe:starting:open:translate-y-2 motion-safe:transition-[translate,display,overlay] motion-safe:transition-discrete motion-safe:duration-300";

const MODAL_EXIT_FIREFOX =
  "Firefox implements neither overlay nor a display transition, so a closing modal leaves the top layer and stops rendering at once";
const MODAL_EXIT_WEBKIT = "WebKit does not implement overlay, so a closing modal leaves the top layer and stops rendering at once";
const NO_DISPLAY_TRANSITION = "Firefox does not transition display, even with allow-discrete";
const LONGHAND_EXIT_WEBKIT =
  "WebKit drops a closing dialog's display transition once its open style sets a transition longhand, so the exit paints no frame";

async function mountStyled(page: Page, html: string): Promise<void> {
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`);
}

test.describe("Dialog — open and close motion", { tag: "@cross-engine" }, () => {
  test("a modal open fades and scales the panel and fades the backdrop", async ({ page }) => {
    await mountStyled(page, await markup());

    const frame = await actAndRead(page, "showModal");

    expect(frame.panel, JSON.stringify(frame)).toEqual(expect.arrayContaining(["opacity", "scale"]));
    expect(frame.opacity).toBeLessThan(0.5);
    expect(frame.backdropOpacity).toBe(0);
    await expect.poll(() => actAndRead(page, "none").then((settled) => settled.backdropOpacity)).toBe(1);
  });

  test("a close fades out while the panel is still painted", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
    test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
    await mountStyled(page, await markup());
    await actAndRead(page, "showModal");
    await expect.poll(() => actAndRead(page, "none").then((frame) => frame.opacity)).toBe(1);

    const frame = await actAndRead(page, "close");

    expect(frame.panel, JSON.stringify(frame)).toContain("opacity");
    expect(frame.backdrop, JSON.stringify(frame)).toContain("opacity");
    expect(frame.display).not.toBe("none");
  });

  test("a non-modal <Dialog open> sits in the page with nothing running", async ({ page }) => {
    await mountStyled(page, await markup(true));

    const frame = await actAndRead(page, "none");

    expect({ panel: frame.panel, backdrop: frame.backdrop, opacity: frame.opacity, display: frame.display }).toEqual({
      panel: [],
      backdrop: [],
      opacity: 1,
      display: "block",
    });
  });

  // A close leaves a modal and a non-modal dialog in the same `:not([open])` state, so CSS gives both the exit.
  test("closing a non-modal <Dialog open> fades it out like a modal", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", NO_DISPLAY_TRANSITION);
    await mountStyled(page, await markup(true));

    const frame = await actAndRead(page, "close");

    expect(frame.panel, JSON.stringify(frame)).toContain("opacity");
    expect(frame.display).not.toBe("none");
  });

  test("a <Dialog open> closed and reopened as a modal still fades out on its next close", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
    test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
    await mountStyled(page, await markup(true));
    await actAndRead(page, "close");
    await expect.poll(() => actAndRead(page, "none").then((frame) => frame.display)).toBe("none");
    await actAndRead(page, "showModal");
    await expect.poll(() => actAndRead(page, "none").then((frame) => frame.opacity)).toBe(1);

    const frame = await actAndRead(page, "close");

    expect(frame.panel, JSON.stringify(frame)).toContain("opacity");
    expect(frame.backdrop, JSON.stringify(frame)).toContain("opacity");
  });

  test("the closed opacity is --forge-motion-opacity", async ({ page }) => {
    await mountStyled(page, await markup());
    const closedOpacity = () => actAndRead(page, "none").then((frame) => frame.opacity);

    expect(await closedOpacity()).toBe(0);
    await page.evaluate(() => (document.querySelector("#confirm") as HTMLElement).style.setProperty("--forge-motion-opacity", "0.5"));
    expect(await closedOpacity()).toBe(0.5);
  });

  test("a custom slide that sets --forge-motion-opacity to 1 stays visible on every exit frame", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
    test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
    const html = await render(Dialog({ id: "confirm", label: "Delete project?", class: CONSUMER_SLIDE, children: "Body" }));
    await mountStyled(page, html);
    await actAndRead(page, "showModal");
    await expect.poll(() => actAndRead(page, "none").then((frame) => frame.opacity)).toBe(1);

    const exiting = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const el = document.querySelector("#confirm") as HTMLDialogElement;
          const out: number[] = [];
          el.close();
          const tick = () => {
            if (getComputedStyle(el).display === "none" || out.length === 4) return resolve(out);
            out.push(Number(getComputedStyle(el).opacity));
            requestAnimationFrame(tick);
          };
          tick();
        }),
    );

    expect(exiting.length, "no frame caught the slide after close()").toBeGreaterThan(0);
    expect(exiting).toEqual(exiting.map(() => 1));
  });

  test("a Drawer keeps its slide and gains no opacity transition on its panel", async ({ page }) => {
    await mountStyled(page, await render(Drawer({ id: "nav", side: "left", label: "Navigation", children: "Links" })));

    const frame = await actAndRead(page, "showModal");

    expect(frame.panel, JSON.stringify(frame)).toContain("translate");
    expect(frame.panel).not.toContain("opacity");
  });

  test.describe("under reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("a modal open fades its panel and backdrop without scaling", async ({ page }) => {
      await mountStyled(page, await markup());

      const frame = await actAndRead(page, "showModal");

      expect({ panel: frame.panel, backdropOpacity: frame.backdropOpacity }).toEqual({ panel: ["opacity"], backdropOpacity: 0 });
      await expect
        .poll(() => actAndRead(page, "none").then((settled) => ({ opacity: settled.opacity, backdropOpacity: settled.backdropOpacity })))
        .toEqual({ opacity: 1, backdropOpacity: 1 });
    });

    test("a Drawer fades on --forge-motion-enter rather than sliding", async ({ page }) => {
      await mountStyled(page, await render(Drawer({ id: "nav", side: "left", label: "Navigation", children: "Links" })));

      const frame = await actAndRead(page, "showModal");

      expect(frame.panel, JSON.stringify(frame)).toEqual(["opacity"]);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector("#nav") as HTMLElement).transitionDuration)).toBe(
        "0.15s, 0.15s, 0.15s",
      );
    });
  });
});

interface ResumedRead {
  modal: boolean;
  opacity: number;
  backdropOpacity: number;
  left: number;
  running: string[];
}

function resumeAndRead(page: Page): Promise<ResumedRead> {
  return page.evaluate(() => {
    window.forgeResume.resume();
    const el = document.querySelector("dialog") as HTMLDialogElement;
    return {
      modal: el.matches(":modal"),
      opacity: Number(getComputedStyle(el).opacity),
      backdropOpacity: Number(getComputedStyle(el, "::backdrop").opacity),
      left: Math.round(el.getBoundingClientRect().left),
      running: el.getAnimations({ subtree: true }).map((animation) => (animation as CSSTransition).transitionProperty),
    };
  });
}

async function mountResumable(page: Page, html: string): Promise<void> {
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style>${html}`, EXPOSE);
}

const openModalDialog = (className?: string): Promise<string> =>
  render(Dialog({ id: "confirm", label: "Delete project?", openModal: true, ...(className ? { class: className } : {}), children: "Body" }));

const openModalDrawer = (): Promise<string> => render(Drawer({ id: "nav", side: "left", label: "Navigation", openModal: true, children: "Links" }));

const SETTLED = { modal: true, opacity: 1, backdropOpacity: 1, running: [] };

function durations(page: Page, act: "showModal" | "close"): Promise<string[]> {
  return page.evaluate((call) => {
    const el = document.querySelector("dialog") as HTMLDialogElement;
    el[call]();
    return [...new Set(getComputedStyle(el).transitionDuration.split(", "))];
  }, act);
}

test.describe("Dialog and Drawer — rendered open as a modal", { tag: "@cross-engine" }, () => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test.describe(reducedMotion === "reduce" ? "under reduced motion" : "with motion", () => {
      test.use({ reducedMotion });

      test("a Dialog rendered with openModal is already settled on the frame it resumes", async ({ page }) => {
        await mountResumable(page, await openModalDialog());

        const frame = await resumeAndRead(page);

        expect(frame).toEqual({ ...SETTLED, left: expect.any(Number) });
      });

      test("a Drawer rendered with openModal is already against its edge on the frame it resumes", async ({ page }) => {
        await mountResumable(page, await openModalDrawer());

        const frame = await resumeAndRead(page);

        expect(frame).toEqual({ ...SETTLED, left: 0 });
      });
    });
  }

  test("closed and reopened, it fades in like any modal", async ({ page }) => {
    await mountResumable(page, await openModalDialog());
    await resumeAndRead(page);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const el = document.querySelector("dialog") as HTMLDialogElement;
          el.addEventListener("close", resolve, { once: true });
          el.close();
        }),
    );
    await expect.poll(() => actAndRead(page, "none").then((frame) => frame.display)).toBe("none");

    const frame = await actAndRead(page, "showModal");

    expect(frame.panel, JSON.stringify(frame)).toContain("opacity");
    expect(frame.opacity).toBeLessThan(0.5);
  });

  test("a Dialog rendered with openModal still fades out when it closes", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
    test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
    await mountResumable(page, await openModalDialog());
    await resumeAndRead(page);
    await expect.poll(() => actAndRead(page, "none").then((frame) => frame.opacity)).toBe(1);

    const frame = await actAndRead(page, "close");

    expect(frame.panel, JSON.stringify(frame)).toContain("opacity");
    expect(frame.display).not.toBe("none");
  });

  test("open:duration-180 slows only the enter", async ({ page }) => {
    await mountStyled(page, await render(Dialog({ id: "confirm", label: "Delete project?", class: "open:duration-180", children: "Body" })));

    const entering = await durations(page, "showModal");
    const exiting = await durations(page, "close");

    expect({ entering, exiting }).toEqual({ entering: ["0.18s"], exiting: ["0.1s"] });
  });
});

interface ExitFrames {
  settled: { x: number; y: number; width: number; height: number };
  closing: Array<{ x: number; y: number; width: number; height: number }>;
}

// The centre rather than the corner, because the exit scale shrinks the panel about it.
function readExitFrames(page: Page, act: "showModal" | "none"): Promise<ExitFrames> {
  return page.evaluate(
    (call) =>
      new Promise<ExitFrames>((resolve) => {
        const el = document.querySelector("#confirm") as HTMLDialogElement;
        const read = () => {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), width: rect.width, height: rect.height };
        };
        if (call === "showModal") el.showModal();
        const finish = () => {
          const settled = read();
          const closing: ExitFrames["closing"] = [];
          el.close();
          const tick = () => {
            if (getComputedStyle(el).display === "none") return resolve({ settled, closing });
            closing.push(read());
            requestAnimationFrame(tick);
          };
          tick();
        };
        void Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(finish);
      }),
    act,
  );
}

async function mountTall(page: Page, html: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await mount(page, `<style>${await compiledCss(renderedClasses(html))}</style><div style="height: 3000px"></div>${html}`);
}

function centred(frames: ExitFrames): void {
  expect(frames.closing.length, "no frame caught the panel after close()").toBeGreaterThan(0);
  expect(near(frames.settled.x, VIEWPORT.width / 2) && near(frames.settled.y, VIEWPORT.height / 2), JSON.stringify(frames.settled)).toBe(true);
  for (const frame of frames.closing) {
    expect({ x: frame.x, y: frame.y }, JSON.stringify(frames)).toEqual({ x: frames.settled.x, y: frames.settled.y });
  }
}

test.describe("Dialog — placement through the exit fade", { tag: "@cross-engine" }, () => {
  test("a closing modal stays centred in the viewport", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
    test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
    await mountTall(page, await markup());

    centred(await readExitFrames(page, "showModal"));
  });

  test("a modal closed on a scrolled page stays centred in the viewport", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
    test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
    await mountTall(page, await markup());
    await page.evaluate(() => window.scrollTo(0, 1500));

    centred(await readExitFrames(page, "showModal"));
  });

  test("a non-modal <Dialog open> fades out where it sits in the page", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", NO_DISPLAY_TRANSITION);
    await mountTall(page, await markup(true));
    await page.evaluate(() => window.scrollTo(0, 2800));

    const frames = await readExitFrames(page, "none");

    expect(frames.closing.length, "no frame caught the panel after close()").toBeGreaterThan(0);
    for (const frame of frames.closing) {
      expect(near(frame.x, frames.settled.x) && near(frame.y, frames.settled.y), JSON.stringify(frames)).toBe(true);
    }
  });

  test("a duration-* on a non-modal <Dialog open> keeps the closing panel where it sits through the fade", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", NO_DISPLAY_TRANSITION);
    test.skip(browserName === "webkit", LONGHAND_EXIT_WEBKIT);
    await mountTall(page, await render(Dialog({ id: "confirm", label: "Delete project?", open: true, class: "duration-300", children: "Body" })));
    await page.evaluate(() => window.scrollTo(0, 2800));

    const frames = await readExitFrames(page, "none");

    expect(frames.closing.length, "no frame caught the panel after close()").toBeGreaterThan(0);
    for (const frame of frames.closing) {
      expect(near(frame.x, frames.settled.x) && near(frame.y, frames.settled.y), JSON.stringify(frames)).toBe(true);
    }
  });

  test("an ease-* on a non-modal <Dialog open> lets the closing panel leave its place before the fade ends", async ({ page, browserName }) => {
    test.skip(browserName === "firefox", NO_DISPLAY_TRANSITION);
    test.skip(browserName === "webkit", LONGHAND_EXIT_WEBKIT);
    await mountTall(page, await render(Dialog({ id: "confirm", label: "Delete project?", open: true, class: "ease-linear", children: "Body" })));
    await page.evaluate(() => window.scrollTo(0, 2800));

    const frames = await readExitFrames(page, "none");
    const moved = frames.closing.filter((frame) => !near(frame.x, frames.settled.x) || !near(frame.y, frames.settled.y));

    expect(moved.length, `every closing frame held the panel where it sat: ${JSON.stringify(frames)}`).toBeGreaterThan(0);
  });

  test.describe("under reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("a closing modal keeps its whole rect, unscaled", async ({ page, browserName }) => {
      test.skip(browserName === "firefox", MODAL_EXIT_FIREFOX);
      test.skip(browserName === "webkit", MODAL_EXIT_WEBKIT);
      await mountTall(page, await markup());

      const frames = await readExitFrames(page, "showModal");

      centred(frames);
      for (const frame of frames.closing) {
        expect({ width: frame.width, height: frame.height }).toEqual({ width: frames.settled.width, height: frames.settled.height });
      }
    });
  });
});
