import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { bundleModules } from "./browser.fixture";

declare global {
  interface Window {
    forgeHtmx: typeof import("./htmx");
    styleViolations: string[];
  }
}

const ORIGIN = "http://forge.test";

const INDEX = `<!doctype html><html><head><script src="/bundle.js"></script></head>
<body>
<button id="swap" hx-get="/panel" hx-target="#out">Swap</button>
<button id="morph" hx-get="/panel" hx-target="#out" hx-swap="innerMorph">Morph</button>
<div id="out"><div id="panel" hx-get="/before">Panel</div></div>
</body></html>`;

const PANEL = `<div id="panel" hx-get="/after">Panel</div>`;

/** Serves the probe site under a `style-src 'self'` CSP, recording every violated directive. */
async function openSite(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.styleViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.styleViolations.push(event.violatedDirective));
  });
  const bundle = await bundleModules({ forgeHtmx: "./ui/client/htmx" });
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (path === "/panel") return route.fulfill({ contentType: "text/html", body: PANEL });
    return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": "style-src 'self'" }, body: INDEX });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => "forgeHtmx" in window);
}

/** Sizes `#panel` through the CSSOM, clicks `selector`, and resolves once htmx has settled the swap. */
async function swapSizedPanel(page: Page, selector: string): Promise<void> {
  await page.locator("#panel").evaluate((panel: HTMLElement) => (panel.style.width = "120px"));
  await page.evaluate(() => {
    (window as unknown as { settled: Promise<void> }).settled = new Promise((resolve) =>
      document.addEventListener("htmx:after:settle", () => resolve(), { once: true }),
    );
  });
  await page.click(selector);
  await page.evaluate(() => (window as unknown as { settled: Promise<void> }).settled);
}

const panelWidth = (page: Page): Promise<string> => page.locator("#panel").evaluate((panel: HTMLElement) => panel.style.width);

test.describe("htmx swaps under a style-src CSP", () => {
  test("settles an innerHTML swap over a CSSOM-sized element without a violation", async ({ page }) => {
    await openSite(page);

    await swapSizedPanel(page, "#swap");
    await swapSizedPanel(page, "#swap");

    expect(await page.evaluate(() => window.styleViolations)).toEqual([]);
  });

  test("morphs a CSSOM-sized element without a violation and keeps its width", async ({ page }) => {
    await openSite(page);

    await swapSizedPanel(page, "#morph");

    expect(await page.evaluate(() => window.styleViolations)).toEqual([]);
    expect(await panelWidth(page)).toBe("120px");
  });

  test("still morphs a changed hx- attribute onto the element", async ({ page }) => {
    await openSite(page);

    await swapSizedPanel(page, "#morph");

    await expect(page.locator("#panel")).toHaveAttribute("hx-get", "/after");
  });
});
