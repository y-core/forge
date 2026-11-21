import { describe, expect, it } from "bun:test";

import { browserStep, crossEngineStep, workerdStep } from "../gate/builders";
import { chromiumProject, crossEngineProjects, playwrightServers, runsOnlyWorkerd, workerdProject } from "./config";

const ENDPOINT = "ws://playwright.test:3000/";
const COMPAT = "ws://compat.test:3000/";
const PRIMARY = { PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT, PLAYWRIGHT_SERVER_MAX_CLIENTS: "6" };

describe("playwrightServers", () => {
  for (const endpoint of [undefined, ""]) {
    it(`throws with PW_TEST_CONNECT_WS_ENDPOINT ${endpoint === undefined ? "unset" : "empty"}`, () => {
      expect(() => playwrightServers({ ...PRIMARY, PW_TEST_CONNECT_WS_ENDPOINT: endpoint })).toThrow(
        "PW_TEST_CONNECT_WS_ENDPOINT is unset; set it to the Playwright container's ws:// URL",
      );
    });
  }

  for (const maxClients of [undefined, "", "six", "2.5", "0", "-1"]) {
    it(`throws with PLAYWRIGHT_SERVER_MAX_CLIENTS ${JSON.stringify(maxClients ?? null)}`, () => {
      expect(() => playwrightServers({ ...PRIMARY, PLAYWRIGHT_SERVER_MAX_CLIENTS: maxClients })).toThrow(
        "PLAYWRIGHT_SERVER_MAX_CLIENTS must be the Playwright container's --max-clients, a positive integer",
      );
    });
  }

  it("reads the client limit as a number", () => {
    expect(playwrightServers(PRIMARY).maxClients).toBe(6);
  });

  for (const compat of [undefined, ""]) {
    it(`names no compat server with PLAYWRIGHT_COMPAT_WS_ENDPOINT ${compat === undefined ? "unset" : "empty"}`, () => {
      expect(playwrightServers({ ...PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: compat, PW_TEST_CONNECT_EXPOSE_NETWORK: "<loopback>" }).compat).toBe(
        undefined,
      );
    });
  }

  it("connects to the compat endpoint alone when no network or headers are stated", () => {
    expect(playwrightServers({ ...PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT }).compat).toEqual({ wsEndpoint: COMPAT });
  });

  it("restates the exposed network and the headers on the compat connection", () => {
    const compat = playwrightServers({
      ...PRIMARY,
      PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT,
      PW_TEST_CONNECT_EXPOSE_NETWORK: "<loopback>",
      PW_TEST_CONNECT_HEADERS: '{"x-token":"abc"}',
    }).compat;
    expect(compat).toEqual({ wsEndpoint: COMPAT, exposeNetwork: "<loopback>", headers: { "x-token": "abc" } });
  });

  it("carries the network without headers, and headers without the network", () => {
    const env = { ...PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT };
    expect(playwrightServers({ ...env, PW_TEST_CONNECT_EXPOSE_NETWORK: "<loopback>" }).compat).toEqual({
      wsEndpoint: COMPAT,
      exposeNetwork: "<loopback>",
    });
    expect(playwrightServers({ ...env, PW_TEST_CONNECT_HEADERS: '{"a":"b"}' }).compat).toEqual({ wsEndpoint: COMPAT, headers: { a: "b" } });
  });

  for (const headers of ['["a"]', '{"a":1}', "null"]) {
    it(`throws on PW_TEST_CONNECT_HEADERS ${headers}, which is no map of header names to strings`, () => {
      expect(() => playwrightServers({ ...PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT, PW_TEST_CONNECT_HEADERS: headers })).toThrow(
        "PW_TEST_CONNECT_HEADERS must be a JSON object of header names to string values",
      );
    });
  }
});

describe("the projects", () => {
  const compat = { wsEndpoint: COMPAT };

  it("runs Chromium on the full browser rather than the headless shell, with the caller's use and fields on top", () => {
    const project = chromiumProject({ baseURL: "https://127.0.0.1:8788" }, { testDir: "tests/browser" });
    expect([project.name, project.testDir, project.use?.channel, project.use?.baseURL]).toEqual([
      "chromium",
      "tests/browser",
      "chromium",
      "https://127.0.0.1:8788",
    ]);
    expect(project.use?.userAgent).toContain("Chrome");
  });

  it("declares Firefox and WebKit on the compat connection, which the caller's use cannot displace", () => {
    const projects = crossEngineProjects(
      compat,
      { connectOptions: { wsEndpoint: ENDPOINT }, baseURL: "https://x.test" },
      { grep: /@cross-engine/ },
    );
    expect(projects.map((project) => [project.name, project.use?.connectOptions, project.use?.baseURL, project.grep])).toEqual([
      ["firefox", compat, "https://x.test", /@cross-engine/],
      ["webkit", compat, "https://x.test", /@cross-engine/],
    ]);
    expect(projects.map((project) => project.use?.defaultBrowserType)).toEqual(["firefox", "webkit"]);
  });

  it("declares no cross-engine project when no compat server is named", () => {
    expect(crossEngineProjects(undefined, { baseURL: "https://x.test" })).toEqual([]);
  });

  it("runs the workerd set one spec at a time from tests/workerd, unless the caller moves it", () => {
    expect(workerdProject()).toEqual({ name: "workerd", testDir: "tests/workerd", testMatch: "**/*.workerd.ts", fullyParallel: false });
    expect(workerdProject({ timeout: 60_000 }).timeout).toBe(60_000);
  });

  it("names each project as the gate's Playwright rows select it", () => {
    const selected = [browserStep(), crossEngineStep(), workerdStep()].flatMap((step) =>
      (step.cmd ?? []).filter((arg) => arg.startsWith("--project=")).map((arg) => arg.slice("--project=".length)),
    );
    const declared = [chromiumProject(), ...crossEngineProjects(compat), workerdProject()].map((project) => project.name);
    expect(declared).toEqual(selected);
  });
});

describe("runsOnlyWorkerd", () => {
  const cases: readonly [readonly string[], boolean][] = [
    [["node", "playwright", "test", "--project=workerd"], true],
    [["node", "playwright", "test", "--project", "workerd"], true],
    [["node", "playwright", "test", "--project=workerd", "tests/workerd/a.workerd.ts"], true],
    [["node", "playwright", "test", "--project=workerd", "--project", "workerd"], true],
    [["node", "playwright", "test"], false],
    [["node", "playwright", "test", "--project=chromium"], false],
    [["node", "playwright", "test", "--project=workerd", "--project=chromium"], false],
    [["node", "playwright", "test", "--project", "workerd", "--project", "firefox"], false],
    [["node", "playwright", "test", "--project"], false],
    [["node", "playwright", "test", "--list"], false],
  ];

  for (const [argv, expected] of cases) {
    it(`${expected ? "holds" : "does not hold"} for ${argv.slice(3).join(" ") || "a bare run"}`, () => {
      expect(runsOnlyWorkerd(argv)).toBe(expected);
    });
  }
});
