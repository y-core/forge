// Generated from src/tooling/playwright/config.ts by `bun run gen:bundles` — do not edit.

// src/tooling/playwright/config.ts
import { devices } from "@playwright/test";
var PROJECTS = { chromium: "chromium", firefox: "firefox", webkit: "webkit", workerd: "workerd" };
function parseHeaders(raw) {
  const parsed = JSON.parse(raw);
  const valid = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.values(parsed).every((value) => typeof value === "string");
  if (!valid) throw new Error("PW_TEST_CONNECT_HEADERS must be a JSON object of header names to string values");
  return parsed;
}
function playwrightServers(env) {
  if (!env["PW_TEST_CONNECT_WS_ENDPOINT"]) {
    throw new Error("PW_TEST_CONNECT_WS_ENDPOINT is unset; set it to the Playwright container's ws:// URL");
  }
  const maxClients = Number(env["PLAYWRIGHT_SERVER_MAX_CLIENTS"]);
  if (!Number.isInteger(maxClients) || maxClients < 1) {
    throw new Error("PLAYWRIGHT_SERVER_MAX_CLIENTS must be the Playwright container's --max-clients, a positive integer");
  }
  const wsEndpoint = env["PLAYWRIGHT_COMPAT_WS_ENDPOINT"];
  if (!wsEndpoint) return { maxClients, compat: void 0 };
  const exposeNetwork = env["PW_TEST_CONNECT_EXPOSE_NETWORK"];
  const headers = env["PW_TEST_CONNECT_HEADERS"];
  const compat = { wsEndpoint, ...exposeNetwork ? { exposeNetwork } : {}, ...headers ? { headers: parseHeaders(headers) } : {} };
  return { maxClients, compat };
}
function chromiumProject(use = {}, fields = {}) {
  return { name: PROJECTS.chromium, ...fields, use: { ...devices["Desktop Chrome"], channel: "chromium", ...use } };
}
function crossEngineProjects(compat, use = {}, fields = {}) {
  if (compat === void 0) return [];
  return [
    { name: PROJECTS.firefox, ...fields, use: { ...devices["Desktop Firefox"], ...use, connectOptions: compat } },
    { name: PROJECTS.webkit, ...fields, use: { ...devices["Desktop Safari"], ...use, connectOptions: compat } }
  ];
}
function workerdProject(fields = {}) {
  return { name: PROJECTS.workerd, testDir: "tests/workerd", testMatch: "**/*.workerd.ts", fullyParallel: false, ...fields };
}
function runsOnlyWorkerd(argv) {
  const named = argv.flatMap((arg, index) => {
    if (arg.startsWith("--project=")) return [arg.slice("--project=".length)];
    return arg === "--project" ? [argv[index + 1] ?? ""] : [];
  });
  return named.length > 0 && named.every((name) => name === PROJECTS.workerd);
}
export {
  PROJECTS,
  chromiumProject,
  crossEngineProjects,
  playwrightServers,
  runsOnlyWorkerd,
  workerdProject
};
