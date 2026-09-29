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

test.describe("openPopoverAt", () => {
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

test.describe("openPopoverAt with flip", () => {
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

test.describe("openPopoverAt placement after close", () => {
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

const ORIGIN = "https://forge.test";

async function openForgeCspSite(page: Page): Promise<void> {
  const nonce = "popover-anchor-probe";
  const csp = applySecurityHeaders(new Response(""), { nonce }).headers.get("content-security-policy") ?? "";
  const region = await render(Menu.Popup({ label: "Context actions", id: "ctx", children: Menu.Item({ id: "row", for: "ctx", children: "Row" }) }));
  const index = `<!doctype html><html><head><script src="/bundle.js"></script></head><body>
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

test.describe("openPopoverAt under forge's own CSP across an htmx swap", () => {
  test("a closed popover carries no style attribute, and swapping its region raises no violation", async ({ page }) => {
    await openForgeCspSite(page);

    await openAt(page, 200, 150);
    await closeCtx(page);
    const afterClose = await ctxState(page);
    await swapRegionAndSettle(page);

    expect(afterClose).toEqual({ style: null, coords: true });
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([]);
  });

  test("a placement whose clear was released by the disposer is copied by the settle and reported", async ({ page }) => {
    await openForgeCspSite(page);

    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#ctx");
      if (el) window.forgePopoverAnchor.openPopoverAt(el, 200, 150)();
    });
    await closeCtx(page);
    const afterClose = await ctxState(page);
    await swapRegionAndSettle(page);

    expect(afterClose.style).not.toBeNull();
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([{ directive: "style-src-attr", blockedURI: "inline" }]);
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

    expect(afterClose).toEqual({ style: null, coords: true });
    expect(await page.evaluate(() => window.anchorViolations)).toEqual([]);
  });
});
