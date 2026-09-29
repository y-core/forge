import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { pageShell } from "../../app/shell";
import { jsx } from "../../jsx/jsx-runtime";
import { renderPage } from "../../jsx/render-to-string";
import { HTMX_TRUSTED_TYPES_POLICY } from "../contracts/htmx-contract";
import { bundleModules } from "./browser.fixture";

interface Violation {
  directive: string;
  blockedURI: string;
  sample: string;
}

declare global {
  interface Window {
    forgeHtmx: typeof import("./htmx");
    violations: Violation[];
    htmxErrors: number;
    ran?: number;
    noReload?: boolean;
  }
}

const ORIGIN = "http://forge.test";
const ENFORCING = `require-trusted-types-for 'script'; trusted-types ${HTMX_TRUSTED_TYPES_POLICY}`;

const INDEX = `<!doctype html><html><head><script src="/bundle.js"></script></head>
<body hx-boost:inherited="true">
<button id="load" hx-get="/fragment" hx-target="#out">Load</button>
<button id="evil" hx-get="javascript:window.ran=1" hx-target="#out">Evil</button>
<div id="out"></div>
<a id="next" href="/next">Next</a>
</body></html>`;

const FRAGMENT = `<p id="swapped">Swapped</p><script>document.documentElement.dataset.ran="1"</script>`;

const BODY_SCRIPT_PAGE = `<!doctype html><html><head><title>Next</title></head>
<body><h1 id="next-title">Next</h1><script type="module" src="/app.js"></script></body></html>`;

/** The `/next` page as forge's own shell renders it, with its script in `<head>`. */
async function shellPage(): Promise<string> {
  const shell = pageShell({ script: "/bundle.js" });
  const node = await shell(undefined as never, jsx("h1", { id: "next-title", children: "Next" }), {
    mount: "probe",
    page: "next",
    meta: { title: "Next" },
  });
  return (await renderPage(node)).text();
}

interface Site {
  csp?: string;
  next?: () => Promise<string>;
}

/** Serves the probe site, recording every CSP violation, every `htmx:error` and every console error the page raises. */
async function openSite(page: Page, site: Site): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.violations = [];
    window.htmxErrors = 0;
    document.addEventListener("securitypolicyviolation", (event) => {
      window.violations.push({ directive: event.violatedDirective, blockedURI: event.blockedURI, sample: event.sample });
    });
    window.addEventListener("htmx:error", () => (window.htmxErrors += 1));
  });
  const headers = site.csp === undefined ? {} : { "Content-Security-Policy": site.csp };
  const bundle = await bundleModules({ forgeHtmx: "./ui/client/htmx" });
  const next = site.next ?? shellPage;
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (path === "/fragment") return route.fulfill({ contentType: "text/html", body: FRAGMENT });
    if (path === "/next") return route.fulfill({ contentType: "text/html", headers, body: await next() });
    return route.fulfill({ contentType: "text/html", headers, body: INDEX });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => "forgeHtmx" in window);
  return consoleErrors;
}

/** Clicks `selector` and resolves once htmx reports the request finished, swapped or not. */
async function clickAndFinish(page: Page, selector: string): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { finished: Promise<void> }).finished = new Promise((resolve) =>
      document.addEventListener("htmx:finally:request", () => resolve(), { once: true }),
    );
  });
  await page.click(selector);
  await page.evaluate(() => (window as unknown as { finished: Promise<void> }).finished);
}

function recorded(page: Page): Promise<{ violations: Violation[]; htmxErrors: number }> {
  return page.evaluate(() => ({ violations: window.violations, htmxErrors: window.htmxErrors }));
}

test.describe("htmx under an enforcing Trusted Types CSP", () => {
  test("swaps a fragment and runs its script, boosts to a shell page and restores history, with no violation", async ({ page }) => {
    await openSite(page, { csp: ENFORCING });
    await page.evaluate(() => (window.noReload = true));
    const log: Awaited<ReturnType<typeof recorded>>[] = [];
    const checkpoint = async (): Promise<void> => {
      expect(await page.evaluate(() => window.noReload)).toBe(true);
      log.push(await recorded(page));
    };

    await page.click("#load");
    await expect(page.locator("#swapped")).toHaveText("Swapped");
    await expect(page.locator("html")).toHaveAttribute("data-ran", "1");
    await checkpoint();

    await page.click("#next");
    await expect(page).toHaveURL(`${ORIGIN}/next`);
    await expect(page.locator("#next-title")).toHaveText("Next");
    await checkpoint();

    await page.goBack();
    await expect(page.locator("#load")).toBeVisible();
    await checkpoint();

    const clean = { violations: [], htmxErrors: 0 };
    expect(log).toEqual([clean, clean, clean]);
  });

  test("refuses the swap when the CSP allows no policy, naming the policy in the error", async ({ page }) => {
    const consoleErrors = await openSite(page, { csp: "require-trusted-types-for 'script'; trusted-types 'none'" });

    await clickAndFinish(page, "#load");

    await expect(page.locator("#out")).toBeEmpty();
    expect(consoleErrors.some((text) => text.includes(HTMX_TRUSTED_TYPES_POLICY))).toBe(true);
    const { violations, htmxErrors } = await recorded(page);
    expect(htmxErrors).toBe(1);
    expect(violations.length).toBeGreaterThan(0);
  });

  test("fails closed on its own when the policy is refused but sinks are not yet enforced", async ({ page }) => {
    await openSite(page, { csp: "trusted-types other" });

    await clickAndFinish(page, "#load");

    await expect(page.locator("#out")).toBeEmpty();
    expect((await recorded(page)).htmxErrors).toBe(1);
  });

  test("loses a boosted swap whose body carries a script src, which htmx sets outside the policy", async ({ page }) => {
    await openSite(page, { csp: ENFORCING, next: async () => BODY_SCRIPT_PAGE });

    await clickAndFinish(page, "#next");

    await expect(page.locator("#next-title")).toHaveCount(0);
    const { violations, htmxErrors } = await recorded(page);
    expect(htmxErrors).toBe(1);
    expect(violations.some((v) => v.blockedURI === "trusted-types-sink" && v.sample.startsWith("HTMLScriptElement src"))).toBe(true);
  });
});

test.describe("htmx's script request URLs", () => {
  test("refuses a javascript: verb URL and logs it, while a plain request on the same page still swaps", async ({ page }) => {
    const consoleErrors = await openSite(page, {});

    await page.click("#evil");
    await expect.poll(() => consoleErrors.some((text) => text.includes("refused a script request URL"))).toBe(true);
    expect(await page.evaluate(() => window.ran)).toBeUndefined();

    await page.click("#load");
    await expect(page.locator("#swapped")).toHaveText("Swapped");
  });
});
