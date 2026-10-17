import { availableParallelism } from "node:os";

import { defineConfig, devices } from "@playwright/test";

// The committed bundle, not the `.ts` source: node loads this config and strips no types under `node_modules`.
import { resolveChromiumPath } from "./src/tooling/gate/chromium.mjs";

// Playwright reads no environment variable for the browser path, so a baked-in Chromium is invisible without this.
const executablePath = resolveChromiumPath();

export default defineConfig({
  testDir: ".",
  // No `webServer`: `src/ui/client/browser.fixture.ts` bundles each module under test into `page.setContent()`
  // markup, and a spec that needs a Worker starts its own through `tests/workerd/harness.fixture.ts`.
  testIgnore: "**/.claude/**",
  globalSetup: "./tests/workerd/tmp.setup.ts",
  // Not `"100%"`: Playwright counts `os.cpus()`, the host's cores, so a CPU-quota'd container runs more Chromiums than it may schedule.
  workers: availableParallelism(),
  reporter: "list",
  projects: [
    {
      name: "chromium",
      testMatch: "src/**/*.browser.ts",
      fullyParallel: true,
      use: {
        ...devices["Desktop Chrome"],
        // Never the default headless shell: a separate build that resolves no CSS anchor positioning
        // and answers a pointer leave differently, so a suite run against it tests a browser no reader has.
        ...(executablePath === undefined ? { channel: "chromium" as const } : { launchOptions: { executablePath } }),
      },
    },
    {
      name: "workerd",
      testMatch: "tests/workerd/**/*.workerd.ts",
      // Each file's tests share the one Worker its worker-scoped harness started, so a file is never spread across workers.
      fullyParallel: false,
    },
  ],
});
