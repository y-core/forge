/** browser.ts — where the browser set finds its Chromium.
 *
 *  One rule, two callers that cannot share the other's shape: `playwright.config.ts` needs a path to
 *  put in `launchOptions`, and `probe-browser.ts` needs a yes/no for the gate's `test:browser`
 *  prerequisite. Stating the rule twice is how the two drift into disagreeing — a config that
 *  launches a browser the probe reports as absent, which reads as a gate that skips a step it could
 *  have run.
 */
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

/** Playwright reads **no** environment variable for the browser path — not `CHROME_PATH`, and not
 *  the `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` that sounds like it would. It resolves one
 *  version-pinned path under the ms-playwright cache and launches that or nothing. So a container
 *  that bakes Chromium in and publishes it as `CHROME_PATH` — as this repository's devbox image
 *  does — is invisible to playwright until something joins the two, and `launchOptions.executablePath`
 *  is the only place that join can happen.
 *
 *  Returns `undefined` when no such browser is on disk, which is playwright's documented "use the
 *  bundled download" value. That keeps CI on a plain runner working off `bun run test:install`
 *  with no branch on `CI` anywhere.
 */
export function resolveChromiumPath(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  return fromEnv && existsSync(fromEnv) ? fromEnv : undefined;
}

/** Whether a launchable Chromium exists at all — the system one this repository prefers, or else
 *  playwright's own download.
 *
 *  `chromium.executablePath()` resolves the browser *this* playwright version expects, so a stale
 *  download from an earlier version reads as absent — which is what `playwright install` would fix.
 */
export function hasChromium(): boolean {
  return resolveChromiumPath() !== undefined || existsSync(chromium.executablePath());
}
