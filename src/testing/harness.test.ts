import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import process from "node:process";

import { derivedConfig, harnessInput, queueStart, withDevConditions, withSiteOrigin } from "./harness";

const RAW = {
  name: "app",
  main: "src/worker.ts",
  compatibility_date: "2026-01-01",
  vars: { MODE: "config" },
  secrets: { required: ["SITE_ORIGIN", "KEY"] },
  env: { staging: { vars: { MODE: "staging" } } },
};

describe("derivedConfig", () => {
  it("keeps the config whole, main included, when no entry replaces it", () => {
    expect(derivedConfig(RAW)).toEqual(RAW);
  });

  it("replaces main with the absolute entry and keeps the declared secrets, which a path input's secrets satisfy", () => {
    expect(derivedConfig(RAW, "/app/tests/entry.ts")).toEqual({ ...RAW, main: "/app/tests/entry.ts" });
  });

  it("drops local_protocol and keeps every other dev key", () => {
    expect(derivedConfig({ ...RAW, dev: { local_protocol: "https", port: 8787 } }).dev).toEqual({ port: 8787 });
  });

  it("drops a dev block that held only local_protocol", () => {
    expect("dev" in derivedConfig({ ...RAW, dev: { local_protocol: "https" } })).toBe(false);
  });

  it("defines __FORGE_DEV__ as true for an armed Worker, as `forge cf dev` does", () => {
    expect(derivedConfig(RAW, undefined, true)).toEqual({ ...RAW, define: { __FORGE_DEV__: "true" } });
  });

  it("adds no define for a strict Worker", () => {
    expect("define" in derivedConfig(RAW, "/app/tests/entry.ts")).toBe(false);
  });

  it("keeps the config's own defines beside __FORGE_DEV__, and overrides a __FORGE_DEV__ it states", () => {
    expect(derivedConfig({ ...RAW, define: { VERSION: '"1"', __FORGE_DEV__: "false" } }, undefined, true).define).toEqual({
      VERSION: '"1"',
      __FORGE_DEV__: "true",
    });
  });
});

describe("withDevConditions", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.WRANGLER_BUILD_CONDITIONS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.WRANGLER_BUILD_CONDITIONS;
    else process.env.WRANGLER_BUILD_CONDITIONS = saved;
  });

  const seen = async (): Promise<string | undefined> => process.env.WRANGLER_BUILD_CONDITIONS;

  it("starts under wrangler's default conditions plus forge-dev, and leaves the variable unset after, when none was set", async () => {
    delete process.env.WRANGLER_BUILD_CONDITIONS;

    expect(await withDevConditions(seen)).toBe("workerd,worker,browser,forge-dev");
    expect("WRANGLER_BUILD_CONDITIONS" in process.env).toBe(false);
  });

  it("starts under the caller's conditions plus forge-dev, and puts the caller's value back after", async () => {
    process.env.WRANGLER_BUILD_CONDITIONS = "workerd,custom";

    expect(await withDevConditions(seen)).toBe("workerd,custom,forge-dev");
    expect(process.env.WRANGLER_BUILD_CONDITIONS).toBe("workerd,custom");
  });

  it("puts the caller's value back when the start fails, and passes the failure on", async () => {
    process.env.WRANGLER_BUILD_CONDITIONS = "workerd,custom";

    await expect(withDevConditions(() => Promise.reject(new Error("no start")))).rejects.toThrow("no start");
    expect(process.env.WRANGLER_BUILD_CONDITIONS).toBe("workerd,custom");
  });

  it("leaves the variable unset when the start fails and none was set", async () => {
    delete process.env.WRANGLER_BUILD_CONDITIONS;

    await expect(withDevConditions(() => Promise.reject(new Error("no start")))).rejects.toThrow("no start");
    expect("WRANGLER_BUILD_CONDITIONS" in process.env).toBe(false);
  });
});

describe("queueStart", () => {
  it("runs a start only once the one queued before it has settled", async () => {
    const order: string[] = [];
    let release = (): void => {};
    const first = queueStart(async () => {
      order.push("first begins");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first ends");
    });
    const second = queueStart(async () => {
      order.push("second begins");
    });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(["first begins", "first ends", "second begins"]);
  });

  it("lets a plain start behind two overlapping dev starts see neither's conditions, and leaves the variable as it found it", async () => {
    const saved = process.env.WRANGLER_BUILD_CONDITIONS;
    delete process.env.WRANGLER_BUILD_CONDITIONS;
    try {
      let release = (): void => {};
      const slow = (): Promise<string | undefined> => new Promise((resolve) => (release = () => resolve(process.env.WRANGLER_BUILD_CONDITIONS)));
      const first = queueStart(() => withDevConditions(slow));
      const second = queueStart(() => withDevConditions(async () => process.env.WRANGLER_BUILD_CONDITIONS));
      const plain = queueStart(async () => process.env.WRANGLER_BUILD_CONDITIONS);
      await Promise.resolve();
      release();

      expect([await first, await second, await plain, process.env.WRANGLER_BUILD_CONDITIONS]).toEqual([
        "workerd,worker,browser,forge-dev",
        "workerd,worker,browser,forge-dev",
        undefined,
        undefined,
      ]);
    } finally {
      if (saved !== undefined) process.env.WRANGLER_BUILD_CONDITIONS = saved;
    }
  });

  it("runs the next start after one that failed, and hands each caller its own outcome", async () => {
    const failed = queueStart(() => Promise.reject(new Error("no start")));
    const next = queueStart(async () => "started");

    await expect(failed).rejects.toThrow("no start");
    expect(await next).toBe("started");
  });
});

describe("harnessInput", () => {
  it("serves the derived config by path alone when the caller binds nothing", () => {
    expect(harnessInput({ config: "/app/wrangler.jsonc" }, "/app/.derived.json")).toEqual({ workers: [{ configPath: "/app/.derived.json" }] });
  });

  it("binds vars and secrets on the path input, where they override .dev.vars, entry or not", () => {
    const options = { config: "/app/wrangler.jsonc", vars: { MODE: "test" }, secrets: { KEY: "k" } };

    expect([harnessInput(options, "/app/.derived.json"), harnessInput({ ...options, entry: "/app/entry.ts" }, "/app/.derived.json")]).toEqual([
      { workers: [{ configPath: "/app/.derived.json", vars: { MODE: "test" }, secrets: { KEY: "k" } }] },
      { workers: [{ configPath: "/app/.derived.json", vars: { MODE: "test" }, secrets: { KEY: "k" } }] },
    ]);
  });
});

describe("withSiteOrigin", () => {
  it("sets SITE_ORIGIN over a caller's var of the same name", () => {
    const input = harnessInput({ config: "/app/wrangler.jsonc", vars: { SITE_ORIGIN: "https://stale.test", MODE: "test" } }, "/app/.derived.json");

    expect(withSiteOrigin(input, "http://127.0.0.1:8787")).toEqual({
      workers: [{ configPath: "/app/.derived.json", vars: { SITE_ORIGIN: "http://127.0.0.1:8787", MODE: "test" } }],
    });
  });

  it("leaves every Worker after the primary alone", () => {
    const second = { configPath: "/other/wrangler.jsonc" };
    const input = withSiteOrigin({ workers: [{ configPath: "/app/wrangler.jsonc" }, second] }, "http://127.0.0.1:1");

    expect(input.workers[1]).toBe(second);
  });
});
