import { defineConfig, devices } from "@playwright/test";

if (!process.env.PW_TEST_CONNECT_WS_ENDPOINT) {
  throw new Error("PW_TEST_CONNECT_WS_ENDPOINT is unset; set it to the Playwright container's ws:// URL");
}
const maxClients = Number(process.env.PLAYWRIGHT_SERVER_MAX_CLIENTS);
if (!Number.isInteger(maxClients) || maxClients < 1) {
  throw new Error("PLAYWRIGHT_SERVER_MAX_CLIENTS must be the Playwright container's --max-clients, a positive integer");
}
const compatEndpoint = process.env.PLAYWRIGHT_COMPAT_WS_ENDPOINT;
const exposeNetwork = process.env.PW_TEST_CONNECT_EXPOSE_NETWORK;
const headers = process.env.PW_TEST_CONNECT_HEADERS;
const compat =
  compatEndpoint === undefined || compatEndpoint === ""
    ? undefined
    : {
        wsEndpoint: compatEndpoint,
        ...(exposeNetwork === undefined ? {} : { exposeNetwork }),
        ...(headers === undefined ? {} : { headers: JSON.parse(headers) as Record<string, string> }),
      };

export default defineConfig({
  testDir: ".",
  testIgnore: "**/.claude/**",
  globalSetup: "./tests/workerd/tmp.setup.ts",
  // A worker past the server's client limit queues at connect rather than running.
  workers: maxClients,
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
        channel: "chromium",
      },
    },
    ...(compat === undefined
      ? []
      : [
          {
            name: "firefox",
            testMatch: "src/**/*.browser.ts",
            grep: /@cross-engine/,
            fullyParallel: true,
            workers: 2,
            use: { ...devices["Desktop Firefox"], connectOptions: compat },
          },
          {
            name: "webkit",
            testMatch: "src/**/*.browser.ts",
            grep: /@cross-engine/,
            fullyParallel: true,
            workers: 2,
            use: { ...devices["Desktop Safari"], connectOptions: compat },
          },
        ]),
    { name: "workerd", testMatch: "tests/workerd/**/*.workerd.ts", fullyParallel: false },
  ],
});
