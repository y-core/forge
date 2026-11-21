import { defineConfig } from "@playwright/test";

import { chromiumProject, crossEngineProjects, playwrightServers, workerdProject } from "./src/tooling/playwright/config.ts";

const { maxClients, compat } = playwrightServers(process.env);
const BROWSER_SET = { testMatch: "src/**/*.browser.ts", fullyParallel: true };

export default defineConfig({
  testDir: ".",
  testIgnore: "**/.claude/**",
  globalSetup: "./tests/workerd/tmp.setup.ts",
  // A worker past the server's client limit queues at connect rather than running.
  workers: maxClients,
  reporter: "list",
  projects: [
    chromiumProject({}, BROWSER_SET),
    ...crossEngineProjects(compat, {}, { ...BROWSER_SET, grep: /@cross-engine/, workers: 2 }),
    workerdProject({ testDir: ".", testMatch: "tests/workerd/**/*.workerd.ts" }),
  ],
});
