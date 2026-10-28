import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { applySecurityHeaders } from "../../security/headers";
import { render } from "../../testing/render";
import { Menu } from "../core/menu";
import { bundleModules, mount } from "./browser.fixture";

interface Violation {
  directive: string;
  blockedURI: string;
}

declare global {
  interface Window {
    forgePopoverAnchor: typeof import("./popover-anchor");
    forgeHtmx: typeof import("./htmx");
    anchorViolations: Violation[];
  }
}

const EXPOSE = { expose: { forgePopoverAnchor: "./ui/client/popover-anchor" } };

/** The coordinate rule, verbatim from `assets/css/forge-ui.css`, inlined because the harness serves no CSS. */
const COORD_RULE = `
  [popover] { border: 0; padding: 0; }
  [popover][data-coords] {
    position: fixed;
    margin: 0;
    inset: auto;
    left: var(--anchor-x, 0px);
    top: var(--anchor-y, 0px);
    position-try-fallbacks: none;
  }
`;

/** A 120×80 context menu — a known box, so a clamp is arithmetic rather than a guess. */
async function markup(coords = true): Promise<string> {
  const menu = await render(
    Menu.Popup({
      label: "Context actions",
      id: "ctx",
      ...(coords ? { coords: true } : {}),
      class: "h-20 w-[120px]",
      children: Menu.Item({ id: "row", for: "ctx", children: "Row" }),
    }),
  );
  return `<style>${COORD_RULE}</style><div id="pad" style="width:120px;height:80px"></div>${menu}`;
}

/** Force the exact box the arithmetic below assumes, whatever the component's own classes say. */
async function sizeIt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#ctx");
    el?.style.setProperty("width", "120px");
    el?.style.setProperty("height", "80px");
  });
}

async function openAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    // oxlint-disable-next-line eslint/no-shadow -- the callback runs in the browser realm and cannot close over the Node-side binding; the matching name is what documents the marshalled argument
    ({ x, y }) => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, x, y);
    },
    { x, y },
  );
}

function box(page: Page) {
  return page.evaluate(() => {
    const rect = document.querySelector("#ctx")?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
  });
}

const viewport = (page: Page) => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

test.describe("openPopoverAt", { tag: "@cross-engine" }, () => {
  test("opens the popup and puts its top-left corner on the given point", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.matches(":popover-open"))).toBe(true);
    expect(await box(page)).toMatchObject({ left: 200, top: 150 });
  });

  test("writes the coordinates as custom properties, never as an inline style attribute", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);

    expect(
      await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("#ctx");
        return { x: el?.style.getPropertyValue("--anchor-x"), y: el?.style.getPropertyValue("--anchor-y") };
      }),
    ).toEqual({ x: "200px", y: "150px" });
  });

  test("clamps against the right edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { w } = await viewport(page);

    await openAt(page, w + 500, 150);

    expect(await box(page)).toMatchObject({ left: w - 120, right: w, top: 150 });
  });

  test("clamps against the bottom edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { h } = await viewport(page);

    await openAt(page, 200, h + 500);

    expect(await box(page)).toMatchObject({ top: h - 80, bottom: h, left: 200 });
  });

  test("clamps against the left edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, -400, 150);

    expect(await box(page)).toMatchObject({ left: 0, top: 150 });
  });

  test("clamps against the top edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, -400);

    expect(await box(page)).toMatchObject({ left: 200, top: 0 });
  });

  test("honours a margin on every edge", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { w, h } = await viewport(page);

    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, 1e6, 1e6, { margin: 12 });
    });

    expect(await box(page)).toMatchObject({ right: w - 12, bottom: h - 12 });
  });

  test("a second call at a new point moves an already-open popup", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);
    await openAt(page, 40, 60);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.matches(":popover-open"))).toBe(true);
    expect(await box(page)).toMatchObject({ left: 40, top: 60 });
  });

  test("stamps the opt-in attribute itself, so calling it is what makes a popup coordinate-placed", async ({ page }) => {
    await mount(page, await markup(false), EXPOSE);
    await sizeIt(page);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.hasAttribute("data-coords"))).toBe(false);
    await openAt(page, 200, 150);

    expect(await page.evaluate(() => document.querySelector("#ctx")?.hasAttribute("data-coords"))).toBe(true);
    expect(await box(page)).toMatchObject({ left: 200, top: 150 });
  });

  test("a popup larger than the viewport pins to the near edge rather than hanging off the far one", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      el?.style.setProperty("width", "5000px");
      el?.style.setProperty("height", "5000px");
    });

    await openAt(page, 300, 300);

    // `Math.max(margin, …)` is what makes this 0 rather than a negative left.
    expect(await box(page)).toMatchObject({ left: 0, top: 0 });
  });
});

test.describe("openPopoverAt with flip", { tag: "@cross-engine" }, () => {
  async function openFlipped(page: Page, x: number, y: number): Promise<void> {
    await page.evaluate(
      // oxlint-disable-next-line eslint/no-shadow -- the callback runs in the browser realm and cannot close over the Node-side binding; the matching name is what documents the marshalled argument
      ({ x, y }) => {
        const el = document.querySelector<HTMLElement>("#ctx");
        if (el) window.forgePopoverAnchor.openPopoverAt(el, x, y, { flip: true });
      },
      { x, y },
    );
  }

  test("leaves the point at the corner when the popup fits", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openFlipped(page, 200, 150);

    expect(await box(page)).toMatchObject({ left: 200, top: 150 });
  });

  test("mirrors past the point on the axis that would overflow, and only that axis", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { h } = await viewport(page);

    await openFlipped(page, 200, h - 10);

    const rect = await box(page);
    expect(rect?.left, "the x axis flipped although it had room").toBe(200);
    expect(rect?.bottom, "the y axis did not open upward from the point").toBe(h - 10);
  });

  test("flips both axes in a corner", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);
    const { w, h } = await viewport(page);

    await openFlipped(page, w - 10, h - 10);

    expect(await box(page)).toMatchObject({ right: w - 10, bottom: h - 10 });
  });

  test("falls back to clamping when the mirrored box would not fit either", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      el?.style.setProperty("width", "120px");
      el?.style.setProperty("height", "600px");
    });
    const { h } = await viewport(page);

    // 40px from the top: flipping upward would need 600px above the point, which does not exist.
    await openFlipped(page, 200, 40);

    const rect = await box(page);
    expect(rect?.top, "the flip produced a negative top instead of clamping").toBeGreaterThanOrEqual(0);
    expect(rect?.bottom, "the panel hangs off the bottom edge").toBeLessThanOrEqual(h);
  });
});

test.describe("openPopoverAt placement after close", { tag: "@cross-engine" }, () => {
  test("keeps a caller's own inline property and drops only the coordinates", async ({ page }) => {
    await mount(page, await markup(), EXPOSE);
    await sizeIt(page);

    await openAt(page, 200, 150);
    await closeCtx(page);

    expect(
      await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>("#ctx");
        return {
          x: el?.style.getPropertyValue("--anchor-x"),
          y: el?.style.getPropertyValue("--anchor-y"),
          width: el?.style.getPropertyValue("width"),
          height: el?.style.getPropertyValue("height"),
        };
      }),
    ).toEqual({ x: "", y: "", width: "120px", height: "80px" });
  });
});

test.describe("openPopoverAt under forge's own CSS and default motion", { tag: "@cross-engine" }, () => {
  const FORGE_CSS = { ...EXPOSE, css: ["./ui/assets/css/forge-ui.css"] };
  const SIZE_RULE = `<style>[popover] { border: 0; padding: 0; } #ctx { box-sizing: border-box; width: 120px; height: 80px; }</style>`;

  async function mountForge(page: Page): Promise<void> {
    await mount(page, `${SIZE_RULE}${await markup()}`, FORGE_CSS);
  }

  async function settle(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>("#ctx");
      await Promise.allSettled(el?.getAnimations().map((animation) => animation.finished) ?? []);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }

  async function closeAndReadMidExit(page: Page) {
    return page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (!el) return null;
      const closed = new Promise<void>((resolve) =>
        el.addEventListener("toggle", (event) => {
          if ((event as ToggleEvent).newState === "closed") resolve();
        }),
      );
      el.hidePopover();
      await closed;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, exiting: el.getAnimations().length > 0 };
    });
  }

  const anchorProps = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      return { x: el?.style.getPropertyValue("--anchor-x"), y: el?.style.getPropertyValue("--anchor-y"), style: el?.getAttribute("style") ?? null };
    });

  test("holds the exit fade at the click point rather than jumping to the viewport origin", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "Firefox implements neither overlay nor a display transition, so a closing popup leaves the top layer and stops rendering at once",
    );
    test.skip(browserName === "webkit", "WebKit does not implement overlay, so a closing popup leaves the top layer and stops rendering at once");
    await mountForge(page);
    await openAt(page, 200, 150);
    await settle(page);

    expect(await closeAndReadMidExit(page)).toEqual({ left: 200, top: 150, exiting: true });
  });

  test("clears the coordinates once the exit fade has run", async ({ page }) => {
    await mountForge(page);
    await openAt(page, 200, 150);
    await settle(page);

    await closeAndReadMidExit(page);
    await settle(page);

    expect(await anchorProps(page)).toEqual({ x: "", y: "", style: null });
  });

  test("leaves no swap listener behind once the exit fade has cleared the coordinates", async ({ page }) => {
    await mountForge(page);
    await openAt(page, 200, 150);
    await settle(page);

    await closeAndReadMidExit(page);
    await settle(page);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      el?.style.setProperty("--anchor-x", "5px");
      el?.style.setProperty("--anchor-y", "6px");
      document.dispatchEvent(new Event("htmx:before:swap"));
    });

    expect(await anchorProps(page)).toMatchObject({ x: "5px", y: "6px" });
  });

  test("a reopen during the exit fade keeps its new coordinates", async ({ page }) => {
    await mountForge(page);
    await openAt(page, 200, 150);
    await settle(page);

    await closeAndReadMidExit(page);
    await openAt(page, 40, 60);
    await settle(page);

    expect(await anchorProps(page)).toMatchObject({ x: "40px", y: "60px" });
    expect(await box(page)).toMatchObject({ left: 40, top: 60 });
  });

  test("clamps the settled box, not the scaled-down opening one, inside the margin at the bottom-right edge", async ({ page }) => {
    await mountForge(page);
    const { w, h } = await viewport(page);

    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, 1e6, 1e6, { margin: 8 });
    });
    await settle(page);

    expect(await box(page)).toMatchObject({ right: w - 8, bottom: h - 8 });
  });

  test("flips the settled box, not the scaled-down opening one, so its far corner lands on the click", async ({ page }) => {
    await mountForge(page);
    const { w, h } = await viewport(page);

    await page.evaluate(
      // oxlint-disable-next-line eslint/no-shadow -- the callback runs in the browser realm and cannot close over the Node-side binding; the matching name is what documents the marshalled argument
      ({ w, h }) => {
        const el = document.querySelector<HTMLElement>("#ctx");
        if (el) window.forgePopoverAnchor.openPopoverAt(el, w - 10, h - 10, { margin: 8, flip: true });
      },
      { w, h },
    );
    await settle(page);

    expect(await box(page)).toMatchObject({ right: w - 10, bottom: h - 10 });
  });
});

test.describe("openPopoverAt's marker and origin under forge's own CSS", { tag: "@cross-engine" }, () => {
  const MENU_FORGE_CSS = { ...EXPOSE, css: ["./ui/assets/css/forge-ui.css"] };
  const SIZE_RULE = `<style>[popover] { border: 0; padding: 0; } #ctx { box-sizing: border-box; width: 120px; height: 80px; }</style>`;

  async function mountMenu(page: Page, coords: boolean): Promise<void> {
    const menu = await render(
      Menu({
        children: [
          Menu.Trigger({ for: "ctx", children: "Open" }),
          Menu.Popup({
            label: "Context actions",
            id: "ctx",
            ...(coords ? { coords: true } : {}),
            children: Menu.Item({ id: "row", for: "ctx", children: "Row" }),
          }),
        ],
      }),
    );
    await mount(page, `${SIZE_RULE}<div style="margin:200px 300px">${menu}</div>`, MENU_FORGE_CSS);
  }

  async function settle(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>("#ctx");
      await Promise.allSettled(el?.getAnimations().map((animation) => animation.finished) ?? []);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }

  async function dismissAndSettle(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await expect(page.locator("#ctx")).not.toBeVisible();
    await settle(page);
  }

  const hasMarker = (page: Page) => page.evaluate(() => document.querySelector("#ctx")?.hasAttribute("data-coords") ?? null);

  test("a trigger open after a context-menu open and Escape lands under the trigger, not at the viewport origin", async ({ page }) => {
    await mountMenu(page, false);
    await openAt(page, 700, 450);
    await settle(page);
    await dismissAndSettle(page);

    await page.click("[data-slot~='menu-trigger']");
    await expect(page.locator("#ctx")).toBeVisible();
    await settle(page);

    const trigger = await page.evaluate(() => document.querySelector("[data-slot~='menu-trigger']")?.getBoundingClientRect().toJSON());
    const rect = await box(page);
    expect(await hasMarker(page)).toBe(false);
    expect(rect?.left).toBe(trigger.left);
    expect(rect?.top).toBeGreaterThanOrEqual(trigger.bottom);
  });

  test("a coords marker from the markup survives an open, a close and the exit fade", async ({ page }) => {
    await mountMenu(page, true);
    await openAt(page, 200, 150);
    await settle(page);
    expect(await hasMarker(page)).toBe(true);

    await dismissAndSettle(page);

    expect(await hasMarker(page)).toBe(true);
  });

  test("a menu flipped at the bottom-right corner grows from its bottom-right corner", async ({ page }) => {
    await mountMenu(page, false);
    const { w, h } = await viewport(page);

    await page.evaluate(
      // oxlint-disable-next-line eslint/no-shadow -- the callback runs in the browser realm and cannot close over the Node-side binding; the matching name is what documents the marshalled argument
      ({ w, h }) => {
        const el = document.querySelector<HTMLElement>("#ctx");
        if (el) window.forgePopoverAnchor.openPopoverAt(el, w - 10, h - 10, { flip: true });
      },
      { w, h },
    );
    await settle(page);

    const origin = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      return el ? getComputedStyle(el).transformOrigin : null;
    });
    expect(origin).toBe("120px 80px");
  });
});

const ORIGIN = "https://forge.test";

const FORGE_CSS_PATH = new URL("../assets/css/forge-ui.css", import.meta.url).pathname;

async function openForgeCspSite(page: Page, withForgeCss = false): Promise<void> {
  const nonce = "popover-anchor-probe";
  const csp = applySecurityHeaders(new Response(""), { nonce }).headers.get("content-security-policy") ?? "";
  const region = await render(Menu.Popup({ label: "Context actions", id: "ctx", children: Menu.Item({ id: "row", for: "ctx", children: "Row" }) }));
  const stylesheet = withForgeCss ? `<link rel="stylesheet" href="/forge-ui.css">` : "";
  const index = `<!doctype html><html><head>${stylesheet}<script src="/bundle.js"></script></head><body>
<button id="swap" hx-get="/region" hx-target="#region">Swap</button>
<div id="region">${region}</div>
</body></html>`;
  const bundle = await bundleModules({ forgeHtmx: "./ui/client/htmx", ...EXPOSE.expose });

  await page.addInitScript(() => {
    window.anchorViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.anchorViolations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (path === "/forge-ui.css") return route.fulfill({ contentType: "text/css", path: FORGE_CSS_PATH });
    if (path === "/region") return route.fulfill({ contentType: "text/html", body: region });
    return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp }, body: index });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => "forgeHtmx" in window && "forgePopoverAnchor" in window);
}

async function closeCtx(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const el = document.querySelector<HTMLElement>("#ctx");
    if (!el) return;
    const toggled = new Promise<void>((resolve) =>
      el.addEventListener("toggle", (event) => {
        if ((event as ToggleEvent).newState === "closed") resolve();
      }),
    );
    el.hidePopover();
    await toggled;
  });
}

async function swapRegionAndSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { settled: Promise<void> }).settled = new Promise((resolve) =>
      document.addEventListener("htmx:after:settle", () => resolve(), { once: true }),
    );
  });
  await page.click("#swap");
  await page.evaluate(() => (window as unknown as { settled: Promise<void> }).settled);
}

const ctxState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("#ctx");
    return { style: el?.getAttribute("style") ?? null, coords: el?.hasAttribute("data-coords") ?? null };
  });

test.describe("openPopoverAt under forge's own CSP across an htmx swap", { tag: "@cross-engine" }, () => {
  test("a closed popover carries no style attribute, and swapping its region raises no violation", async ({ page }) => {
    await openForgeCspSite(page);

    await openAt(page, 200, 150);
    await closeCtx(page);
    const afterClose = await ctxState(page);
    await swapRegionAndSettle(page);

    expect(afterClose).toEqual({ style: null, coords: false });
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([]);
  });

  test("a placement whose clear was released by the disposer is not copied by the settle, so nothing is reported", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === "webkit", "WebKit neither blocks nor reports style-src-attr for a style attribute on a node parsed from a template");
    await openForgeCspSite(page);

    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, 200, 150)();
    });
    await closeCtx(page);
    const afterClose = await ctxState(page);
    await swapRegionAndSettle(page);

    expect(afterClose.style).not.toBeNull();
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([]);
  });

  test("a superseded call's disposer leaves the newer placement's clear armed", async ({ page }) => {
    await openForgeCspSite(page);

    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (!el) return;
      const first = window.forgePopoverAnchor.openPopoverAt(el, 200, 150);
      window.forgePopoverAnchor.openPopoverAt(el, 40, 60);
      first();
    });
    await closeCtx(page);
    const afterClose = await ctxState(page);
    await swapRegionAndSettle(page);

    expect(afterClose).toEqual({ style: null, coords: false });
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([]);
  });

  test("a swap during the exit fade under forge's CSS and default motion raises no violation", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "Firefox implements neither overlay nor a display transition, so a closing popup leaves the top layer and stops rendering at once",
    );
    test.skip(browserName === "webkit", "WebKit does not implement overlay, so a closing popup leaves the top layer and stops rendering at once");
    await openForgeCspSite(page, true);
    await openAt(page, 200, 150);

    const exitingAtSwap = await page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (!el) return null;
      await Promise.allSettled(el.getAnimations().map((animation) => animation.finished));
      let exiting = false;
      document.addEventListener("htmx:before:swap", () => (exiting = el.getAnimations().length > 0), { once: true });
      const closed = new Promise<void>((resolve) =>
        el.addEventListener("toggle", (event) => {
          if ((event as ToggleEvent).newState === "closed") resolve();
        }),
      );
      const settled = new Promise<void>((resolve) => document.addEventListener("htmx:after:settle", () => resolve(), { once: true }));
      el.hidePopover();
      await closed;
      document.querySelector<HTMLElement>("#swap")?.click();
      await settled;
      return exiting;
    });

    expect(exitingAtSwap, "the swap landed after the exit fade, so it tested nothing").toBe(true);
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([]);
  });
});
