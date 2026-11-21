import { devices } from "@playwright/test";

import type { BrowserProject, CompatConnect, PlaywrightEnv, PlaywrightServers, ProjectFields, ProjectUse } from "./types";

export type { BrowserProject, CompatConnect, PlaywrightEnv, PlaywrightServers, ProjectFields, ProjectUse } from "./types";

/** The project names `browserStep`, `crossEngineStep` and `workerdStep` pass to `--project`. @public */
export const PROJECTS = { chromium: "chromium", firefox: "firefox", webkit: "webkit", workerd: "workerd" } as const;

function parseHeaders(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw);
  const valid =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.values(parsed).every((value) => typeof value === "string");
  if (!valid) throw new Error("PW_TEST_CONNECT_HEADERS must be a JSON object of header names to string values");
  return parsed as Record<string, string>;
}

/** Reads the primary and compat Playwright servers off `env`, throwing when the primary is unnamed or its client limit is not a positive integer. @public */
export function playwrightServers(env: PlaywrightEnv): PlaywrightServers {
  if (!env["PW_TEST_CONNECT_WS_ENDPOINT"]) {
    throw new Error("PW_TEST_CONNECT_WS_ENDPOINT is unset; set it to the Playwright container's ws:// URL");
  }
  const maxClients = Number(env["PLAYWRIGHT_SERVER_MAX_CLIENTS"]);
  if (!Number.isInteger(maxClients) || maxClients < 1) {
    throw new Error("PLAYWRIGHT_SERVER_MAX_CLIENTS must be the Playwright container's --max-clients, a positive integer");
  }

  const wsEndpoint = env["PLAYWRIGHT_COMPAT_WS_ENDPOINT"];
  if (!wsEndpoint) return { maxClients, compat: undefined };
  // A project's `connectOptions` replaces Playwright's own connection whole, so it restates the exposed network and the headers.
  const exposeNetwork = env["PW_TEST_CONNECT_EXPOSE_NETWORK"];
  const headers = env["PW_TEST_CONNECT_HEADERS"];
  const compat: CompatConnect = { wsEndpoint, ...(exposeNetwork ? { exposeNetwork } : {}), ...(headers ? { headers: parseHeaders(headers) } : {}) };
  return { maxClients, compat };
}

/** The Chromium project: `Desktop Chrome` on the full browser, never the headless shell, which resolves no CSS anchor positioning. @public */
export function chromiumProject(use: ProjectUse = {}, fields: ProjectFields = {}): BrowserProject {
  return { name: PROJECTS.chromium, ...fields, use: { ...devices["Desktop Chrome"], channel: "chromium", ...use } };
}

/** The Firefox and WebKit projects on the compat server, or none when no compat server is named. @public */
export function crossEngineProjects(compat: CompatConnect | undefined, use: ProjectUse = {}, fields: ProjectFields = {}): BrowserProject[] {
  if (compat === undefined) return [];
  return [
    { name: PROJECTS.firefox, ...fields, use: { ...devices["Desktop Firefox"], ...use, connectOptions: compat } },
    { name: PROJECTS.webkit, ...fields, use: { ...devices["Desktop Safari"], ...use, connectOptions: compat } },
  ];
}

/** The workerd project over `tests/workerd/**\/*.workerd.ts`, one spec at a time, since each serves its own Worker. @public */
export function workerdProject(fields: ProjectFields = {}): BrowserProject {
  return { name: PROJECTS.workerd, testDir: "tests/workerd", testMatch: "**/*.workerd.ts", fullyParallel: false, ...fields };
}

/** Whether `argv` selects the workerd project and nothing else, so a config can skip the dev server only that run has no use for. @public */
export function runsOnlyWorkerd(argv: readonly string[]): boolean {
  const named = argv.flatMap((arg, index) => {
    if (arg.startsWith("--project=")) return [arg.slice("--project=".length)];
    return arg === "--project" ? [argv[index + 1] ?? ""] : [];
  });
  return named.length > 0 && named.every((name) => name === PROJECTS.workerd);
}
