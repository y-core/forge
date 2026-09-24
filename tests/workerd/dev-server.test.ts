import { afterAll, describe, expect, it } from "bun:test";

import { type DevServer, startDevServer } from "@y-core/forge/testing/workerd";

const CONFIG = new URL("../fixtures/workers-form/wrangler.jsonc", import.meta.url).pathname;

const servers: DevServer[] = [];

afterAll(() => {
  for (const server of servers) server.stop();
});

describe("startDevServer()", () => {
  it("starts two servers called at once, each answering on an origin of its own", async () => {
    const started = await Promise.all([
      startDevServer({ config: CONFIG, readyPath: "/api/contact" }),
      startDevServer({ config: CONFIG, readyPath: "/api/contact" }),
    ]);
    servers.push(...started);
    const [first, second] = started;
    const answers = await Promise.all(started.map((server) => fetch(`${server.origin}/api/contact`).then((res) => res.status)));

    expect(first?.origin).not.toBe(second?.origin);
    expect(answers).toEqual([200, 200]);
  }, 400_000);
});
