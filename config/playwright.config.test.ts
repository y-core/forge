import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const CONFIG = resolve(import.meta.dir, "../playwright.config.ts");
const ENDPOINT = "ws://playwright.test:3000/";

// A fresh process per case: the config reads the environment once, at load.
function loadConfig(env: Record<string, string | undefined>): { workers?: unknown; error?: string } {
  const run = Bun.spawnSync(
    [
      "bun",
      "-e",
      `import(${JSON.stringify(CONFIG)}).then((c) => console.log(JSON.stringify({ workers: c.default.workers })), (e) => console.log(JSON.stringify({ error: e.message })))`,
    ],
    {
      env: Object.fromEntries(Object.entries({ PATH: process.env.PATH, ...env }).filter(([, value]) => value !== undefined)) as Record<
        string,
        string
      >,
    },
  );
  return JSON.parse(run.stdout.toString()) as { workers?: unknown; error?: string };
}

describe("playwright.config.ts", () => {
  it("takes its worker count from PLAYWRIGHT_SERVER_MAX_CLIENTS", () => {
    expect(loadConfig({ PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT, PLAYWRIGHT_SERVER_MAX_CLIENTS: "8" })).toEqual({ workers: 8 });
  });

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
