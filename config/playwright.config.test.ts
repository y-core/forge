import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import pkg from "../package.json" with { type: "json" };

const CONFIG = resolve(import.meta.dir, "../playwright.config.ts");
const ENDPOINT = "ws://playwright.test:3000/";
const COMPAT = "ws://compat.test:3000/";

type LoadedConfig = { workers?: unknown; projects?: { name: string; connectOptions?: unknown }[]; error?: string };

// A fresh process per case: the config reads the environment once, at load.
function loadConfig(env: Record<string, string | undefined>): LoadedConfig {
  const run = Bun.spawnSync(
    [
      "bun",
      "-e",
      `import(${JSON.stringify(CONFIG)}).then((c) => console.log(JSON.stringify({ workers: c.default.workers, projects: c.default.projects.map((p) => ({ name: p.name, connectOptions: p.use?.connectOptions })) })), (e) => console.log(JSON.stringify({ error: e.message })))`,
    ],
    {
      env: Object.fromEntries(Object.entries({ PATH: process.env.PATH, ...env }).filter(([, value]) => value !== undefined)) as Record<
        string,
        string
      >,
    },
  );
  return JSON.parse(run.stdout.toString()) as LoadedConfig;
}

describe("playwright.config.ts", () => {
  it("takes its worker count from PLAYWRIGHT_SERVER_MAX_CLIENTS", () => {
    expect(loadConfig({ PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT, PLAYWRIGHT_SERVER_MAX_CLIENTS: "8" }).workers).toBe(8);
  });

  it("connects Firefox and WebKit to PLAYWRIGHT_COMPAT_WS_ENDPOINT, carrying the exposed network and headers, and leaves Chromium on the primary", () => {
    const connectOptions = { wsEndpoint: COMPAT, exposeNetwork: "<loopback>", headers: { "x-token": "abc" } };

    expect(
      loadConfig({
        PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT,
        PLAYWRIGHT_SERVER_MAX_CLIENTS: "8",
        PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT,
        PW_TEST_CONNECT_EXPOSE_NETWORK: "<loopback>",
        PW_TEST_CONNECT_HEADERS: '{"x-token":"abc"}',
      }).projects,
    ).toEqual([{ name: "chromium" }, { name: "firefox", connectOptions }, { name: "webkit", connectOptions }, { name: "workerd" }]);
  });

  it("connects the compat projects with the endpoint alone when no network or headers are stated", () => {
    const connectOptions = { wsEndpoint: COMPAT };

    expect(
      loadConfig({ PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT, PLAYWRIGHT_SERVER_MAX_CLIENTS: "8", PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT }).projects,
    ).toEqual([{ name: "chromium" }, { name: "firefox", connectOptions }, { name: "webkit", connectOptions }, { name: "workerd" }]);
  });

  it("runs the compat projects through the cron table's script, since no gate row names them", () => {
    expect(pkg.scripts["verify:cron"]).toBe("bun run src/tooling/root/bin.ts verify --config config/cron.ts --tier release");
    expect(Object.hasOwn(pkg.scripts, "test:browser:cross-engine")).toBe(false);
  });

  for (const compat of [undefined, ""]) {
    it(`declares neither Firefox nor WebKit with PLAYWRIGHT_COMPAT_WS_ENDPOINT ${compat === undefined ? "unset" : "empty"}`, () => {
      const loaded = loadConfig({
        PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT,
        PLAYWRIGHT_SERVER_MAX_CLIENTS: "8",
        PLAYWRIGHT_COMPAT_WS_ENDPOINT: compat,
      });

      expect(loaded.projects?.map((project) => project.name)).toEqual(["chromium", "workerd"]);
    });
  }

  for (const endpoint of [undefined, ""]) {
    it(`refuses to load with PW_TEST_CONNECT_WS_ENDPOINT ${endpoint === undefined ? "unset" : "empty"}`, () => {
      expect(loadConfig({ PW_TEST_CONNECT_WS_ENDPOINT: endpoint, PLAYWRIGHT_SERVER_MAX_CLIENTS: "8" }).error).toContain(
        "PW_TEST_CONNECT_WS_ENDPOINT",
      );
    });
  }

  for (const maxClients of [undefined, "", "six", "2.5", "0", "-1"]) {
    it(`refuses to load with PLAYWRIGHT_SERVER_MAX_CLIENTS ${JSON.stringify(maxClients ?? null)}`, () => {
      expect(loadConfig({ PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT, PLAYWRIGHT_SERVER_MAX_CLIENTS: maxClients }).error).toContain(
        "PLAYWRIGHT_SERVER_MAX_CLIENTS",
      );
    });
  }
});
