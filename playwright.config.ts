import { defineConfig, devices } from "@playwright/test";

// The committed bundle, not the `.ts` source: node loads this config and strips no types under `node_modules`.
import { resolveChromiumPath } from "./src/tooling/gate/chromium.mjs";

// Playwright reads no environment variable for the browser path, so a baked-in Chromium is invisible without this.
const executablePath = resolveChromiumPath();

export default defineConfig({
  testDir: ".",
  // No `webServer`: `src/ui/client/browser.fixture.ts` bundles each module under test into `page.setContent()` markup.
  testMatch: "src/**/*.browser.ts",
  fullyParallel: true,
  // Playwright's default is half the cores, and this set's cost is almost all per-test fixed overhead.
  workers: "100%",
  reporter: "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Never the default headless shell: a separate build that resolves no CSS anchor positioning
        // and answers a pointer leave differently, so a suite run against it tests a browser no reader has.
        ...(executablePath === undefined ? { channel: "chromium" as const } : { launchOptions: { executablePath } }),
      },
    },
  ],
});
