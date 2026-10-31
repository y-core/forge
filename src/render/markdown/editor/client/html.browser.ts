import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { bundleModules } from "../../../../ui/client/browser.fixture";
import { MARKDOWN_TRUSTED_TYPES_POLICY } from "../../trusted-types";

declare global {
  interface Window {
    forgeViewportHtml: typeof import("./html");
    viewportViolations: string[];
  }
}

const TT_ORIGIN = "http://forge.test";

/** Serves an empty container as a real page under `csp`, its bundle an external script, recording violations and console errors. */
async function openUnderCsp(page: Page, csp: string): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.viewportViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.viewportViolations.push(`${event.violatedDirective} ${event.sample}`));
  });
  const bundle = await bundleModules({ forgeViewportHtml: "./render/markdown/editor/client/html" });
  const body = `<!doctype html><html><head><script src="/bundle.js"></script></head><body><div id="container"></div></body></html>`;
  await page.route(`${TT_ORIGIN}/**`, (route) => {
    if (new URL(route.request().url()).pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp }, body });
  });
  await page.goto(`${TT_ORIGIN}/`);
  await page.waitForFunction(() => "forgeViewportHtml" in window);
  return consoleErrors;
}

const write = (page: Page, html: string) =>
  page.evaluate((markup) => window.forgeViewportHtml.writeViewportHtml(document.getElementById("container") as HTMLElement, markup), html);

test("writes through its named policy under an enforcing Trusted Types CSP, every write in the window, with no violation", async ({ page }) => {
  const consoleErrors = await openUnderCsp(page, `require-trusted-types-for 'script'; trusted-types ${MARKDOWN_TRUSTED_TYPES_POLICY}`);

  expect([await write(page, "<h1>One</h1>"), await write(page, "<h1>Two</h1>")]).toEqual([true, true]);
  await expect(page.locator("#container h1")).toHaveText("Two");
  expect([await page.evaluate(() => window.viewportViolations), consoleErrors]).toEqual([[], []]);
});

test("writes nothing, marks the container refused and names the policy when the Trusted Types CSP leaves it out", async ({ page }) => {
  const consoleErrors = await openUnderCsp(page, "require-trusted-types-for 'script'; trusted-types other");

  expect(await write(page, "<h1>Title</h1>")).toBe(false);
  await expect(page.locator("#container")).toBeEmpty();
  await expect(page.locator("#container")).toHaveAttribute("data-viewport-html", "refused");
  expect(consoleErrors.some((text) => text.includes(MARKDOWN_TRUSTED_TYPES_POLICY) && text.includes("trusted-types"))).toBe(true);
});
